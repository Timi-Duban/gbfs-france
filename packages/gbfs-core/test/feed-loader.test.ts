import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedFailure } from '../src/errors';
import { FeedLoader } from '../src/fetch/feed-loader';
import { cacheSeconds } from '../src/fetch/policy';
import type { FetchLike } from '../src/types';
import { json } from './helpers';

const MIN = 60_000;
const identity = (raw: unknown) => raw;

function setup(fetch: FetchLike) {
  let now = 1_000_000;
  const loader = new FeedLoader({ fetch, resolveUrl: (u) => u, now: () => now, headers: {} });
  return { loader, advance: (ms: number) => (now += ms) };
}

describe('cache policy', () => {
  it.each([
    ['station_status', 0, 30],
    ['station_status', 3600, 60],
    ['station_status', 45, 45],
    ['station_status', undefined, 60],
    ['station_information', 0, 300],
    ['station_information', 86_400 * 7, 86_400],
    ['discovery', 3600, 3600],
    ['vehicle_types', undefined, 300],
  ] as const)('%s ttl %s -> %s s', (kind, ttl, expected) => {
    expect(cacheSeconds(kind, ttl)).toBe(expected);
  });
});

describe('FeedLoader', () => {
  afterEach(() => vi.useRealTimers());

  it('serves from cache until the clamped ttl expires (Cache-Aside)', async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ ttl: 3600, n: 1 }));
    const { loader, advance } = setup(fetch);
    await loader.load('u', 'station_status', identity);
    advance(59_000);
    await loader.load('u', 'station_status', identity);
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(2000);
    await loader.load('u', 'station_status', identity);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('merges concurrent identical requests into one fetch (single-flight)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn<FetchLike>(async () => {
      await gate;
      return json({ ttl: 60 });
    });
    const { loader } = setup(fetch);
    const calls = Array.from({ length: 10 }, () => loader.load('u', 'station_status', identity));
    release();
    await Promise.all(calls);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('passes headers, the abort signal and resolveUrl to fetch', async () => {
    const fetch = vi.fn<FetchLike>(async () => json({}));
    const loader = new FeedLoader({
      fetch,
      resolveUrl: (u) => `https://proxy.test/?url=${encodeURIComponent(u)}`,
      now: () => 0,
      headers: { 'User-Agent': 'test' },
    });
    await loader.load('https://a.test/gbfs.json', 'discovery', identity);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://proxy.test/?url=https%3A%2F%2Fa.test%2Fgbfs.json');
    expect(init?.headers).toEqual({ 'User-Agent': 'test' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts after 8 s with a typed timeout error', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch: FetchLike = (_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    };
    const { loader } = setup(fetch);
    const pending = loader.load('u', 'station_status', identity);
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    ['HTTP error', async () => ({ ok: false, status: 503, json: async () => ({}) }), 'unreachable'],
    ['network error', async () => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
    [
      'bad JSON',
      async () => ({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError()) }),
      'invalid-feed',
    ],
  ] as const)('maps %s to %s', async (_label, fetch, kind) => {
    const { loader } = setup(fetch);
    await expect(loader.load('u', 'station_status', identity)).rejects.toMatchObject({ kind });
  });

  it('does not cache a payload the parser rejects', async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ ttl: 60 }));
    const { loader } = setup(fetch);
    const reject = () => {
      throw new FeedFailure('invalid-feed', 'bad');
    };
    await expect(loader.load('u', 'station_status', reject)).rejects.toThrow('bad');
    await loader.load('u', 'station_status', identity);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  describe('stale-if-error', () => {
    async function primedThenFailing() {
      let fail = false;
      const fetch: FetchLike = async () =>
        fail ? { ok: false, status: 500, json: async () => ({}) } : json({ ttl: 60, n: 1 });
      const ctx = setup(fetch);
      await ctx.loader.load('u', 'station_status', identity);
      fail = true;
      return ctx;
    }

    it('serves the last good data 9 min after expiry, flagged stale', async () => {
      const { loader, advance } = await primedThenFailing();
      advance(MIN + 9 * MIN);
      const r = await loader.load('u', 'station_status', identity);
      expect(r).toMatchObject({ stale: true, value: { n: 1 } });
    });

    it('refuses data 11 min after expiry', async () => {
      const { loader, advance } = await primedThenFailing();
      advance(MIN + 11 * MIN);
      await expect(loader.load('u', 'station_status', identity)).rejects.toMatchObject({
        kind: 'unreachable',
      });
    });
  });

  it('evicts the least recently used entry past 64 feeds, without stale resurrection', async () => {
    let fail = false;
    const fetch = vi.fn<FetchLike>(async () =>
      fail ? { ok: false, status: 500, json: async () => ({}) } : json({ ttl: 60 }),
    );
    const { loader } = setup(fetch);
    for (let i = 0; i < 64; i++) await loader.load(`u${i}`, 'station_status', identity);
    await loader.load('u0', 'station_status', identity); // u0 becomes most recent, u1 is now oldest
    await loader.load('u64', 'station_status', identity); // 65th entry evicts u1
    expect(fetch).toHaveBeenCalledTimes(65);
    await loader.load('u0', 'station_status', identity);
    expect(fetch).toHaveBeenCalledTimes(65);
    fail = true;
    await expect(loader.load('u1', 'station_status', identity)).rejects.toMatchObject({
      kind: 'unreachable',
    });
  });
});
