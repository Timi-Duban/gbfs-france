import type { Attribution, Freshness, GbfsError, StationView } from '@gbfs-france/core';

/** Text next to structuredContent, for text-only clients. */

export function credit(a: Attribution): string {
  return `Data: ${a.publisher}, ${a.licenceName}, ${a.sourceUrl}`;
}

export function catalogCredit(snapshotDate: string): string {
  return `Network list: transport.data.gouv.fr (national access point), snapshot ${snapshotDate.slice(0, 10)}`;
}

const count = (n: number | null, unit: string) =>
  n === null ? `? ${unit}s` : `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "57 min", "15 h", "3 days". */
export function age(seconds: number): string {
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}

const lag = (s: StationView) => (s.outdated ? s.reportedAgeSeconds : null);

export function stationLine(s: StationView, tagOutdated = true): string {
  const where = s.distanceMeters === undefined ? '' : ` (${s.distanceMeters} m)`;
  // E-bikes are part of the bike total, not extra.
  const split = s.ebikes === null ? '' : ` (${count(s.ebikes, 'e-bike')})`;
  const late = lag(s);
  const flags = [
    s.isRenting ? '' : 'not renting',
    s.isReturning ? '' : 'not accepting returns',
    tagOutdated && late !== null ? `last report ${age(late)} ago` : '',
  ].filter(Boolean);
  const note = flags.length ? ` [${flags.join(', ')}]` : '';
  return `${s.name}${where}: ${count(s.bikes, 'bike')}${split}, ${count(s.docks, 'dock')}${note}`;
}

/** One line per station; one note replaces the tags when all are outdated. */
export function stationLines(stations: StationView[]): string[] {
  const ages = stations.flatMap((s) => lag(s) ?? []);
  const allLate = stations.length > 1 && ages.length === stations.length;
  const lines = stations.map((s) => stationLine(s, !allLate));
  if (allLate) {
    const [low, high] = [age(Math.min(...ages)), age(Math.max(...ages))];
    lines.push(
      `Note: every station listed last reported ${low === high ? low : `${low} to ${high}`} ago; ` +
        'counts are from the operator’s latest feed and may miss recent changes.',
    );
  }
  return lines;
}

export function freshnessNote(f: Freshness): string {
  return f.stale ? ` Operator unreachable: showing cached data from ${f.ageSeconds} s ago.` : '';
}

export function errorText(e: GbfsError): string {
  return e.attribution ? `${e.message}\n${credit(e.attribution)}` : e.message;
}
