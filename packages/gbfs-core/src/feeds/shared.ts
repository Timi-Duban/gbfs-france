import { z } from 'zod';
import { count, coordinate, id, parseEach } from './coerce';
import { parseEnvelope, stationsEnvelope, vehicleTypesEnvelope } from './envelope';
import type { StationInfoRecord, VehicleTypeCount, VehicleTypeRecord } from './model';

// Fields and mappers that GBFS 1.x-3.0 share; each adapter adds only what differs.

export const stationInformationSchema = <N extends z.ZodType<string>>(name: N) =>
  z.object({
    station_id: id,
    name,
    lat: coordinate,
    lon: coordinate,
    address: z.string().nullish(),
    capacity: count,
  });

export const typeCounts = z.array(z.object({ vehicle_type_id: id, count: z.number() })).nullish();

export const vehicleType = z.object({ vehicle_type_id: id, propulsion_type: z.string() });

export function readStationInformation(
  raw: unknown,
  schema: ReturnType<typeof stationInformationSchema>,
): StationInfoRecord[] {
  const { data } = parseEnvelope(raw, stationsEnvelope, 'station_information');
  return parseEach(data.stations, schema).map((s) => ({
    id: s.station_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    address: s.address ?? null,
    capacity: s.capacity,
  }));
}

export function toTypeCounts(types: z.output<typeof typeCounts>): VehicleTypeCount[] | null {
  return types?.map((t) => ({ vehicleTypeId: t.vehicle_type_id, count: t.count })) ?? null;
}

export function readVehicleTypes(raw: unknown): VehicleTypeRecord[] {
  const { data } = parseEnvelope(raw, vehicleTypesEnvelope, 'vehicle_types');
  return parseEach(data.vehicle_types, vehicleType).map((t) => ({
    id: t.vehicle_type_id,
    propulsion: t.propulsion_type,
  }));
}
