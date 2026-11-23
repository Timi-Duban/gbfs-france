import { describe, expect, it } from 'vitest';
import snapshot from '../data/catalog.json';
import { locateNetworks } from '../src/catalog/locate';
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
      const [minLat, minLon, maxLat, maxLon] = n.bbox;
      expect(minLat).toBeLessThanOrEqual(maxLat);
      expect(minLon).toBeLessThanOrEqual(maxLon);
    }
  });
});

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
  bbox: [0, 0, 0, 0],
  publisher: 'P',
  licence: 'lov2',
  pageUrl: 'https://transport.data.gouv.fr/datasets/x',
  updated: '2026-01-01',
  ...over,
});

describe('search', () => {
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

describe('locateNetworks', () => {
  const city = network({ id: 'city', bbox: [45.7, 4.8, 45.8, 4.9] });
  const region = network({ id: 'region', bbox: [45, 4, 47, 6] });
  const far = network({ id: 'far', bbox: [48.8, 2.2, 48.9, 2.4] });
  // Tiny box ~1.3 km away: distance must outrank its small area.
  const beside = network({ id: 'beside', bbox: [45.762, 4.85, 45.763, 4.851] });

  it('keeps boxes within range, inside first, the smaller box on ties', () => {
    const r = locateNetworks([beside, region, far, city], { lat: 45.75, lon: 4.85 }, 2000);
    expect(r.map((l) => l.network.id)).toEqual(['city', 'region', 'beside']);
    expect(r.slice(0, 2).map((l) => l.distanceMeters)).toEqual([0, 0]);
  });

  it('measures the distance to the nearest box edge', () => {
    const [l] = locateNetworks([city], { lat: 45.81, lon: 4.85 }, 2000);
    expect(l?.distanceMeters).toBeGreaterThan(1000);
    expect(l?.distanceMeters).toBeLessThan(1200);
    expect(locateNetworks([city], { lat: 45.9, lon: 4.85 }, 2000)).toEqual([]);
  });

  it('finds Vélib from central Paris in the committed snapshot', () => {
    const [first] = locateNetworks(catalog.networks, { lat: 48.8566, lon: 2.3522 }, 2000);
    expect(first?.network.name).toMatch(/Vélib/);
  });
});
