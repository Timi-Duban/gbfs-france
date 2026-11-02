/** Query bounds the facade clamps to; apps may set tighter ones. */
export const LIMITS = {
  defaultLimit: 5,
  maxLimit: 20,
  defaultMaxDistanceMeters: 2000,
  maxDistanceMeters: 10_000,
} as const;
