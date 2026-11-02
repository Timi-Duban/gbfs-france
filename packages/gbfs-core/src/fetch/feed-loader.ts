import { FeedFailure } from '../errors';
import { readTtl } from '../feeds/envelope';
import type { FetchLike } from '../types';
import { Lru } from './lru';
import type { FeedKind } from './policy';
import { MAX_ENTRIES, STALE_IF_ERROR_MS, TIMEOUT_MS, cacheSeconds } from './policy';

// Holds the parsed value: one URL is always read with the same parser.
interface Entry {
  value: unknown;
  fetchedAt: number;
  expiresAt: number;
}

export interface Loaded<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

export interface FeedLoaderOptions {
  fetch: FetchLike;
  resolveUrl: (url: string) => string;
  now: () => number;
  headers: Record<string, string>;
}

/** Cache-Aside with single-flight per URL, timeout, LRU bound and stale-if-error. */
export class FeedLoader {
  private readonly cache = new Lru<Entry>(MAX_ENTRIES);
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly opts: FeedLoaderOptions) {}

  /** `parse` validates the payload; only payloads it accepts are cached. Throws `FeedFailure`. */
  async load<T>(url: string, kind: FeedKind, parse: (raw: unknown) => T): Promise<Loaded<T>> {
    const cached = this.cache.get(url);
    const now = this.opts.now();
    if (cached && now < cached.expiresAt) {
      return { value: cached.value as T, fetchedAt: cached.fetchedAt, stale: false };
    }
    try {
      const raw = await this.fetchOnce(url);
      const value = parse(raw);
      const fetchedAt = this.opts.now();
      const expiresAt = fetchedAt + cacheSeconds(kind, readTtl(raw)) * 1000;
      this.cache.set(url, { value, fetchedAt, expiresAt });
      return { value, fetchedAt, stale: false };
    } catch (err) {
      // Only an entry still in the LRU can be served stale: evicted data is never resurrected.
      const last = this.cache.get(url);
      if (
        err instanceof FeedFailure &&
        last &&
        this.opts.now() - last.expiresAt <= STALE_IF_ERROR_MS
      ) {
        return { value: last.value as T, fetchedAt: last.fetchedAt, stale: true };
      }
      throw err;
    }
  }

  private fetchOnce(url: string): Promise<unknown> {
    const pending = this.inflight.get(url);
    if (pending) return pending;
    const request = this.request(url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, request);
    return request;
  }

  private async request(url: string): Promise<unknown> {
    // setTimeout + AbortController instead of AbortSignal.timeout, which Hermes lacks.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new FeedFailure('timeout', `No answer within ${TIMEOUT_MS / 1000} s.`));
      }, TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.download(url, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async download(url: string, signal: AbortSignal): Promise<unknown> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.opts.fetch(this.opts.resolveUrl(url), {
        signal,
        headers: this.opts.headers,
      });
    } catch {
      throw new FeedFailure('unreachable', 'Network error.');
    }
    if (!res.ok) throw new FeedFailure('unreachable', `HTTP ${res.status}.`);
    try {
      return await res.json();
    } catch {
      throw new FeedFailure('invalid-feed', 'Response is not valid JSON.');
    }
  }
}
