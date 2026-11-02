import { z } from 'zod';

// Input bounds keep answers small for the AI and turn bad ids into clear errors.
const networkId = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'Network id returned by search_networks, e.g. "velib-velos-et-bornes-disponibilite-temps-reel".',
  );

export const searchInput = z.object({
  query: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .describe('City, area or network name, e.g. "Lyon" or "Vélib".'),
  limit: z.number().int().min(1).max(20).default(5),
});

export const nearbyInput = z.object({
  network_id: networkId,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  limit: z.number().int().min(1).max(20).default(5),
  need: z
    .enum(['bikes', 'docks'])
    .optional()
    .describe('"bikes" keeps stations renting with bikes left, "docks" stations with free docks.'),
  max_distance_meters: z.number().int().min(50).max(10_000).default(2000),
});

export const stationInput = z.object({
  network_id: networkId,
  station_id: z.string().min(1).max(100),
});

const attribution = z.object({
  publisher: z.string(),
  licence: z.enum(['lov2', 'fr-lo', 'odc-odbl']),
  licenceName: z.string(),
  sourceUrl: z.string(),
  updated: z.string(),
});

const network = z.object({ id: z.string(), name: z.string() });

const freshness = z.object({ stale: z.boolean(), ageSeconds: z.number() });

const station = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  address: z.string().nullable(),
  capacity: z.number().nullable(),
  bikes: z.number().nullable(),
  ebikes: z.number().nullable(),
  mechanical: z.number().nullable(),
  docks: z.number().nullable(),
  isRenting: z.boolean(),
  isReturning: z.boolean(),
  reportedAt: z.number().nullable(),
  reportedAgeSeconds: z.number().nullable(),
  outdated: z.boolean(),
  distanceMeters: z.number().optional(),
});

export const searchOutput = z.object({
  networks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      title: z.string(),
      areas: z.array(z.string()),
      gbfsVersion: z.string(),
      stationCount: z.number(),
      attribution,
    }),
  ),
  unsupported: z.array(z.object({ slug: z.string(), title: z.string(), reason: z.string() })),
  snapshotDate: z.string(),
});

export const nearbyOutput = z.object({
  network,
  stations: z.array(station),
  nearestDistanceMeters: z.number().nullable(),
  outsideNetworkArea: z.boolean(),
  droppedStations: z.number(),
  freshness,
  attribution,
});

export const stationOutput = z.object({ network, station, freshness, attribution });
