import snapshot from '../data/catalog.json';
import { LICENCE_NAMES, catalogSchema } from './catalog/schema';
import type { Catalog, CatalogNetwork } from './catalog/schema';
import { searchCatalog } from './catalog/search';
import { FeedFailure } from './errors';
import type { Discovery } from './feeds/discovery';
import { adapterFor, parseDiscovery } from './feeds/discovery';
import type { VehicleTypeRecord } from './feeds/model';
import { FeedLoader } from './fetch/feed-loader';
import type { Loaded } from './fetch/feed-loader';
import { LIMITS } from './limits';
import { distanceMeters, joinStations, meetsNeed } from './stations';
import type {
  Attribution,
  FetchLike,
  GbfsFrance,
  GbfsFranceOptions,
  LatLon,
  NetworkRef,
  NetworkSummary,
  Result,
} from './types';

let bundledCatalog: Catalog | undefined;

function loadCatalog(): Catalog {
  bundledCatalog ??= catalogSchema.parse(snapshot);
  return bundledCatalog;
}

function attributionOf(n: CatalogNetwork): Attribution {
  return {
    publisher: n.publisher,
    licence: n.licence,
    licenceName: LICENCE_NAMES[n.licence],
    sourceUrl: n.pageUrl,
    updated: n.updated,
  };
}

function summaryOf(n: CatalogNetwork): NetworkSummary {
  return {
    id: n.id,
    name: n.name,
    title: n.title,
    areas: n.areas,
    gbfsVersion: n.gbfsVersion,
    stationCount: n.stationCount,
    attribution: attributionOf(n),
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Facade: three calls hiding catalog, version Adapters, feed join, cache and errors. */
export function createGbfsFrance(options: GbfsFranceOptions = {}): GbfsFrance {
  const catalog = loadCatalog();
  const now = options.now ?? (() => Date.now());
  const defaultFetch: FetchLike = (url, init) => fetch(url, init);
  const loader = new FeedLoader({
    fetch: options.fetch ?? defaultFetch,
    resolveUrl: options.resolveUrl ?? ((u) => u),
    now,
    headers: options.headers ?? {},
  });

  function findNetwork(networkId: string): Result<CatalogNetwork> {
    const network = catalog.networks.find((n) => n.id === networkId);
    if (network) return { ok: true, data: network };
    const excluded = catalog.excluded.find((e) => e.slug === networkId);
    const error = excluded
      ? {
          kind: 'not-supported-network' as const,
          message: `${excluded.title} is not supported yet: ${excluded.reason}.`,
        }
      : { kind: 'unknown-network' as const, message: `Unknown network "${networkId}".` };
    return { ok: false, error };
  }

  /** Discovery -> Adapter -> station_information x station_status (+ vehicle_types when useful). */
  async function loadStations(network: CatalogNetwork) {
    const discovery: Loaded<Discovery> = await loader.load(
      network.discoveryUrl,
      'discovery',
      parseDiscovery,
    );
    const adapter = adapterFor(discovery.value.version);
    const { feeds } = discovery.value;
    const infoUrl = feeds['station_information'];
    const statusUrl = feeds['station_status'];
    if (!infoUrl || !statusUrl) {
      throw new FeedFailure('invalid-feed', 'The discovery file lists no station feeds.');
    }
    const [info, status] = await Promise.all([
      loader.load(infoUrl, 'station_information', adapter.stationInformation),
      loader.load(statusUrl, 'station_status', adapter.stationStatus),
    ]);
    let types: VehicleTypeRecord[] | null = null;
    const typesUrl = feeds['vehicle_types'];
    if (typesUrl && status.value.some((s) => s.vehicleTypes)) {
      // Optional: without vehicle_types the e-bike split is just unknown.
      types = await loader
        .load(typesUrl, 'vehicle_types', adapter.vehicleTypes)
        .then((t) => t.value)
        .catch(() => null);
    }
    const nowMs = now();
    const joined = joinStations(info.value, status.value, types, nowMs / 1000);
    const used = [discovery, info, status];
    return {
      ...joined,
      freshness: {
        stale: used.some((l) => l.stale),
        ageSeconds: Math.max(
          0,
          Math.round((nowMs - Math.min(...used.map((l) => l.fetchedAt))) / 1000),
        ),
      },
    };
  }

  /** Runs a network query and maps every core failure to a typed error. */
  async function withNetwork<T>(
    networkId: string,
    run: (ctx: {
      network: CatalogNetwork;
      ref: NetworkRef;
      attribution: Attribution;
    }) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    const found = findNetwork(networkId);
    if (!found.ok) return found;
    const network = found.data;
    const ref = { id: network.id, name: network.name };
    const attribution = attributionOf(network);
    try {
      return await run({ network, ref, attribution });
    } catch (err) {
      if (!(err instanceof FeedFailure)) throw err;
      return {
        ok: false,
        error: {
          kind: err.kind,
          message: `${network.name}: ${err.message}`,
          network: ref,
          attribution,
        },
      };
    }
  }

  return {
    async searchNetworks(query, opts = {}) {
      const limit = clamp(opts.limit ?? LIMITS.defaultLimit, 1, LIMITS.maxLimit);
      const { networks, unsupported } = searchCatalog(catalog, query, limit);
      return {
        ok: true,
        data: { networks: networks.map(summaryOf), unsupported, snapshotDate: catalog.generatedAt },
      };
    },

    nearbyStations(networkId, at: LatLon, opts = {}) {
      return withNetwork(networkId, async ({ network, ref, attribution }) => {
        const limit = clamp(opts.limit ?? LIMITS.defaultLimit, 1, LIMITS.maxLimit);
        const maxDistance = clamp(
          opts.maxDistanceMeters ?? LIMITS.defaultMaxDistanceMeters,
          1,
          LIMITS.maxDistanceMeters,
        );
        const { stations, dropped, freshness } = await loadStations(network);
        const withDistance = stations.map((s) => ({
          ...s,
          distanceMeters: Math.round(distanceMeters(at, s)),
        }));
        const nearest = withDistance.reduce<number | null>(
          (min, s) => (min === null || s.distanceMeters < min ? s.distanceMeters : min),
          null,
        );
        const matches = withDistance
          .filter((s) => s.distanceMeters <= maxDistance && meetsNeed(s, opts.need))
          .sort((a, b) => a.distanceMeters - b.distanceMeters)
          .slice(0, limit);
        return {
          ok: true,
          data: {
            network: ref,
            stations: matches,
            nearestDistanceMeters: nearest,
            outsideNetworkArea: nearest === null || nearest > maxDistance,
            droppedStations: dropped,
            freshness,
            attribution,
          },
        };
      });
    },

    getStation(networkId, stationId) {
      return withNetwork(networkId, async ({ network, ref, attribution }) => {
        const { stations, freshness } = await loadStations(network);
        const station = stations.find((s) => s.id === stationId);
        if (!station) {
          return {
            ok: false,
            error: {
              kind: 'station-not-found',
              message: `${network.name}: no installed station with id "${stationId}".`,
              network: ref,
              attribution,
            },
          };
        }
        return { ok: true, data: { network: ref, station, freshness, attribution } };
      });
    },
  };
}
