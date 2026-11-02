import { describe, expect, it } from 'vitest';
import snapshot from '../data/catalog.json';
import { LICENCES, catalogSchema } from '../src/catalog/schema';
import type { Catalog, CatalogNetwork } from '../src/catalog/schema';
import { fold, searchCatalog } from '../src/catalog/search';

const catalog = catalogSchema.parse(snapshot);

describe('committed snapshot', () => {
  it.each(['Vélib', "Vélo'v", 'STAR'])('contains %s', (name) => {
    expect(catalog.networks.some((n) => n.name.includes(name))).toBe(true);
  });

  it('serves only open licences, with unique ids and full attribution', () => {
    const ids = new Set(catalog.networks.map((n) => n.id));
    expect(ids.size).toBe(catalog.networks.length);
    for (const n of catalog.networks) {
      expect(LICENCES).toContain(n.licence);
      expect(n.publisher).not.toBe('');
      expect(n.pageUrl).toMatch(/^https:\/\/transport\.data\.gouv\.fr\/datasets\//);
      expect(n.stationCount).toBeGreaterThan(0);
    }
  });
});

describe('search (R21)', () => {
  const network = (over: Partial<CatalogNetwork>): CatalogNetwork => ({
    id: 'x',
    slug: 'x',
    systemId: 'x',
    name: 'X',
    systemName: 'X',
    title: 'X',
    areas: [],
    gbfsVersion: '2.3',
    discoveryUrl: 'https://x.test/gbfs.json',
    stationCount: 1,
    publisher: 'P',
    licence: 'lov2',
    pageUrl: 'https://transport.data.gouv.fr/datasets/x',
    updated: '2026-01-01',
    ...over,
  });
  const fixture: Catalog = {
    generatedAt: '2026-11-02',
    source: 'test',
    networks: [
      network({
        id: 'velov',
        name: "Vélo'v Lyon",
        areas: ['Métropole de Lyon'],
        stationCount: 400,
      }),
      network({ id: 'velivert', name: 'VéliVert', areas: ['Saint-Étienne Métropole'] }),
      network({ id: 'lyon-small', name: 'Other', title: 'Petit réseau lyonnais', areas: [] }),
    ],
    excluded: [
      { slug: 'tier-dott-gbfs-lyon', title: 'Vélos et trottinettes Dott Lyon', reason: 'r' },
    ],
  };

  it.each(['velov', "Vélo'v", 'lyon', 'VELO V'])('"%s" finds Vélo\'v first', (q) => {
    expect(searchCatalog(fixture, q, 5).networks[0]?.id).toBe('velov');
  });

  it('folds accents and punctuation', () => {
    expect(fold('Saint-Étienne')).toBe('saintetienne');
    expect(searchCatalog(fixture, 'saint etienne', 5).networks.map((n) => n.id)).toEqual([
      'velivert',
    ]);
  });

  it('reports excluded datasets that match, with their reason', () => {
    expect(searchCatalog(fixture, 'dott', 5)).toEqual({
      networks: [],
      unsupported: [
        { slug: 'tier-dott-gbfs-lyon', title: 'Vélos et trottinettes Dott Lyon', reason: 'r' },
      ],
    });
  });

  it.each([
    ['velov', 'ViVélo Vichy', []],
    ['bourg', 'Vélhop Strasbourg', []],
    ['velo', 'ViVélo Vichy', ['x']],
    ['toulouse', 'VélôToulouse', ['x']],
    ['agglomeration', "Vélos de l'agglomération", ['x']],
    ['velostan', 'VélOstan’lib', ['x']],
  ])('"%s" against "%s" matches word starts only', (query, name, ids) => {
    const one: Catalog = { ...fixture, networks: [network({ name })], excluded: [] };
    expect(searchCatalog(one, query, 5).networks.map((n) => n.id)).toEqual(ids);
  });

  it('returns nothing for an empty query and honours the limit', () => {
    expect(searchCatalog(fixture, ' - ', 5).networks).toEqual([]);
    expect(searchCatalog(fixture, 'lyon', 1).networks).toHaveLength(1);
  });
});
