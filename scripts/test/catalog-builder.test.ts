import { describe, expect, it } from 'vitest';
import { fixtures } from '../../packages/gbfs-core/test/helpers';
import { boundingBox, buildCatalog } from '../catalog-builder';
import datasets from './fixtures/datasets.json';

const VELIB = 'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json';
const VELOV = 'https://download.data.grandlyon.com/files/rdata/jcd_jcdecaux.jcdvelov/gbfs.json';
const AMIENS = 'https://api.cyclocity.fr/contracts/amiens/gbfs';
const BRIVE_V3 = 'https://api.gbfs.ecovelo.mobi/velibeo/gbfs.json';
const BRIVE_V23 = 'https://mobi-iti-nam.okina.fr/api-proxy/api/gbfs/1.0/gbfs/velibeo_ecovelo/gbfs';

/** Copies a discovery document with every `{ name, url }` feed pointing under `base`. */
function rewriteFeeds(node: unknown, base: string): unknown {
  if (Array.isArray(node)) return node.map((n) => rewriteFeeds(n, base));
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = rewriteFeeds(v, base);
  if (typeof out['name'] === 'string' && typeof out['url'] === 'string') {
    out['url'] = `${base}/${out['name']}.json`;
  }
  return out;
}

/** Serves a fixture set under a base URL. */
function serve(base: string, set: Record<string, unknown>, discoveryUrl = `${base}/gbfs.json`) {
  const routes = new Map<string, unknown>();
  routes.set(discoveryUrl, rewriteFeeds(set['gbfs'], base));
  for (const [name, body] of Object.entries(set))
    if (name !== 'gbfs') routes.set(`${base}/${name}.json`, body);
  return routes;
}

const routes = new Map<string, unknown>([
  ...serve('https://velib.test', fixtures.v1, VELIB),
  ...serve('https://velov.test', fixtures.v23, VELOV),
  ...serve('https://amiens.test', fixtures.v23, `${AMIENS}/gbfs.json`),
  [`${AMIENS}/v2/station_information.json`, fixtures.v23.station_information],
  ...serve('https://brive3.test', fixtures.v30, BRIVE_V3),
  // Same system as the 3.0 feed, published again in 2.3.
  ...serve(
    'https://brive23.test',
    { ...fixtures.v23, system_information: { data: { system_id: 'nantes', name: 'Naolib' } } },
    BRIVE_V23,
  ),
]);

async function fetchJson(url: string): Promise<unknown> {
  if (!routes.has(url)) throw new Error(`unreachable ${url}`);
  return routes.get(url);
}

