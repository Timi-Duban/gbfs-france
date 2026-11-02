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

/**
 * Field words, joined across apostrophes ("Vélo'v" -> velov) and also split on them
 * ("d'agglomération" -> agglomeration) and on camel case ("VélôToulouse" -> toulouse).
 */
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

/**
 * Accent-insensitive word-prefix search: every query word must start a word of the network's
 * fields ("lyon" matches "Lyon" and "lyonnais", "velov" does not match "ViVélo").
 * Exact words in the name or area rank first, then larger networks.
 */
export function searchCatalog(catalog: Catalog, query: string, limit: number) {
  const tokens = queryWords(query);
  if (tokens.length === 0) return { networks: [], unsupported: [] };

  const scored: { network: CatalogNetwork; score: number }[] = [];
  for (const network of catalog.networks) {
    const primary = words([network.name, network.systemName, ...network.areas]);
    const all = words([
      network.name,
      network.systemName,
      network.title,
      network.publisher,
      network.slug,
      ...network.areas,
    ]);
    if (!tokens.every((t) => match(t, all) > 0)) continue;
    const score = tokens.reduce((sum, t) => sum + match(t, primary), 0);
    scored.push({ network, score });
  }
  scored.sort((a, b) => b.score - a.score || b.network.stationCount - a.network.stationCount);

  const unsupported = catalog.excluded.filter((e) => {
    const text = words([e.title, e.slug]);
    return tokens.every((t) => match(t, text) > 0);
  });

  return {
    networks: scored.slice(0, limit).map((s) => s.network),
    unsupported: unsupported.slice(0, limit),
  };
}
