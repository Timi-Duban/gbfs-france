import { describe, expect, it } from 'vitest';
import { FeedFailure } from '../src/errors';
import { adapterFor, parseDiscovery } from '../src/feeds/discovery';
import { joinStations } from '../src/stations';
import { fixtures } from './helpers';

function normalize(set: keyof typeof fixtures) {
  const f = fixtures[set];
  const discovery = parseDiscovery(f.gbfs);
  const adapter = adapterFor(discovery.version);
  const types = 'vehicle_types' in f ? adapter.vehicleTypes(f.vehicle_types) : null;
  const { stations } = joinStations(
    adapter.stationInformation(f.station_information),
    adapter.stationStatus(f.station_status),
    types,
    1_793_626_400,
  );
  return { discovery, system: adapter.systemInformation(f.system_information), stations };
}

describe('version adapters', () => {
  it.each([
    ['v1', '1.x'],
    ['v22', '2.2'],
    ['v23', '2.3'],
    ['v30', '3.0'],
  ] as const)('%s fixture normalizes to the station model', (set, version) => {
    const { discovery, system, stations } = normalize(set);
    expect(discovery.version).toBe(version);
    expect(discovery.feeds['station_status']).toMatch(/station_status/);
    expect(system.id).not.toBe('');
    expect(stations).toHaveLength(3);
    for (const s of stations) {
      expect(typeof s.id).toBe('string');
      expect(s.name).not.toBe('');
      expect(typeof s.lat).toBe('number');
      expect(typeof s.isRenting).toBe('boolean');
      expect(typeof s.bikes).toBe('number');
      expect(typeof s.reportedAt).toBe('number');
    }
  });

  it('reads Vélib 1.x: numeric ids, 0/1 flags and the nonstandard e-bike split', () => {
    const [first] = normalize('v1').stations;
    expect(first).toMatchObject({ id: '213688169', isRenting: true, mechanical: 1, ebikes: 0 });
  });

  it('reads 3.0 localized names and RFC 3339 timestamps', () => {
    const [first] = normalize('v30').stations;
    expect(first?.name).toBe('PRÉFECTURE');
    expect(first?.reportedAt).toBe(Date.parse('2026-11-02T03:31:55Z') / 1000);
    expect(normalize('v30').system.name).toBe('Naolib');
  });

  it('splits e-bikes with vehicle_types (2.2 numeric type ids, 2.3 named ones)', () => {
    const v23 = normalize('v23').stations[0];
    expect(v23).toMatchObject({ bikes: 8, mechanical: 1, ebikes: 7 });
    for (const s of normalize('v22').stations) {
      expect((s.mechanical ?? 0) + (s.ebikes ?? 0)).toBe(s.bikes);
    }
  });

  it('keeps one bad station from failing the whole feed', () => {
    const raw = {
      data: { stations: [{ station_id: 'a', name: 'A', lat: 1, lon: 2 }, { name: 'no id' }] },
    };
    expect(adapterFor('2.3').stationInformation(raw)).toHaveLength(1);
  });

  it('rejects unsupported versions and non-discovery documents', () => {
    expect(() => adapterFor('3.1-RC')).toThrow(FeedFailure);
    expect(() => parseDiscovery(fixtures.v23.station_status)).toThrow(/discovery/);
  });

  it('flags an invalid feed envelope', () => {
    expect(() => adapterFor('3.0').stationStatus({ data: {} })).toThrowError(
      expect.objectContaining({ kind: 'invalid-feed' }),
    );
  });
});
