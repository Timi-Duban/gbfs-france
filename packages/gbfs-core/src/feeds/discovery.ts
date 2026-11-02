import { z } from 'zod';
import { FeedFailure } from '../errors';
import type { GbfsAdapter } from './model';
import { v2Adapter } from './v2';
import { v3Adapter } from './v3';

const feedList = z.array(z.object({ name: z.string(), url: z.string() }));

// v1/v2 group feeds by language, v3 lists them directly.
export const discoverySchema = z.object({
  version: z.string().optional(),
  data: z.union([
    z.object({ feeds: feedList }).transform((d) => d.feeds),
    z
      .record(z.string(), z.object({ feeds: feedList }))
      .transform((byLang) => pickLanguage(byLang)?.feeds ?? []),
  ]),
});

export interface Discovery {
  /** `1.x` when the manifest has no version field (GBFS 1.0, e.g. Vélib). */
  version: string;
  feeds: Record<string, string>;
}

export function parseDiscovery(raw: unknown): Discovery {
  const r = discoverySchema.safeParse(raw);
  if (!r.success)
    throw new FeedFailure('invalid-feed', 'Not a GBFS discovery document (gbfs.json).');
  const feeds: Record<string, string> = {};
  for (const f of r.data.data) feeds[f.name] = f.url;
  return { version: r.data.version ?? '1.x', feeds };
}

function pickLanguage<T>(byLang: Record<string, T>): T | undefined {
  const langs = Object.keys(byLang);
  const lang =
    langs.find((l) => l.toLowerCase().startsWith('fr')) ??
    langs.find((l) => l.toLowerCase().startsWith('en')) ??
    langs[0];
  return lang === undefined ? undefined : byLang[lang];
}

const V2_VERSIONS = new Set(['1.x', '1.0', '1.1', '2.0', '2.1', '2.2', '2.3']);

export function isSupportedVersion(version: string): boolean {
  return V2_VERSIONS.has(version) || version === '3.0';
}

/** Picks the Adapter for a GBFS version: v2 reads 1.x/2.x, v3 reads 3.0. */
export function adapterFor(version: string): GbfsAdapter {
  if (V2_VERSIONS.has(version)) return v2Adapter;
  if (version === '3.0') return v3Adapter;
  throw new FeedFailure('unsupported-version', `GBFS version ${version} is not supported.`);
}

/** Orders versions so the highest one wins when a system is published twice. */
export function versionRank(version: string): number {
  if (version === '1.x') return 1;
  const n = Number(version);
  return Number.isNaN(n) ? 0 : n;
}
