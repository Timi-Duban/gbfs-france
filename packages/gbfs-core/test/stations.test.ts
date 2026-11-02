import { describe, expect, it } from 'vitest';
import type { StationInfoRecord, StationStatusRecord } from '../src/feeds/model';
import { distanceMeters, joinStations, meetsNeed } from '../src/stations';

const NOW = 2_000_000_000;

const info = (id: string): StationInfoRecord => ({
  id,
  name: `Station ${id}`,
  lat: 48.85,
  lon: 2.35,
  address: null,
  capacity: 10,
});

const status = (id: string, over: Partial<StationStatusRecord> = {}): StationStatusRecord => ({
  id,
  isInstalled: true,
  isRenting: true,
  isReturning: true,
  bikes: 3,
  docks: 7,
  lastReported: NOW - 60,
  vehicleTypes: null,
  split: null,
  ...over,
});

function join(statuses: StationStatusRecord[], infos = statuses.map((s) => info(s.id))) {
  return joinStations(infos, statuses, null, NOW);
}

describe('station rules (R14)', () => {
  it('excludes stations that are not installed', () => {
    expect(join([status('a', { isInstalled: false })]).stations).toHaveLength(0);
  });

  it('never offers bikes at a station that is not renting', () => {
    const [s] = join([status('a', { isRenting: false, bikes: 5 })]).stations;
    expect(s && meetsNeed(s, 'bikes')).toBe(false);
    expect(s && meetsNeed(s, undefined)).toBe(true);
  });

  it('never offers docks at a station that is not returning', () => {
    const [s] = join([status('a', { isReturning: false, docks: 5 })]).stations;
    expect(s && meetsNeed(s, 'docks')).toBe(false);
  });

  it('drops and counts stations present in only one feed', () => {
    const r = join([status('a'), status('only-status')], [info('a'), info('only-info')]);
    expect(r.stations.map((s) => s.id)).toEqual(['a']);
    expect(r.dropped).toBe(2);
  });

  it('flags a report older than 30 min as outdated', () => {
    const [s] = join([status('a', { lastReported: NOW - 31 * 60 })]).stations;
    expect(s).toMatchObject({ outdated: true, reportedAgeSeconds: 31 * 60 });
  });

  it('keeps a missing dock count unknown (null), never 0', () => {
    const [s] = join([status('a', { docks: null })]).stations;
    expect(s?.docks).toBeNull();
    expect(s && meetsNeed(s, 'docks')).toBe(false);
  });
});

describe('e-bike split (R25)', () => {
  const typed = status('a', {
    bikes: 5,
    vehicleTypes: [
      { vehicleTypeId: 'm', count: 2 },
      { vehicleTypeId: 'e', count: 3 },
    ],
  });

  it('derives mechanical / e-bikes from vehicle_types propulsion', () => {
    const types = [
      { id: 'm', propulsion: 'human' },
      { id: 'e', propulsion: 'electric_assist' },
    ];
    const [s] = joinStations([info('a')], [typed], types, NOW).stations;
    expect(s).toMatchObject({ mechanical: 2, ebikes: 3 });
  });

  it('is unknown without vehicle_types or with an unknown type id', () => {
    expect(joinStations([info('a')], [typed], null, NOW).stations[0]?.ebikes).toBeNull();
    const partial = [{ id: 'm', propulsion: 'human' }];
    expect(joinStations([info('a')], [typed], partial, NOW).stations[0]?.ebikes).toBeNull();
  });
});

it('computes haversine distances', () => {
  // Paris Notre-Dame to Lyon Bellecour: about 392 km.
  const d = distanceMeters({ lat: 48.853, lon: 2.3499 }, { lat: 45.7578, lon: 4.832 });
  expect(d / 1000).toBeCloseTo(392, -1);
});
