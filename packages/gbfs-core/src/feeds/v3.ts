import { z } from 'zod';
import { count, flag, id, localized, parseEach, timestamp } from './coerce';
import { parseEnvelope, stationsEnvelope } from './envelope';
import type { GbfsAdapter } from './model';
import {
  readStationInformation,
  readVehicleTypes,
  stationInformationSchema,
  toTypeCounts,
  typeCounts,
  vehicleType,
} from './shared';

// GBFS 3.0: localized names, num_vehicles_* counts, RFC 3339 timestamps.

export const systemInformationV3 = z.object({
  data: z.object({ system_id: id, name: localized }),
});

export const stationInformationV3 = stationInformationSchema(localized);

export const stationStatusV3 = z.object({
  station_id: id,
  num_vehicles_available: z.number(),
  num_docks_available: count,
  is_installed: flag,
  is_renting: flag,
  is_returning: flag,
  last_reported: timestamp,
  vehicle_types_available: typeCounts,
});

export const vehicleTypeV3 = vehicleType;

export const v3Adapter: GbfsAdapter = {
  systemInformation(raw) {
    const { data } = parseEnvelope(raw, systemInformationV3, 'system_information');
    return { id: data.system_id, name: data.name };
  },
  stationInformation: (raw) => readStationInformation(raw, stationInformationV3),
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
      vehicleTypes: toTypeCounts(s.vehicle_types_available),
      split: null,
    }));
  },
  vehicleTypes: readVehicleTypes,
};
