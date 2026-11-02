import type { Catalog, CatalogNetwork } from './schema';

/** Lowercase, strip accents and punctuation: "Vélo'v" -> "velov", "Saint-Étienne" -> "saintetienne". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function tokens(query: string): string[] {
  return query
    .split(/[\s,;/]+/)
    .map(fold)
    .filter(Boolean);
}

function haystack(parts: string[]): string {
  return parts.map(fold).join('|');
}

/** Every query token must appear in the folded fields; name and area hits rank first. */
export function searchCatalog(catalog: Catalog, query: string, limit: number) {
  const words = tokens(query);
  if (words.length === 0) return { networks: [], unsupported: [] };

  const scored: { network: CatalogNetwork; score: number }[] = [];
  for (const network of catalog.networks) {
    const primary = haystack([network.name, network.systemName, ...network.areas]);
    const all = haystack([
      network.name,
      network.systemName,
      network.title,
      network.publisher,
      network.slug,
      ...network.areas,
    ]);
    if (!words.every((w) => all.includes(w))) continue;
    const score = words.filter((w) => primary.includes(w)).length;
    scored.push({ network, score });
  }
  scored.sort((a, b) => b.score - a.score || b.network.stationCount - a.network.stationCount);

  const unsupported = catalog.excluded.filter((e) => {
    const text = haystack([e.title, e.slug]);
    return words.every((w) => text.includes(w));
  });

  return {
    networks: scored.slice(0, limit).map((s) => s.network),
    unsupported: unsupported.slice(0, limit),
  };
}