describe('buildCatalog', async () => {
  const catalog = await buildCatalog(datasets, fetchJson, '2026-11-02T00:00:00.000Z');
  const ids = catalog.networks.map((n) => n.id);
  const reason = (slug: string) => catalog.excluded.find((e) => e.slug === slug)?.reason;

  it('keeps docked bike networks with an open licence, including unversioned Vélib', () => {
    const velib = catalog.networks.find((n) => n.slug.startsWith('velib'));
    expect(velib).toMatchObject({
      gbfsVersion: '1.x',
      name: 'Vélib Paris et communes limitrophes',
      licence: 'odc-odbl',
      publisher: 'Ville de Paris',
      stationCount: 3,
      areas: ['Île-de-France'],
    });
    expect(ids).toContain('stations-velov-de-la-metropole-de-lyon-disponibilites-temps-reel');
  });

  it('excludes non-open licences, other vehicle kinds and free-floating', () => {
    expect(reason('tier-dott-gbfs-lyon')).toMatch(/licence "notspecified"/);
    expect(
      reason('offre-et-disponibilite-temps-reel-du-service-citiz-en-autopartage-metropole-de-lyon'),
    ).toMatch(/carsharing/);
    expect(reason('gbfs-lille')).toMatch(/free-floating/);
    expect(reason('base-nationale-des-lieux-de-covoiturage')).toBeUndefined(); // not vehicle sharing
  });

  it('ignores catalog URLs that are not discovery files', () => {
    expect(ids.filter((id) => id.startsWith('velo-en-libre-service-de-la-ville-damiens'))).toEqual([
      'velo-en-libre-service-de-la-ville-damiens',
    ]);
  });

  it('keeps the highest version when a system is published twice', () => {
    const brive = catalog.networks.filter((n) => n.slug === 'vls-ca-bassin-de-brive-velibeo');
    expect(brive).toHaveLength(1);
    expect(brive[0]?.gbfsVersion).toBe('3.0');
  });

  it('treats feeds with the same stations as one system when system_information is missing', async () => {
    const [brive] = datasets.filter((d) => d.slug === 'vls-ca-bassin-de-brive-velibeo');
    const noSystem = Object.fromEntries(
      Object.entries(fixtures.v30).filter(([feed]) => feed !== 'system_information'),
    );
    for (const [url, body] of serve('https://nosys.test', noSystem)) routes.set(url, body);
    const twice = {
      ...brive,
      slug: 'twice',
      resources: [
        { format: 'gbfs', original_url: BRIVE_V3 },
        { format: 'gbfs', original_url: 'https://nosys.test/gbfs.json' },
      ],
    };
    const r = await buildCatalog([twice], fetchJson, '2026-11-02');
    expect(r.networks.map((n) => n.id)).toEqual(['twice']);
  });

  it('suffixes ids with the system id when a dataset holds several systems', async () => {
    const [velov] = datasets.filter((d) => d.slug.startsWith('stations-velov'));
    const multi = {
      ...velov,
      slug: 'multi',
      resources: [
        { format: 'gbfs', original_url: VELOV },
        { format: 'gbfs', original_url: BRIVE_V3 },
      ],
    };
    const r = await buildCatalog([multi], fetchJson, '2026-11-02');
    expect(r.networks.map((n) => n.id)).toEqual(['multi:lyon', 'multi:nantes']);
  });

  it('records unreachable feeds as an exclusion reason', async () => {
    const [velov] = datasets.filter((d) => d.slug.startsWith('stations-velov'));
    const down = {
      ...velov,
      slug: 'down',
      resources: [{ format: 'gbfs', original_url: 'https://down.test/gbfs.json' }],
    };
    const r = await buildCatalog([down], fetchJson, '2026-11-02');
    expect(r.excluded).toEqual([
      { slug: 'down', title: velov?.title, reason: expect.stringMatching(/unreachable/) },
    ]);
  });

  it('excludes networks whose stations are all 0/0 placeholders', async () => {
    const [velov] = datasets.filter((d) => d.slug.startsWith('stations-velov'));
    const info = structuredClone(fixtures.v23.station_information);
    for (const s of info.data.stations) Object.assign(s, { lat: 0, lon: 0 });
    const nowhere = 'https://nowhere.test';
    for (const [url, body] of serve(nowhere, { ...fixtures.v23, station_information: info }))
      routes.set(url, body);
    const r = await buildCatalog(
      [
        {
          ...velov,
          slug: 'nowhere',
          resources: [{ format: 'gbfs', original_url: `${nowhere}/gbfs.json` }],
        },
      ],
      fetchJson,
      '2026-11-02',
    );
    expect(r.excluded).toEqual([
      { slug: 'nowhere', title: velov?.title, reason: 'no station has usable coordinates' },
    ]);
  });
});

describe('boundingBox', () => {
  const at = (lat: number, lon: number) => ({
    id: '',
    name: '',
    lat,
    lon,
    address: null,
    capacity: null,
  });

  it('ignores 0/0 placeholders and out-of-range coordinates', () => {
    expect(boundingBox([at(48.85, 2.35), at(0, 0), at(91, 2), at(48.9, 2.412345)])).toEqual([
      48.85, 2.35, 48.9, 2.4124,
    ]);
  });

  it('leaves out a stray station far from the rest', () => {
    const lyon = [at(45.75, 4.83), at(45.76, 4.85), at(45.74, 4.82), at(45.77, 4.86)];
    expect(boundingBox([...lyon, at(48.8, 1.95)])).toEqual([45.74, 4.82, 45.77, 4.86]);
  });

  it('keeps every city of a regional network', () => {
    const nancy = [at(48.69, 6.18), at(48.7, 6.19)];
    const metz = [at(49.12, 6.17), at(49.11, 6.18)];
    const strasbourg = [at(48.58, 7.75), at(48.59, 7.74)];
    expect(boundingBox([...nancy, ...metz, ...strasbourg])).toEqual([48.58, 6.17, 49.12, 7.75]);
  });

  it('keeps a smaller town of a regional network', () => {
    const strasbourg = Array.from({ length: 20 }, (_, i) =>
      at(48.57 + i * 0.002, 7.74 + i * 0.002),
    );
    const mulhouse = [at(47.75, 7.33), at(47.76, 7.34)];
    expect(boundingBox([...strasbourg, ...mulhouse])).toEqual([47.75, 7.33, 48.608, 7.778]);
  });

  it('returns null when no station is usable', () => {
    expect(boundingBox([at(0, 0)])).toBeNull();
  });
});
