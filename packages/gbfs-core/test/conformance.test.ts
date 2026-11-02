// R5/R22: spec payloads (MobilityData's official types) must be accepted by our zod schemas.
// Checked by `tsc` at compile time; the runtime test only keeps vitest happy.
import type { Station as InfoV23 } from 'gbfs-typescript-types/v2.3/station_information';
import type { Station as StatusV23 } from 'gbfs-typescript-types/v2.3/station_status';
import type { SystemInformation as SystemV23 } from 'gbfs-typescript-types/v2.3/system_information';
import type { VehicleType as TypeV23 } from 'gbfs-typescript-types/v2.3/vehicle_types';
import type { Gbfs as GbfsV30 } from 'gbfs-typescript-types/v3.0/gbfs';
import type { Station as InfoV30 } from 'gbfs-typescript-types/v3.0/station_information';
import type { Station as StatusV30 } from 'gbfs-typescript-types/v3.0/station_status';
import type { SystemInformation as SystemV30 } from 'gbfs-typescript-types/v3.0/system_information';
import type { VehicleType as TypeV30 } from 'gbfs-typescript-types/v3.0/vehicle_types';
import { expect, it } from 'vitest';
import type { z } from 'zod';
import type { discoverySchema } from '../src/feeds/discovery';
import type {
  stationInformationV2,
  stationStatusV2,
  systemInformationV2,
  vehicleTypeV2,
} from '../src/feeds/v2';
import type {
  stationInformationV3,
  stationStatusV3,
  systemInformationV3,
  vehicleTypeV3,
} from '../src/feeds/v3';

type Accepts<Schema extends z.ZodType, Official> = Official extends z.input<Schema> ? true : false;

// v2.3 gbfs.json is skipped: its official `Data` type is empty (language map not generated).
const checks: true[] = [
  true satisfies Accepts<typeof systemInformationV2, SystemV23>,
  true satisfies Accepts<typeof stationInformationV2, InfoV23>,
  true satisfies Accepts<typeof stationStatusV2, StatusV23>,
  true satisfies Accepts<typeof vehicleTypeV2, TypeV23>,
  true satisfies Accepts<typeof discoverySchema, GbfsV30>,
  true satisfies Accepts<typeof systemInformationV3, SystemV30>,
  true satisfies Accepts<typeof stationInformationV3, InfoV30>,
  true satisfies Accepts<typeof stationStatusV3, StatusV30>,
  true satisfies Accepts<typeof vehicleTypeV3, TypeV30>,
];

it('official GBFS 2.3 and 3.0 types conform to our schemas (compile-time)', () => {
  expect(checks.every(Boolean)).toBe(true);
});
