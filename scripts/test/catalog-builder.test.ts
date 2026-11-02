import { describe, expect, it } from 'vitest';
import { fixtures } from '../../packages/gbfs-core/test/helpers';
import { buildCatalog } from '../catalog-builder';
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

  it('keeps docked bike networks with an open licence, including unversioned Vélib (R19)', () => {
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

  it('excludes non-open licences, other vehicle kinds and free-floating (R2/R3)', () => {
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

  it('keeps the highest version when a system is published twice (R21)', () => {
    const brive = catalog.networks.filter((n) => n.slug === 'vls-ca-bassin-de-brive-velibeo');
    expect(brive).toHaveLength(1);
    expect(brive[0]?.gbfsVersion).toBe('3.0');
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
});
