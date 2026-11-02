// Rebuilds packages/gbfs-core/data/catalog.json and the README network lists (run weekly by CI).
import { readFile, writeFile } from 'node:fs/promises';
import { CATALOG_API, buildCatalog, renderNetworkList } from './catalog-builder';

const OUT = new URL('../packages/gbfs-core/data/catalog.json', import.meta.url);
const READMES = ['../README.md', '../README.fr.md'].map((p) => new URL(p, import.meta.url));
const HEADERS = {
  'User-Agent': 'gbfs-france-catalog (+https://github.com/Timi-Duban/gbfs-france)',
};

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const catalog = await buildCatalog(
  await fetchJson(CATALOG_API),
  fetchJson,
  new Date().toISOString(),
);
await writeFile(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
for (const readme of READMES) {
  await writeFile(readme, renderNetworkList(await readFile(readme, 'utf8'), catalog));
}
console.log(`${catalog.networks.length} networks, ${catalog.excluded.length} excluded datasets.`);
for (const required of ['Vélib', "Vélo'v", 'STAR']) {
  if (!catalog.networks.some((n) => n.name.includes(required) || n.title.includes(required))) {
    console.error(`Missing expected network: ${required}`);
    process.exitCode = 1;
  }
}
