import { afterEach, describe, expect, it, vi } from 'vitest';
import snapshot from '../data/catalog.json';
import { createGbfsFrance } from '../src';
import type { FetchLike, GbfsErrorKind, Result } from '../src';
import { FIXTURE_NOW_MS as NOW, clone, fakeFetch, feedName, fixtures } from './helpers';
import type { Feeds } from './helpers';

const VELIB = 'velib-velos-et-bornes-disponibilite-temps-reel';
const NAOLIB =
  snapshot.networks.find((n) => n.gbfsVersion === '3.0' && n.name.startsWith('Naolib Nantes'))
    ?.id ?? '';
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

describe('typed errors: never throws', () => {
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

  it('unknown-network and not-supported-network ids', async () => {
    const gbfs = client({});
    const unknown = await gbfs.nearbyStations('nope', NEAR_FIRST_VELIB);
    expect(unknown).toMatchObject({ ok: false, error: { kind: 'unknown-network' } });
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

describe('locateNetworks', () => {
  it('lists networks around a point with distance and attribution', async () => {
    const r = await client({}).locateNetworks(NEAR_FIRST_VELIB);
    expect(r.ok && r.data.networks[0]).toMatchObject({
      id: VELIB,
      distanceMeters: 0,
      attribution: { licence: 'odc-odbl' },
    });
  });
});

describe('nearbyStationsAround', () => {
  it('finds the network from coordinates alone', async () => {
    const r = await client(fixtures.v1).nearbyStationsAround(NEAR_FIRST_VELIB);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.failures).toEqual([]);
    expect(r.data.results.map((n) => n.network.id)).toEqual([VELIB]);
    expect(r.data.results[0]?.stations[0]?.id).toBe('213688169');
  });

  it('returns no result and fetches nothing far from every network', async () => {
    const calls: string[] = [];
    const r = await client(fixtures.v1, calls).nearbyStationsAround({ lat: 46.5, lon: -4 });
    expect(r).toEqual({ ok: true, data: { results: [], failures: [] } });
    expect(calls).toEqual([]);
  });

  it('keeps answering when one candidate fails, and errors when all do', async () => {
    const down: FetchLike = () => Promise.reject(new TypeError('down'));
    const r = await createGbfsFrance({ fetch: down, now: () => NOW }).nearbyStationsAround(
      NEAR_FIRST_VELIB,
    );
    expect(errorKind(r)).toBe('unreachable');

    // Nantes: Naolib (served) and Naolib Micromob' (down) both cover the point.
    const naolib = fakeFetch(fixtures.v30);
    const micromobDown: FetchLike = (url, init) =>
      url.includes('chantrerie') ? Promise.reject(new TypeError('down')) : naolib(url, init);
    const partial = await createGbfsFrance({
      fetch: micromobDown,
      now: () => NOW,
    }).nearbyStationsAround({ lat: 47.2198, lon: -1.5549 });
    if (!partial.ok) throw new Error(partial.error.message);
    expect(partial.data.results.map((n) => n.network.id)).toEqual([NAOLIB]);
    expect(partial.data.failures).toMatchObject([{ kind: 'unreachable' }]);
  });

  it('leaves out a candidate network with no station in range', async () => {
    const calls: string[] = [];
    // Inside the Vélib box, > 5 km from the 3 fixture stations.
    const r = await client(fixtures.v1, calls).nearbyStationsAround({ lat: 48.8566, lon: 2.3522 });
    expect(r).toEqual({ ok: true, data: { results: [], failures: [] } });
    expect(calls.length).toBeGreaterThan(0);
  });

  it('orders networks by their nearest station', async () => {
    const at = { lat: 47.2198, lon: -1.5549 };
    const micromobId = snapshot.networks.find((n) => n.discoveryUrl.includes('chantrerie'))?.id;
    // Micromob gets its own feed URLs, with every station moved onto the point.
    const gbfs: unknown = JSON.parse(
      JSON.stringify(fixtures.v30.gbfs).replaceAll(
        'https://api.cyclocity.fr/contracts/nantes/gbfs/v3/',
        'https://micromob.test/',
      ),
    );
    const info = clone(fixtures.v30.station_information);
    for (const s of info.data.stations) Object.assign(s, at);
    const micromob = fakeFetch({ ...fixtures.v30, gbfs, station_information: info });
    const naolib = fakeFetch(fixtures.v30);
    const fetch: FetchLike = (url, init) =>
      /chantrerie|micromob\.test/.test(url) ? micromob(url, init) : naolib(url, init);
    const r = await createGbfsFrance({ fetch, now: () => NOW }).nearbyStationsAround(at);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.results.map((n) => n.network.id)).toEqual([micromobId, NAOLIB]);
    expect(r.data.results.map((n) => n.nearestDistanceMeters)).toEqual([0, expect.any(Number)]);
  });
});
