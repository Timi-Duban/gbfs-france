import { createGbfsFrance } from '@gbfs-france/core';
import type { FetchLike } from '@gbfs-france/core';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeFetch, fixtures } from '../../../packages/gbfs-core/test/helpers';
import { nearbyOutput, searchOutput, stationOutput } from '../src/schemas';
import { createServer } from '../src/server';

const NOW = 1_793_626_400_000;
let client: Client | undefined;

async function connect(fetch: FetchLike = fakeFetch(fixtures.v1)) {
  const server = createServer(createGbfsFrance({ fetch, now: () => NOW }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1.0.0' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return client;
}

afterEach(async () => {
  await client?.close();
  client = undefined;
});

function text(result: { content?: unknown }): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks.map((b: { text?: string }) => b.text ?? '').join('\n');
}

describe('MCP server (in-memory client)', () => {
  it('lists 3 read-only tools with input and output schemas', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_station',
      'nearby_stations',
      'search_networks',
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.outputSchema?.type).toBe('object');
      expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    }
  });

  it('search_networks -> nearby_stations -> get_station, with attribution on every result', async () => {
    const c = await connect();

    const search = await c.callTool({
      name: 'search_networks',
      arguments: { query: 'Vélib Paris' },
    });
    const found = searchOutput.parse(search.structuredContent);
    const velib = found.networks[0];
    expect(velib?.attribution.licence).toBe('odc-odbl');
    expect(text(search)).toContain(velib?.id);

    const nearby = await c.callTool({
      name: 'nearby_stations',
      arguments: { network_id: velib?.id, lat: 48.866, lon: 2.2757, limit: 3 },
    });
    const near = nearbyOutput.parse(nearby.structuredContent);
    expect(near.stations[0]?.name).toBe('Benjamin Godard - Victor Hugo');
    expect(near.attribution.publisher).toBe('Ville de Paris');
    expect(text(nearby)).toMatch(
      /Benjamin Godard - Victor Hugo \(\d+ m\): 1 bike \(0 e-bikes\), 34 docks/,
    );
    expect(text(nearby)).toContain('Data: Ville de Paris');

    const station = await c.callTool({
      name: 'get_station',
      arguments: { network_id: velib?.id, station_id: near.stations[0]?.id },
    });
    expect(stationOutput.parse(station.structuredContent).attribution.licence).toBe('odc-odbl');
    expect(text(station)).toContain('last report over 30 min ago');
  });

  it.each([
    ['search_networks', { query: 'a' }],
    ['search_networks', { query: 'x'.repeat(81) }],
    ['search_networks', { query: 'lyon', limit: 21 }],
    ['nearby_stations', { network_id: 'x', lat: 91, lon: 0 }],
    ['nearby_stations', { network_id: 'x', lat: 0, lon: 181 }],
    ['nearby_stations', { network_id: 'x', lat: 0, lon: 0, limit: 0 }],
    ['nearby_stations', { network_id: 'x', lat: 0, lon: 0, max_distance_meters: 10_001 }],
    ['get_station', { network_id: 'x', station_id: '' }],
  ])('%s rejects out-of-bounds input %j (R15)', async (name, args) => {
    const r = await (await connect()).callTool({ name, arguments: args });
    expect(r.isError).toBe(true);
  });

  it('maps an unknown network to a readable error', async () => {
    const r = await (
      await connect()
    ).callTool({
      name: 'nearby_stations',
      arguments: { network_id: 'atlantis', lat: 0, lon: 0 },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Unknown network "atlantis".*search_networks/);
  });

  it('maps an operator outage to an error naming the network, with attribution', async () => {
    const down: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    const r = await (
      await connect(down)
    ).callTool({
      name: 'get_station',
      arguments: { network_id: 'velib-velos-et-bornes-disponibilite-temps-reel', station_id: '1' },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^Vélib .*: Network error\.\nData: Ville de Paris/);
  });
});
