import type { Catalog, LICENCES } from './catalog/schema';
import type { GBFS_ERROR_KINDS } from './errors';

/** Open licences served. Anything else is excluded from the catalog. */
export type Licence = (typeof LICENCES)[number];

/** Credit owed to the data producer; returned with every result. */
export interface Attribution {
  publisher: string;
  licence: Licence;
  licenceName: string;
  sourceUrl: string;
  /** Last update of the dataset on transport.data.gouv.fr (ISO 8601). */
  updated: string;
}

export interface NetworkSummary {
  /** Dataset slug, or `slug:system_id` when a dataset holds several systems. */
  id: string;
  name: string;
  title: string;
  areas: string[];
  gbfsVersion: string;
  stationCount: number;
  attribution: Attribution;
}

export interface LocatedNetworkSummary extends NetworkSummary {
  /** Distance to the network's station bounding box, 0 inside it. */
  distanceMeters: number;
}

export interface NetworksAround {
  /** Nearest first; inside several boxes, the smaller box first. */
  networks: LocatedNetworkSummary[];
  snapshotDate: string;
}

export type UnsupportedNetwork = Catalog['excluded'][number];

export interface NetworkSearch {
  networks: NetworkSummary[];
  /** Catalog datasets matching the query that cannot be served, with the reason. */
  unsupported: UnsupportedNetwork[];
  /** Date the committed catalog snapshot was built (ISO 8601). */
  snapshotDate: string;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface StationView {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  capacity: number | null;
  /** `null` means the operator did not publish the count (never guessed as 0). */
  bikes: number | null;
  ebikes: number | null;
  mechanical: number | null;
  docks: number | null;
  isRenting: boolean;
  isReturning: boolean;
  /** Epoch seconds of the station's last report. */
  reportedAt: number | null;
  reportedAgeSeconds: number | null;
  /** Last report older than 30 minutes. */
  outdated: boolean;
  /** Set by nearbyStations only. */
  distanceMeters?: number;
}

export interface Freshness {
  /** Served from cache after the feed failed (stale-if-error, at most 10 min past expiry). */
  stale: boolean;
  /** Age of the oldest feed data used, in seconds. */
  ageSeconds: number;
}

export interface NetworkRef {
  id: string;
  name: string;
}

export interface NearbyStations {
  network: NetworkRef;
  stations: StationView[];
  /** Distance to the nearest installed station, whatever the filters. */
  nearestDistanceMeters: number | null;
  /** No installed station within `maxDistanceMeters`. */
  outsideNetworkArea: boolean;
  /** Stations present in only one of station_information / station_status. */
  droppedStations: number;
  freshness: Freshness;
  attribution: Attribution;
}

export interface NearbyAround {
  /** Networks with an installed station within `maxDistanceMeters`, nearest station first. */
  results: NearbyStations[];
  /** Candidate networks whose feeds failed. */
  failures: GbfsError[];
}

export interface StationDetails {
  network: NetworkRef;
  station: StationView;
  freshness: Freshness;
  attribution: Attribution;
}

export type GbfsErrorKind = (typeof GBFS_ERROR_KINDS)[number];

export interface GbfsError {
  kind: GbfsErrorKind;
  message: string;
  network?: NetworkRef;
  attribution?: Attribution;
}

/** Facade methods never throw for data failures: callers must handle `ok: false`. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: GbfsError };

export type StationNeed = 'bikes' | 'docks';

export interface NearbyOptions {
  limit?: number;
  need?: StationNeed;
  maxDistanceMeters?: number;
}

/** Minimal fetch contract, satisfied by global fetch on Node, browsers and React Native. */
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GbfsFranceOptions {
  fetch?: FetchLike;
  /** Rewrites feed URLs before fetching (e.g. through a CORS proxy on web). */
  resolveUrl?: (url: string) => string;
  /** Clock in epoch milliseconds. */
  now?: () => number;
  /** Extra request headers, e.g. a User-Agent. None are sent by default. */
  headers?: Record<string, string>;
}

export interface GbfsFrance {
  searchNetworks(query: string, opts?: { limit?: number }): Promise<Result<NetworkSearch>>;
  nearbyStations(
    networkId: string,
    at: LatLon,
    opts?: NearbyOptions,
  ): Promise<Result<NearbyStations>>;
  getStation(networkId: string, stationId: string): Promise<Result<StationDetails>>;
  /** Catalog-only: networks whose stations lie near a point. */
  locateNetworks(
    at: LatLon,
    opts?: { maxDistanceMeters?: number },
  ): Promise<Result<NetworksAround>>;
  /** nearbyStations without a network id: queries the nearest candidate networks. */
  nearbyStationsAround(at: LatLon, opts?: NearbyOptions): Promise<Result<NearbyAround>>;
}
