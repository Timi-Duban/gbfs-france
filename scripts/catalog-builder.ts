import { z } from 'zod';
import { LICENCES } from '../packages/gbfs-core/src/catalog/schema';
import type { Catalog, CatalogNetwork } from '../packages/gbfs-core/src/catalog/schema';
import { fold } from '../packages/gbfs-core/src/catalog/search';
import {
  adapterFor,
  isSupportedVersion,
  parseDiscovery,
  versionRank,
} from '../packages/gbfs-core/src/feeds/discovery';

export const CATALOG_API = 'https://transport.data.gouv.fr/api/datasets';

const datasetSchema = z.object({
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  licence: z.string(),
  page_url: z.string(),
  updated: z.string(),
  sub_types: z.array(z.string()).nullish(),
  publisher: z.object({ name: z.string() }).nullish(),
  covered_area: z.array(z.object({ nom: z.string() })).nullish(),
  resources: z.array(
    z.object({ format: z.string().nullish(), original_url: z.string().nullish() }),
  ),
});
type Dataset = z.infer<typeof datasetSchema>;

export type FetchJson = (url: string) => Promise<unknown>;

interface Candidate {
  systemId: string;
  name: string;
  version: string;
  discoveryUrl: string;
  stationCount: number;
}

const OPEN_LICENCES: ReadonlySet<string> = new Set(LICENCES);

function isOpenLicence(licence: string): licence is CatalogNetwork['licence'] {
  return OPEN_LICENCES.has(licence);
}

/** Probes one gbfs resource; returns a docked-bike candidate or the reason it is excluded. */
async function probe(url: string, fetchJson: FetchJson): Promise<Candidate | string> {
  let raw: unknown;
  try {
    raw = await fetchJson(url);
  } catch {
    return 'feed unreachable when the catalog was built';
  }
  let discovery;
  try {
    discovery = parseDiscovery(raw);
  } catch {
    return 'the catalog URL is not a GBFS discovery file (gbfs.json)';
  }
  if (!isSupportedVersion(discovery.version))
    return `GBFS version ${discovery.version} is not supported`;
  const { station_information: infoUrl, station_status: statusUrl } = discovery.feeds;
  if (!infoUrl || !statusUrl) return 'no station feeds (free-floating only)';
  const adapter = adapterFor(discovery.version);
  let stationCount: number;
  try {
    stationCount = adapter.stationInformation(await fetchJson(infoUrl)).length;
  } catch {
    return 'station_information unreachable or invalid when the catalog was built';
  }
  if (stationCount === 0) return 'no stations (free-floating only)';
  let systemId = url;
  let name = '';
  const systemUrl = discovery.feeds['system_information'];
  if (systemUrl) {
    try {
      const system = adapter.systemInformation(await fetchJson(systemUrl));
      systemId = system.id;
      if (system.name.trim()) name = system.name.trim();
    } catch {
      // Keep the URL as system id and the dataset title as name.
    }
  }
  return { systemId, name, version: discovery.version, discoveryUrl: url, stationCount };
}

/** Curated "VLS <name> <city>" titles read better than operator system names ("Paris"). */
function displayName(title: string, systemName: string, single: boolean): string {
  const curated = title.match(/^VLS\s+(.+)$/i)?.[1];
  if (single && curated) return curated.trim();
  return systemName || curated?.trim() || title;
}

/** Keeps open-licence docked-bike systems (GBFS 1.x+), with unique ids. */
export async function buildCatalog(
  rawDatasets: unknown,
  fetchJson: FetchJson,
  generatedAt: string,
  concurrency = 8,
): Promise<Catalog> {
  const datasets = z
    .array(z.unknown())
    .parse(rawDatasets)
    .flatMap((d) => {
      const r = datasetSchema.safeParse(d);
      return r.success && r.data.type === 'vehicles-sharing' ? [r.data] : [];
    });

  const results = await mapLimit(datasets, concurrency, (d) => buildDataset(d, fetchJson));
  const networks = results.flatMap((r) => r.networks).sort((a, b) => a.id.localeCompare(b.id));
  const excluded = results
    .flatMap((r) => (r.excluded ? [r.excluded] : []))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return { generatedAt, source: CATALOG_API, networks, excluded };
}

async function buildDataset(d: Dataset, fetchJson: FetchJson) {
  const exclude = (reason: string) => ({
    networks: [],
    excluded: { slug: d.slug, title: d.title, reason },
  });
  if (!isOpenLicence(d.licence)) {
    return exclude(
      `licence "${d.licence}" is not an open licence served here (lov2, fr-lo, odc-odbl)`,
    );
  }
  const subTypes = d.sub_types ?? [];
  if (!subTypes.includes('bicycle')) {
    return exclude(`not a bike-share network (${subTypes.join(', ') || 'no vehicle type'})`);
  }
  if (subTypes.includes('freefloating')) {
    return exclude('free-floating network: only docked stations are served for now');
  }
  const urls = [
    ...new Set(
      d.resources.flatMap((r) => (r.format === 'gbfs' && r.original_url ? [r.original_url] : [])),
    ),
  ];
  const candidates: Candidate[] = [];
  const reasons: string[] = [];
  for (const url of urls) {
    const c = await probe(url, fetchJson);
    if (typeof c === 'string') reasons.push(c);
    else candidates.push(c);
  }
  // Same system published in several versions (same system_id or same name): keep the highest one.
  const systems: Candidate[] = [];
  for (const c of candidates.sort((a, b) => versionRank(b.version) - versionRank(a.version))) {
    const duplicate = systems.some(
      (s) => s.systemId === c.systemId || (c.name !== '' && fold(s.name) === fold(c.name)),
    );
    if (!duplicate) systems.push(c);
  }
  if (systems.length === 0) return exclude(reasons[0] ?? 'no GBFS feed listed');
  const licence = d.licence;
  return {
    networks: systems.map((c): CatalogNetwork => ({
      id: systems.length === 1 ? d.slug : `${d.slug}:${c.systemId}`,
      slug: d.slug,
      systemId: c.systemId,
      name: displayName(d.title, c.name, systems.length === 1),
      systemName: c.name,
      title: d.title,
      areas: (d.covered_area ?? []).map((a) => a.nom),
      gbfsVersion: c.version,
      discoveryUrl: c.discoveryUrl,
      stationCount: c.stationCount,
      publisher: d.publisher?.name ?? 'unknown',
      licence,
      pageUrl: d.page_url,
      updated: d.updated,
    })),
    excluded: undefined,
  };
}

const LIST_START = '<!-- networks:start -->';
const LIST_END = '<!-- networks:end -->';

/** Replaces the generated network list between markers in a README. */
export function renderNetworkList(readme: string, catalog: Catalog): string {
  const names = [...new Set(catalog.networks.map((n) => n.name))].sort((a, b) =>
    a.localeCompare(b, 'fr'),
  );
  const date = catalog.generatedAt.slice(0, 10);
  const body = `${names.length} networks (snapshot ${date}): ${names.join(', ')}.`;
  const start = readme.indexOf(LIST_START);
  const end = readme.indexOf(LIST_END);
  if (start < 0 || end < start) return readme;
  return `${readme.slice(0, start + LIST_START.length)}\n\n${body}\n\n${readme.slice(end)}`;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  const queue = items.map((item, index) => ({ item, index }));
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) out[job.index] = await fn(job.item);
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
