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
import { distanceMeters, joinStations, meetsNeed } from './stations';
import type {
  Attribution,
  FetchLike,
  GbfsError,
  GbfsFrance,
  GbfsFranceOptions,
  LatLon,
  NetworkRef,
  NetworkSummary,
  Result,
  StationView,
} from './types';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const DEFAULT_MAX_DISTANCE_M = 2000;
const MAX_DISTANCE_M = 10_000;

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

/**
 * Facade over French GBFS feeds: hides the catalog, version Adapters, feed join, cache and errors
 * behind three calls shared by the MCP server and future apps.
 */
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

  function findNetwork(networkId: string): CatalogNetwork | GbfsError {
    const network = catalog.networks.find((n) => n.id === networkId);
    if (network) return network;
    const excluded = catalog.excluded.find((e) => e.slug === networkId);
    return {
      kind: 'not-supported-network',
      message: excluded
        ? `${excluded.title} is not supported yet: ${excluded.reason}.`
        : `Unknown network "${networkId}". Call search_networks to get a network id.`,
    };
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

  /** Runs a network query and maps every core failure to a typed error (R8/R13). */
  async function withNetwork<T>(
    networkId: string,
    run: (network: CatalogNetwork, ref: NetworkRef, attribution: Attribution) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    const found = findNetwork(networkId);
    if (!('id' in found)) return { ok: false, error: found };
    const ref = { id: found.id, name: found.name };
    const attribution = attributionOf(found);
    try {
      return await run(found, ref, attribution);
    } catch (err) {
      if (!(err instanceof FeedFailure)) throw err;
      return {
        ok: false,
        error: {
          kind: err.kind,
          message: `${found.name}: ${err.message}`,
          network: ref,
          attribution,
        },
      };
    }
  }

  return {
    async searchNetworks(query, opts = {}) {
      const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
      const { networks, unsupported } = searchCatalog(catalog, query, limit);
      return {
        ok: true,
        data: { networks: networks.map(summaryOf), unsupported, snapshotDate: catalog.generatedAt },
      };
    },

    nearbyStations(networkId, at: LatLon, opts = {}) {
      return withNetwork(networkId, async (network, ref, attribution) => {
        const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
        const maxDistance = clamp(
          opts.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_M,
          1,
          MAX_DISTANCE_M,
        );
        const { stations, dropped, freshness } = await loadStations(network);
        const byDistance: StationView[] = stations
          .map((s) => ({ ...s, distanceMeters: Math.round(distanceMeters(at, s)) }))
          .sort((a, b) => a.distanceMeters - b.distanceMeters);
        const nearest = byDistance[0]?.distanceMeters ?? null;
        const matches = byDistance
          .filter((s) => (s.distanceMeters ?? 0) <= maxDistance && meetsNeed(s, opts.need))
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
      return withNetwork(networkId, async (network, ref, attribution) => {
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
