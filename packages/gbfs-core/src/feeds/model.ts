/** Version-independent feed records produced by every adapter. */

export interface StationInfoRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  capacity: number | null;
}

export interface VehicleTypeCount {
  vehicleTypeId: string;
  count: number;
}

export interface StationStatusRecord {
  id: string;
  isInstalled: boolean;
  isRenting: boolean;
  isReturning: boolean;
  bikes: number | null;
  docks: number | null;
  lastReported: number | null;
  /** Standard per-type counts (v2.1+ and v3), resolved with vehicle_types. */
  vehicleTypes: VehicleTypeCount[] | null;
  /** Nonstandard split published directly (Vélib `num_bikes_available_types`). */
  split: { mechanical: number; ebikes: number } | null;
}

export interface VehicleTypeRecord {
  id: string;
  propulsion: string;
}

export interface SystemInfo {
  id: string;
  name: string;
}

/** Adapter pattern: one implementation per GBFS major version, same records out. */
export interface GbfsAdapter {
  systemInformation(raw: unknown): SystemInfo;
  stationInformation(raw: unknown): StationInfoRecord[];
  stationStatus(raw: unknown): StationStatusRecord[];
  vehicleTypes(raw: unknown): VehicleTypeRecord[];
}
