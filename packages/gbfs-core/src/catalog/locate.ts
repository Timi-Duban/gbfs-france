import { clamp } from '../limits';
import { distanceMeters } from '../stations';
import type { LatLon } from '../types';
import type { CatalogNetwork } from './schema';

export interface LocatedNetwork {
  network: CatalogNetwork;
  distanceMeters: number;
}

function area([minLat, minLon, maxLat, maxLon]: CatalogNetwork['bbox']): number {
  return (maxLat - minLat) * (maxLon - minLon);
}

/**
 * Networks whose station bounding box lies within `maxDistanceMeters` of a point, nearest first.
 * Ties (point inside several boxes) go to the smaller box: a city network before a regional one.
 */
export function locateNetworks(
  networks: CatalogNetwork[],
  at: LatLon,
  maxDistanceMeters: number,
): LocatedNetwork[] {
  return networks
    .map((network) => {
      const [minLat, minLon, maxLat, maxLon] = network.bbox;
      const closest = { lat: clamp(at.lat, minLat, maxLat), lon: clamp(at.lon, minLon, maxLon) };
      return { network, distanceMeters: Math.round(distanceMeters(at, closest)) };
    })
    .filter((l) => l.distanceMeters <= maxDistanceMeters)
    .sort(
      (a, b) => a.distanceMeters - b.distanceMeters || area(a.network.bbox) - area(b.network.bbox),
    );
}
