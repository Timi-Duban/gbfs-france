import type { StationInfoRecord, StationStatusRecord, VehicleTypeRecord } from './feeds/model';
import type { LatLon, StationNeed, StationView } from './types';

export const OUTDATED_AFTER_SECONDS = 30 * 60;

const ELECTRIC = new Set(['electric_assist', 'electric']);

/** Mechanical / e-bike counts when the feed lets us derive them (R25), else null. */
function splitBikes(status: StationStatusRecord, types: VehicleTypeRecord[] | null) {
  if (status.split) return status.split;
  if (!status.vehicleTypes || !types) return null;
  const propulsion = new Map(types.map((t) => [t.id, t.propulsion]));
  let mechanical = 0;
  let ebikes = 0;
  for (const { vehicleTypeId, count } of status.vehicleTypes) {
    const p = propulsion.get(vehicleTypeId);
    if (p === undefined) return null;
    if (ELECTRIC.has(p)) ebikes += count;
    else if (p === 'human') mechanical += count;
  }
  return { mechanical, ebikes };
}

/**
 * Inner join of station_information and station_status on station_id (R14).
 * Stations missing from either feed are dropped and counted; uninstalled stations are excluded.
 */
export function joinStations(
  info: StationInfoRecord[],
  status: StationStatusRecord[],
  types: VehicleTypeRecord[] | null,
  nowSeconds: number,
): { stations: StationView[]; dropped: number } {
  const statusById = new Map(status.map((s) => [s.id, s]));
  const stations: StationView[] = [];
  let matched = 0;
  for (const i of info) {
    const s = statusById.get(i.id);
    if (!s) continue;
    matched++;
    if (!s.isInstalled) continue;
    const split = splitBikes(s, types);
    const reportedAgeSeconds =
      s.lastReported === null ? null : Math.max(0, Math.round(nowSeconds - s.lastReported));
    stations.push({
      id: i.id,
      name: i.name,
      lat: i.lat,
      lon: i.lon,
      address: i.address,
      capacity: i.capacity,
      bikes: s.bikes,
      ebikes: split?.ebikes ?? null,
      mechanical: split?.mechanical ?? null,
      docks: s.docks,
      isRenting: s.isRenting,
      isReturning: s.isReturning,
      reportedAt: s.lastReported,
      reportedAgeSeconds,
      outdated: reportedAgeSeconds !== null && reportedAgeSeconds > OUTDATED_AFTER_SECONDS,
    });
  }
  const dropped = info.length - matched + (status.length - matched);
  return { stations, dropped };
}

/** `bikes`: renting with at least one bike. `docks`: returning with at least one free dock. */
export function meetsNeed(station: StationView, need: StationNeed | undefined): boolean {
  if (need === 'bikes') return station.isRenting && (station.bikes ?? 0) > 0;
  if (need === 'docks') return station.isReturning && (station.docks ?? 0) > 0;
  return true;
}

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in meters. */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
