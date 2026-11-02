import { z } from 'zod';

export const LICENCES = ['lov2', 'fr-lo', 'odc-odbl'] as const;

export const LICENCE_NAMES: Record<(typeof LICENCES)[number], string> = {
  lov2: 'Licence Ouverte v2.0 (Etalab)',
  'fr-lo': 'Licence Ouverte v1.0 (Etalab)',
  'odc-odbl': 'Open Database License (ODbL)',
};

export const catalogNetworkSchema = z.object({
  id: z.string(),
  slug: z.string(),
  systemId: z.string(),
  name: z.string(),
  systemName: z.string(),
  title: z.string(),
  areas: z.array(z.string()),
  gbfsVersion: z.string(),
  discoveryUrl: z.string(),
  stationCount: z.number(),
  publisher: z.string(),
  licence: z.enum(LICENCES),
  pageUrl: z.string(),
  updated: z.string(),
});

export const catalogSchema = z.object({
  generatedAt: z.string(),
  source: z.string(),
  networks: z.array(catalogNetworkSchema),
  excluded: z.array(z.object({ slug: z.string(), title: z.string(), reason: z.string() })),
});

export type CatalogNetwork = z.infer<typeof catalogNetworkSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
