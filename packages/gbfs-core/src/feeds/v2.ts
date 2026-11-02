import { z } from 'zod';
import { count, flag, id, parseEach, timestamp } from './coerce';
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

// GBFS 1.x, 2.2 and 2.3 share these station fields; only the ones we read are declared.

export const systemInformationV2 = z.object({
  data: z.object({ system_id: id, name: z.string() }),
});

export const stationInformationV2 = stationInformationSchema(z.string());

export const stationStatusV2 = z.object({
  station_id: id,
  num_bikes_available: z.number(),
  num_docks_available: count,
  is_installed: flag,
  is_renting: flag,
  is_returning: flag,
  last_reported: timestamp,
  vehicle_types_available: typeCounts,
  // Vélib: [{ mechanical: n }, { ebike: n }]
  num_bikes_available_types: z.array(z.record(z.string(), z.number())).nullish(),
});

export const vehicleTypeV2 = vehicleType;

function velibSplit(types: Record<string, number>[] | null | undefined) {
  if (!types) return null;
  let mechanical = 0;
  let ebikes = 0;
  for (const entry of types) {
    mechanical += entry['mechanical'] ?? 0;
    ebikes += entry['ebike'] ?? 0;
  }
  return { mechanical, ebikes };
}

export const v2Adapter: GbfsAdapter = {
  systemInformation(raw) {
    const { data } = parseEnvelope(raw, systemInformationV2, 'system_information');
    return { id: data.system_id, name: data.name };
  },
  stationInformation: (raw) => readStationInformation(raw, stationInformationV2),
  stationStatus(raw) {
    const { data } = parseEnvelope(raw, stationsEnvelope, 'station_status');
    return parseEach(data.stations, stationStatusV2).map((s) => ({
      id: s.station_id,
      isInstalled: s.is_installed,
      isRenting: s.is_renting,
      isReturning: s.is_returning,
      bikes: s.num_bikes_available,
      docks: s.num_docks_available,
      lastReported: s.last_reported,
      vehicleTypes: toTypeCounts(s.vehicle_types_available),
      split: velibSplit(s.num_bikes_available_types),
    }));
  },
  vehicleTypes: readVehicleTypes,
};
