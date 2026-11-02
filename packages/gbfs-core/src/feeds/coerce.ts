import { z } from 'zod';

// Lenient readers for real French feeds: Vélib sends numeric ids and 0/1 flags.

export const id = z.union([z.string(), z.number()]).transform(String);

export const flag = z.union([z.boolean(), z.number()]).transform((v) => v === true || v === 1);

export const count = z
  .number()
  .nullish()
  .transform((v) => (v == null || Number.isNaN(v) ? null : v));

export const coordinate = z
  .union([z.number(), z.string().trim().min(1).transform(Number)])
  .refine(Number.isFinite);

/** Epoch seconds (v1/v2) or RFC 3339 (v3) to epoch seconds. */
export const timestamp = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  });

/** Picks the French item, else English, else the first one. */
export function preferFrench<T>(items: T[], language: (item: T) => string): T | undefined {
  const starts = (prefix: string) =>
    items.find((i) => language(i).toLowerCase().startsWith(prefix));
  return starts('fr') ?? starts('en') ?? items[0];
}

const localizedText = z.array(z.object({ text: z.string(), language: z.string() }));

/** v3 localized strings: French first, then English, then the first non-empty value. */
export const localized = localizedText.transform(
  (items) =>
    preferFrench(
      items.filter((i) => i.text.trim() !== ''),
      (i) => i.language,
    )?.text ?? '',
);

/** Parses each item on its own and drops invalid ones, so one bad station never fails a feed. */
export function parseEach<S extends z.ZodType>(items: unknown[], schema: S): z.output<S>[] {
  const out: z.output<S>[] = [];
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}
