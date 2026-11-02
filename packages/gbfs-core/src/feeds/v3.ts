import { z } from 'zod';
import { count, coordinate, flag, id, localized, parseEach, timestamp } from './coerce';
import { parseEnvelope, stationsEnvelope, vehicleTypesEnvelope } from './envelope';
import type { GbfsAdapter } from './model';

// GBFS 3.0: localized names, num_vehicles_* counts, RFC 3339 timestamps.

export const systemInformationV3 = z.object({
  data: z.object({ system_id: id, name: localized }),
});

export const stationInformationV3 = z.object({
  station_id: id,
  name: localized,
  lat: coordinate,
  lon: coordinate,
  address: z.string().nullish(),
  capacity: count,
});

export const stationStatusV3 = z.object({
  station_id: id,
  num_vehicles_available: z.number(),
  num_docks_available: count,
  is_installed: flag,
  is_renting: flag,
  is_returning: flag,
  last_reported: timestamp,
  vehicle_types_available: z.array(z.object({ vehicle_type_id: id, count: z.number() })).nullish(),
});

export const vehicleTypeV3 = z.object({ vehicle_type_id: id, propulsion_type: z.string() });

export const v3Adapter: GbfsAdapter = {
  systemInformation(raw) {
    const { data } = parseEnvelope(raw, systemInformationV3, 'system_information');
    return { id: data.system_id, name: data.name };
  },
  stationInformation(raw) {
    const { data } = parseEnvelope(raw, stationsEnvelope, 'station_information');
    return parseEach(data.stations, stationInformationV3).map((s) => ({
      id: s.station_id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      address: s.address ?? null,
      capacity: s.capacity,
    }));
  },
  stationStatus(raw) {
    const { data } = parseEnvelope(raw, stationsEnvelope, 'station_status');
    return parseEach(data.stations, stationStatusV3).map((s) => ({
      id: s.station_id,
      isInstalled: s.is_installed,
      isRenting: s.is_renting,
      isReturning: s.is_returning,
      bikes: s.num_vehicles_available,
      docks: s.num_docks_available,
      lastReported: s.last_reported,
      vehicleTypes:
        s.vehicle_types_available?.map((t) => ({
          vehicleTypeId: t.vehicle_type_id,
          count: t.count,
        })) ?? null,
      split: null,
    }));
  },
  vehicleTypes(raw) {
    const { data } = parseEnvelope(raw, vehicleTypesEnvelope, 'vehicle_types');
    return parseEach(data.vehicle_types, vehicleTypeV3).map((t) => ({
      id: t.vehicle_type_id,
      propulsion: t.propulsion_type,
    }));
  },
};
