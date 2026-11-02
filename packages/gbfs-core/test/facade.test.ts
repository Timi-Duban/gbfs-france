import { afterEach, describe, expect, it, vi } from 'vitest';
import snapshot from '../data/catalog.json';
import { createGbfsFrance } from '../src';
import type { FetchLike, GbfsErrorKind, Result } from '../src';
import { clone, fakeFetch, feedName, fixtures } from './helpers';
import type { Feeds } from './helpers';

const VELIB = 'velib-velos-et-bornes-disponibilite-temps-reel';
const NAOLIB =
  snapshot.networks.find((n) => n.gbfsVersion === '3.0' && n.name.startsWith('Naolib Nantes'))
    ?.id ?? '';
const NOW = 1_793_626_400_000;
const NEAR_FIRST_VELIB = { lat: 48.866, lon: 2.2757 };

function client(feeds: Feeds, calls: string[] = [], now = () => NOW) {
  return createGbfsFrance({ fetch: fakeFetch(feeds, calls), now });
}

function errorKind<T>(r: Result<T>): GbfsErrorKind | undefined {
  return r.ok ? undefined : r.error.kind;
}

describe('searchNetworks', () => {
  it('finds networks with attribution and the snapshot date', async () => {
    const r = await client({}).searchNetworks('velib');
    expect(r.ok && r.data.networks[0]).toMatchObject({
      id: VELIB,
      attribution: { licence: 'odc-odbl', publisher: 'Ville de Paris' },
    });
    expect(r.ok && r.data.snapshotDate).toBe(snapshot.generatedAt);
  });
});

describe('nearbyStations', () => {
  it('returns nearest stations with distance, freshness and attribution (1.x Vélib)', async () => {
    const r = await client(fixtures.v1).nearbyStations(VELIB, NEAR_FIRST_VELIB, { limit: 2 });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.stations).toHaveLength(1); // the other fixture stations are > 2 km away
    expect(r.data.stations[0]).toMatchObject({
      id: '213688169',
      bikes: 1,
      mechanical: 1,
      ebikes: 0,
    });
    expect(r.data.stations[0]?.distanceMeters).toBeLessThan(100);
    expect(r.data).toMatchObject({
      network: { id: VELIB },
      outsideNetworkArea: false,
      droppedStations: 0,
      freshness: { stale: false, ageSeconds: 0 },
      attribution: { licence: 'odc-odbl', sourceUrl: expect.stringContaining(VELIB) },
    });
  });

  it('reads a 3.0 network', async () => {
    const r = await client(fixtures.v30).nearbyStations(NAOLIB, { lat: 47.2198, lon: -1.5549 });
    expect(r.ok && r.data.stations[0]?.name).toBe('PRÉFECTURE');
  });

  it('filters by need', async () => {
    const r = await client(fixtures.v1).nearbyStations(VELIB, NEAR_FIRST_VELIB, {
      need: 'bikes',
      maxDistanceMeters: 10_000,
    });
    expect(r.ok && r.data.stations.every((s) => (s.bikes ?? 0) > 0 && s.isRenting)).toBe(true);
  });

  it('reports a point outside the network area with the nearest distance', async () => {
    const r = await client(fixtures.v1).nearbyStations(VELIB, { lat: 49.03, lon: 2.08 });
    expect(r.ok && r.data).toMatchObject({ stations: [], outsideNetworkArea: true });
    expect(r.ok && r.data.nearestDistanceMeters).toBeGreaterThan(20_000);
  });

  it('downloads each feed once for 10 concurrent calls (single-flight)', async () => {
    const calls: string[] = [];
    const gbfs = client(fixtures.v1, calls);
    await Promise.all(
      Array.from({ length: 10 }, () => gbfs.nearbyStations(VELIB, NEAR_FIRST_VELIB)),
    );
    expect(calls.map(feedName).sort()).toEqual(['gbfs', 'station_information', 'station_status']);
  });

  it('serves stale data flagged with its age when the operator goes down', async () => {
    let now = NOW;
    const feeds: Feeds = { ...fixtures.v1 };
    const gbfs = client(feeds, [], () => now);
    await gbfs.nearbyStations(VELIB, NEAR_FIRST_VELIB);
    delete feeds['station_status'];
    now += 5 * 60_000;
    const r = await gbfs.nearbyStations(VELIB, NEAR_FIRST_VELIB);
    expect(r.ok && r.data.freshness).toEqual({ stale: true, ageSeconds: 300 });
  });
});

describe('getStation', () => {
  it('returns one station', async () => {
    const r = await client(fixtures.v1).getStation(VELIB, '213688169');
    expect(r.ok && r.data.station).toMatchObject({
      name: 'Benjamin Godard - Victor Hugo',
      outdated: true, // reported 56 min before NOW
      reportedAgeSeconds: 3392,
    });
  });

  it('returns station-not-found with attribution', async () => {
    const r = await client(fixtures.v1).getStation(VELIB, 'nope');
    expect(r).toMatchObject({
      ok: false,
      error: { kind: 'station-not-found', attribution: { licence: 'odc-odbl' } },
    });
  });
});

describe('typed errors (R8/R13): never throws', () => {
  afterEach(() => vi.useRealTimers());

  const unsupportedVersion = {
    ...fixtures.v1,
    gbfs: { ...clone(fixtures.v1.gbfs), version: '4.0' },
  };

  it.each([
    ['unreachable', { ...fixtures.v1, station_status: undefined }],
    ['invalid-feed', { ...fixtures.v1, station_status: { data: {} } }],
    ['unsupported-version', unsupportedVersion],
  ] as const)('%s', async (kind, feeds) => {
    const defined = Object.fromEntries(Object.entries(feeds).filter(([, v]) => v !== undefined));
    const r = await client(defined).nearbyStations(VELIB, NEAR_FIRST_VELIB);
    expect(r).toMatchObject({
      ok: false,
      error: { kind, network: { id: VELIB }, attribution: { licence: 'odc-odbl' } },
    });
  });

  it('timeout', async () => {
    vi.useFakeTimers();
    const hang: FetchLike = () => new Promise(() => {});
    const pending = createGbfsFrance({ fetch: hang, now: () => NOW }).getStation(VELIB, '1');
    await vi.advanceTimersByTimeAsync(8000);
    expect(errorKind(await pending)).toBe('timeout');
  });

  it('not-supported-network for unknown and excluded ids', async () => {
    const gbfs = client({});
    const unknown = await gbfs.nearbyStations('nope', NEAR_FIRST_VELIB);
    expect(unknown).toMatchObject({ ok: false, error: { kind: 'not-supported-network' } });
    const excluded = snapshot.excluded[0];
    const r = await gbfs.getStation(excluded?.slug ?? '', '1');
    expect(r).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('not supported yet') },
    });
  });

  it('one broken network does not affect another', async () => {
    const naolib = fakeFetch(fixtures.v30);
    const fetch: FetchLike = (url, init) =>
      url.includes('velib') ? Promise.reject(new TypeError('down')) : naolib(url, init);
    const gbfs = createGbfsFrance({ fetch, now: () => NOW });
    const [velib, nantes] = await Promise.all([
      gbfs.nearbyStations(VELIB, NEAR_FIRST_VELIB),
      gbfs.nearbyStations(NAOLIB, { lat: 47.2198, lon: -1.5549 }),
    ]);
    expect(errorKind(velib)).toBe('unreachable');
    expect(nantes.ok).toBe(true);
  });
});
