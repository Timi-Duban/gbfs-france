import { z } from 'zod';
import { FeedFailure } from '../errors';

export const stationsEnvelope = z.object({ data: z.object({ stations: z.array(z.unknown()) }) });

export const vehicleTypesEnvelope = z.object({
  data: z.object({ vehicle_types: z.array(z.unknown()) }),
});

/** Reads the `ttl` every GBFS feed carries at its root, if any. */
export function readTtl(raw: unknown): number | undefined {
  const r = z.object({ ttl: z.number() }).safeParse(raw);
  return r.success ? r.data.ttl : undefined;
}

export function parseEnvelope<S extends z.ZodType>(
  raw: unknown,
  schema: S,
  feed: string,
): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new FeedFailure('invalid-feed', `Invalid ${feed} feed.`);
  return r.data;
}
