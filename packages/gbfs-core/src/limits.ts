/** Query bounds the facade clamps to; apps may set tighter ones. */
export const LIMITS = {
  defaultLimit: 5,
  maxLimit: 20,
  defaultMaxDistanceMeters: 2000,
  maxDistanceMeters: 10_000,
  /** Networks queried by nearbyStationsAround, nearest bounding boxes first. */
  maxNetworksAround: 3,
} as const;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
