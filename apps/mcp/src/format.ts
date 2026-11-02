import type { Attribution, Freshness, GbfsError, StationView } from '@gbfs-france/core';

/** Short text renderings next to structuredContent, for clients that only read text. */

export function credit(a: Attribution): string {
  return `Data: ${a.publisher}, ${a.licenceName}, ${a.sourceUrl}`;
}

const count = (n: number | null, unit: string) =>
  n === null ? `? ${unit}s` : `${n} ${unit}${n === 1 ? '' : 's'}`;

export function stationLine(s: StationView): string {
  const where = s.distanceMeters === undefined ? '' : ` (${s.distanceMeters} m)`;
  // E-bikes are part of the bike total, not extra.
  const split = s.ebikes === null ? '' : ` (${count(s.ebikes, 'e-bike')})`;
  const flags = [
    s.isRenting ? '' : 'not renting',
    s.isReturning ? '' : 'not accepting returns',
    s.outdated ? 'last report over 30 min ago' : '',
  ].filter(Boolean);
  const note = flags.length ? ` [${flags.join(', ')}]` : '';
  return `${s.name}${where}: ${count(s.bikes, 'bike')}${split}, ${count(s.docks, 'dock')}${note}`;
}

export function freshnessNote(f: Freshness): string {
  return f.stale ? ` Operator unreachable: showing cached data from ${f.ageSeconds} s ago.` : '';
}

export function errorText(e: GbfsError): string {
  return e.attribution ? `${e.message}\n${credit(e.attribution)}` : e.message;
}
