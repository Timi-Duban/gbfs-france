import v1Discovery from './fixtures/v1/gbfs.json';
import v1Info from './fixtures/v1/station_information.json';
import v1Status from './fixtures/v1/station_status.json';
import v1System from './fixtures/v1/system_information.json';
import v22Discovery from './fixtures/v22/gbfs.json';
import v22Info from './fixtures/v22/station_information.json';
import v22Status from './fixtures/v22/station_status.json';
import v22System from './fixtures/v22/system_information.json';
import v22Types from './fixtures/v22/vehicle_types.json';
import v23Discovery from './fixtures/v23/gbfs.json';
import v23Info from './fixtures/v23/station_information.json';
import v23Status from './fixtures/v23/station_status.json';
import v23System from './fixtures/v23/system_information.json';
import v23Types from './fixtures/v23/vehicle_types.json';
import v30Discovery from './fixtures/v30/gbfs.json';
import v30Info from './fixtures/v30/station_information.json';
import v30Status from './fixtures/v30/station_status.json';
import v30System from './fixtures/v30/system_information.json';
import v30Types from './fixtures/v30/vehicle_types.json';
import type { FetchLike } from '../src/types';

/** Clock the fixtures were captured at, in epoch ms. */
export const FIXTURE_NOW_MS = 1_793_626_400_000;

/** Real feeds trimmed to 3 stations: Vélib (1.x), Vélomagg (2.2), Vélo'v (2.3), Naolib (3.0). */
export const fixtures = {
  v1: {
    gbfs: v1Discovery,
    system_information: v1System,
    station_information: v1Info,
    station_status: v1Status,
  },
  v22: {
    gbfs: v22Discovery,
    system_information: v22System,
    station_information: v22Info,
    station_status: v22Status,
    vehicle_types: v22Types,
  },
  v23: {
    gbfs: v23Discovery,
    system_information: v23System,
    station_information: v23Info,
    station_status: v23Status,
    vehicle_types: v23Types,
  },
  v30: {
    gbfs: v30Discovery,
    system_information: v30System,
    station_information: v30Info,
    station_status: v30Status,
    vehicle_types: v30Types,
  },
};

export type Feeds = Record<string, unknown>;

/** Feed name from a URL: ".../station_status.json?key=x" -> "station_status". */
export function feedName(url: string): string {
  return url.match(/\/([a-z_]+)(?:\.json)?(?:\?.*)?$/)?.[1] ?? url;
}

export const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** Fake fetch routing by feed name; records every requested URL. */
export function fakeFetch(feeds: Feeds, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    const name = feedName(url);
    if (!(name in feeds)) return { ok: false, status: 404, json: async () => ({}) };
    return json(feeds[name]);
  };
}

/** Deep copy for tests that mutate a fixture. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
