import type { Catalog, CatalogNetwork } from './schema';

/** Lowercase, strip accents and punctuation: "Vélo'v" -> "velov", "Saint-Étienne" -> "saintetienne". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Spaces, hyphens and punctuation split words; apostrophes stay inside them.
const SEPARATOR = /[^0-9A-Za-zÀ-ÖØ-öø-ÿ'’]+/;
const APOSTROPHE = /['’]/;

function split(text: string): string[] {
  return text.split(SEPARATOR);
}

function queryWords(query: string): string[] {
  return split(query).map(fold).filter(Boolean);
}

/** Field words, also split on apostrophes and camel case: "VélôToulouse" -> velotoulouse, toulouse. */
export function words(parts: string[]): Set<string> {
  const out = new Set<string>();
  for (const word of parts.flatMap(split)) {
    out.add(fold(word));
    const pieces = word.replace(/([a-zß-ÿ])([A-ZÀ-Þ])/g, '$1 $2').split(/\s|['’]/);
    if (pieces.length > 1 || APOSTROPHE.test(word)) for (const p of pieces) out.add(fold(p));
  }
  out.delete('');
  return out;
}

/** 2 for an exact word, 1 for a word prefix, 0 for no match. */
function match(token: string, field: Set<string>): number {
  if (field.has(token)) return 2;
  for (const word of field) if (word.startsWith(token)) return 1;
  return 0;
}

interface SearchIndex {
  networks: { network: CatalogNetwork; primary: Set<string>; all: Set<string> }[];
  excluded: { entry: Catalog['excluded'][number]; text: Set<string> }[];
}

// Word sets built once per catalog, not on every query.
const indexes = new WeakMap<Catalog, SearchIndex>();

function indexOf(catalog: Catalog): SearchIndex {
  let index = indexes.get(catalog);
  if (!index) {
    index = {
      networks: catalog.networks.map((n) => ({
        network: n,
        primary: words([n.name, n.systemName, ...n.areas]),
        all: words([n.name, n.systemName, n.title, n.publisher, n.slug, ...n.areas]),
      })),
      excluded: catalog.excluded.map((e) => ({ entry: e, text: words([e.title, e.slug]) })),
    };
    indexes.set(catalog, index);
  }
  return index;
}

/** Accent-insensitive word-prefix search; exact name/area words rank first, then size. */
export function searchCatalog(catalog: Catalog, query: string, limit: number) {
  const tokens = queryWords(query);
  if (tokens.length === 0) return { networks: [], unsupported: [] };

  const index = indexOf(catalog);
  const scored: { network: CatalogNetwork; score: number }[] = [];
  for (const { network, primary, all } of index.networks) {
    if (!tokens.every((t) => match(t, all) > 0)) continue;
    const score = tokens.reduce((sum, t) => sum + match(t, primary), 0);
    scored.push({ network, score });
  }
  scored.sort((a, b) => b.score - a.score || b.network.stationCount - a.network.stationCount);

  const unsupported = index.excluded
    .filter(({ text }) => tokens.every((t) => match(t, text) > 0))
    .map((e) => e.entry);

  return {
    networks: scored.slice(0, limit).map((s) => s.network),
    unsupported: unsupported.slice(0, limit),
  };
}
