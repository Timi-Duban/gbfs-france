import type { StationView } from '@gbfs-france/core';
import { describe, expect, it } from 'vitest';
import { age, stationLines } from '../src/format';

const station = (name: string, reportedAgeSeconds: number | null): StationView => ({
  id: name,
  name,
  lat: 0,
  lon: 0,
  address: null,
  capacity: 10,
  bikes: 2,
  ebikes: null,
  mechanical: null,
  docks: 8,
  isRenting: true,
  isReturning: true,
  reportedAt: null,
  reportedAgeSeconds,
  outdated: reportedAgeSeconds !== null && reportedAgeSeconds > 1800,
});

describe('outdated stations', () => {
  it.each([
    [3392, '57 min'],
    [55_717, '15 h'],
    [259_200, '3 days'],
  ])('%i s reads as %s', (seconds, text) => {
    expect(age(seconds)).toBe(text);
  });

  it('tags only the outdated stations when some are fresh', () => {
    expect(stationLines([station('A', 60), station('B', 7200)])).toEqual([
      'A: 2 bikes, 8 docks',
      'B: 2 bikes, 8 docks [last report 2 h ago]',
    ]);
  });

  it('replaces the tags with one note when every station is outdated', () => {
    expect(stationLines([station('A', 54_000), station('B', 57_600)])).toEqual([
      'A: 2 bikes, 8 docks',
      'B: 2 bikes, 8 docks',
      'Note: every station listed last reported 15 h to 16 h ago; counts are from the operator’s latest feed and may miss recent changes.',
    ]);
  });

  it('keeps the tag on a single station', () => {
    expect(stationLines([station('A', 54_000)])).toEqual([
      'A: 2 bikes, 8 docks [last report 15 h ago]',
    ]);
  });
});
