export type FeedKind =
  'discovery' | 'system_information' | 'station_information' | 'station_status' | 'vehicle_types';

interface Bounds {
  min: number;
  max: number;
  /** Used when the feed has no ttl. */
  fallback: number;
}

// R1: operator ttl values are unreliable (Vélib status says 3600, many say 0), so clamp by feed kind.
const LIVE: Bounds = { min: 30, max: 60, fallback: 60 };
const STATIC: Bounds = { min: 300, max: 86_400, fallback: 300 };

const POLICY: Record<FeedKind, Bounds> = {
  station_status: LIVE,
  discovery: STATIC,
  system_information: STATIC,
  station_information: STATIC,
  vehicle_types: STATIC,
};

/** Cache lifetime in seconds for a feed, from its own ttl clamped to the kind's bounds. */
export function cacheSeconds(kind: FeedKind, ttl: number | undefined): number {
  const b = POLICY[kind];
  if (ttl === undefined || !Number.isFinite(ttl)) return b.fallback;
  return Math.min(b.max, Math.max(b.min, ttl));
}

/** Stale-if-error window after expiry (R8). */
export const STALE_IF_ERROR_MS = 10 * 60 * 1000;
export const TIMEOUT_MS = 8000;
export const MAX_ENTRIES = 64;
