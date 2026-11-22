import type {
  GbfsError,
  GbfsFrance,
  NearbyAround,
  NearbyStations,
  Result,
} from '@gbfs-france/core';
import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json';
import {
  catalogCredit,
  credit,
  errorText,
  freshnessNote,
  stationLine,
  stationLines,
} from './format';
import {
  nearbyInput,
  nearbyOutput,
  searchInput,
  searchOutput,
  stationInput,
  stationOutput,
} from './schemas';

export const VERSION = pkg.version;
export const USER_AGENT = `gbfs-france-mcp/${VERSION} (+https://github.com/Timi-Duban/gbfs-france)`;

const annotations = { readOnlyHint: true, openWorldHint: true, idempotentHint: true };

function toolError(error: GbfsError) {
  return { isError: true, content: [{ type: 'text' as const, text: errorText(error) }] };
}

/** One network's answer in the shape of a lookup around a point. */
function asAround(r: Result<NearbyStations>): Result<NearbyAround> {
  return r.ok ? { ok: true, data: { results: [r.data], failures: [] } } : r;
}

function nearbyText(d: NearbyStations, maxDistance: number): string {
  const head = d.outsideNetworkArea
    ? `No ${d.network.name} station within ${maxDistance} m; the nearest is ${d.nearestDistanceMeters} m away.`
    : `${d.stations.length} station(s) on ${d.network.name}.`;
  return [
    head + freshnessNote(d.freshness),
    ...stationLines(d.stations),
    credit(d.attribution),
  ].join('\n');
}

/** Adapter: each MCP tool validates input, calls the core facade and formats its Result. */
export function createServer(gbfs: GbfsFrance): McpServer {
  const server = new McpServer(
    { name: 'gbfs-france', version: VERSION },
    {
      instructions:
        'Live bike-share availability for docked networks in France (GBFS). With coordinates, call ' +
        'nearby_stations directly; with a city name, call search_networks first for its network id.',
    },
  );

  server.registerTool(
    'search_networks',
    {
      title: 'Search French bike-share networks',
      description:
        'Find docked bike-share networks by city, area or name. Returns network ids for ' +
        'nearby_stations and get_station, plus matching networks that are not supported and why.',
      inputSchema: searchInput,
      outputSchema: searchOutput,
      annotations,
    },
    async ({ query, limit }) => {
      const r = await gbfs.searchNetworks(query, { limit });
      if (!r.ok) return toolError(r.error);
      const { networks, unsupported } = r.data;
      const lines = networks.map((n) => `${n.name} [${n.id}] (${n.stationCount} stations)`);
      for (const u of unsupported) lines.push(`Not supported: ${u.title} (${u.reason})`);
      if (!lines.length) lines.push(`No network matches "${query}".`);
      lines.push(catalogCredit(r.data.snapshotDate));
      return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: r.data };
    },
  );

  server.registerTool(
    'nearby_stations',
    {
      title: 'Nearby bike stations',
      description:
        'Nearest stations to a point, with live bikes, e-bikes and free docks. Without network_id, ' +
        'searches the supported networks nearest the point; with it, only that network.',
      inputSchema: nearbyInput,
      outputSchema: nearbyOutput,
      annotations,
    },
    async ({ network_id, lat, lon, limit, need, max_distance_meters }) => {
      const at = { lat, lon };
      const opts = { limit, maxDistanceMeters: max_distance_meters, ...(need ? { need } : {}) };
      const r =
        network_id === undefined
          ? await gbfs.nearbyStationsAround(at, opts)
          : asAround(await gbfs.nearbyStations(network_id, at, opts));
      if (!r.ok) return toolError(r.error);
      const { results, failures } = r.data;
      const blocks = results.map((d) => nearbyText(d, max_distance_meters));
      if (!blocks.length) {
        const scope = failures.length ? 'No network that answered' : 'No supported network';
        blocks.push(
          `${scope} has a station within ${max_distance_meters} m of this point. ` +
            'Coverage: docked networks with an open licence (call search_networks for a city).',
        );
      }
      for (const f of failures) blocks.push(`Could not check: ${errorText(f)}`);
      return { content: [{ type: 'text', text: blocks.join('\n\n') }], structuredContent: r.data };
    },
  );

  server.registerTool(
    'get_station',
    {
      title: 'Bike station status',
      description:
        'Live status of one station: bikes, e-bikes, free docks and whether it rents or accepts returns.',
      inputSchema: stationInput,
      outputSchema: stationOutput,
      annotations,
    },
    async ({ network_id, station_id }) => {
      const r = await gbfs.getStation(network_id, station_id);
      if (!r.ok) return toolError(r.error);
      const d = r.data;
      const text = `${stationLine(d.station)}.${freshnessNote(d.freshness)}\n${credit(d.attribution)}`;
      return { content: [{ type: 'text', text }], structuredContent: d };
    },
  );

  return server;
}
