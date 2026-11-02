// Regression: ISSUE-001 — "13 bikes, 1 e-bikes" read as 14 bikes; e-bikes are part of the total
// Found by /qa on 2026-11-02
// Report: .gstack/qa-reports/qa-report-gbfs-france-mcp-2026-11-02.md
import type { StationView } from '@gbfs-france/core';
import { expect, it } from 'vitest';
import { stationLine } from '../src/format';

const station: StationView = {
  id: '1',
  name: 'Lobau',
  lat: 48.85,
  lon: 2.35,
  address: null,
  capacity: 60,
  bikes: 13,
  ebikes: 1,
  mechanical: 12,
  docks: 1,
  isRenting: true,
  isReturning: true,
  reportedAt: null,
  reportedAgeSeconds: null,
  outdated: false,
};

it.each([
  [station, 'Lobau: 13 bikes (1 e-bike), 1 dock'],
  [{ ...station, bikes: 1, ebikes: 0, docks: 2 }, 'Lobau: 1 bike (0 e-bikes), 2 docks'],
  [{ ...station, ebikes: null, docks: null }, 'Lobau: 13 bikes, ? docks'],
])('shows e-bikes inside the bike total', (s, line) => {
  expect(stationLine(s)).toBe(line);
});
