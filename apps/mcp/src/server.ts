import type { GbfsError, GbfsFrance } from '@gbfs-france/core';
import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json';
import { credit, errorText, freshnessNote, stationLine } from './format';
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

/** Adapter: each MCP tool validates input, calls the core facade and formats its Result. */
export function createServer(gbfs: GbfsFrance): McpServer {
  const server = new McpServer(
    { name: 'gbfs-france', version: VERSION },
    {
      instructions:
        'Live bike-share availability for docked networks in France (GBFS). Call search_networks ' +
        'with a city first, then nearby_stations or get_station with the returned network id.',
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
      const text = lines.length ? lines.join('\n') : `No network matches "${query}".`;
      return { content: [{ type: 'text', text }], structuredContent: r.data };
    },
  );

  server.registerTool(
    'nearby_stations',
    {
      title: 'Nearby bike stations',
      description:
        'Nearest stations of one network to a point, with live bikes, e-bikes and free docks. ' +
        'Get network_id from search_networks first.',
      inputSchema: nearbyInput,
      outputSchema: nearbyOutput,
      annotations,
    },
    async ({ network_id, lat, lon, limit, need, max_distance_meters }) => {
      const r = await gbfs.nearbyStations(
        network_id,
        { lat, lon },
        { limit, maxDistanceMeters: max_distance_meters, ...(need ? { need } : {}) },
      );
      if (!r.ok) return toolError(r.error);
      const d = r.data;
      const head = d.outsideNetworkArea
        ? `No ${d.network.name} station within ${max_distance_meters} m; the nearest is ${d.nearestDistanceMeters} m away.`
        : `${d.stations.length} station(s) on ${d.network.name}.`;
      const text = [
        head + freshnessNote(d.freshness),
        ...d.stations.map(stationLine),
        credit(d.attribution),
      ];
      return { content: [{ type: 'text', text: text.join('\n') }], structuredContent: d };
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
