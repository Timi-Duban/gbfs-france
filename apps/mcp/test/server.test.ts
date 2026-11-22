import { createGbfsFrance } from '@gbfs-france/core';
import type { FetchLike } from '@gbfs-france/core';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_NOW_MS as NOW,
  fakeFetch,
  fixtures,
} from '../../../packages/gbfs-core/test/helpers';
import { nearbyOutput, searchOutput, stationOutput } from '../src/schemas';
import { createServer } from '../src/server';

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
    expect(text(search)).toMatch(
      /Network list: transport\.data\.gouv\.fr .*, snapshot \d{4}-\d{2}-\d{2}$/,
    );

    const nearby = await c.callTool({
      name: 'nearby_stations',
      arguments: { network_id: velib?.id, lat: 48.866, lon: 2.2757, limit: 3 },
    });
    const [near] = nearbyOutput.parse(nearby.structuredContent).results;
    expect(near?.stations[0]?.name).toBe('Benjamin Godard - Victor Hugo');
    expect(near?.attribution.publisher).toBe('Ville de Paris');
    expect(text(nearby)).toMatch(
      /Benjamin Godard - Victor Hugo \(\d+ m\): 1 bike \(0 e-bikes\), 34 docks/,
    );
    expect(text(nearby)).toContain('Data: Ville de Paris');

    const station = await c.callTool({
      name: 'get_station',
      arguments: { network_id: velib?.id, station_id: near?.stations[0]?.id },
    });
    expect(stationOutput.parse(station.structuredContent).attribution.licence).toBe('odc-odbl');
    expect(text(station)).toContain('[last report 57 min ago]');
  });

  it('nearby_stations without network_id finds the network from coordinates', async () => {
    const r = await (
      await connect()
    ).callTool({ name: 'nearby_stations', arguments: { lat: 48.866, lon: 2.2757 } });
    const { results, failures } = nearbyOutput.parse(r.structuredContent);
    expect(failures).toEqual([]);
    expect(results.map((n) => n.network.name)).toEqual(['Vélib Paris et communes limitrophes']);
    expect(text(r)).toMatch(/^1 station\(s\) on Vélib .*\nBenjamin Godard/);
  });

  it('nearby_stations without network_id explains when no network covers the point', async () => {
    const r = await (
      await connect()
    ).callTool({ name: 'nearby_stations', arguments: { lat: 46.5, lon: -4 } });
    expect(r.isError).toBeFalsy();
    expect(nearbyOutput.parse(r.structuredContent).results).toEqual([]);
    expect(text(r)).toMatch(/^No supported network has a station within 2000 m/);
  });

  it('nearby_stations without network_id reports networks it could not check', async () => {
    const at = { lat: 47.2198, lon: -1.5549 }; // Naolib and Naolib Micromob' cover it
    const naolib = fakeFetch(fixtures.v30);
    const micromobDown: FetchLike = (url, init) =>
      url.includes('chantrerie') ? Promise.reject(new TypeError('down')) : naolib(url, init);
    const mcp = await connect(micromobDown);
    const partial = await mcp.callTool({ name: 'nearby_stations', arguments: at });
    expect(partial.isError).toBeFalsy();
    const { results, failures } = nearbyOutput.parse(partial.structuredContent);
    expect(results).toHaveLength(1);
    expect(failures).toMatchObject([{ kind: 'unreachable', attribution: { licence: 'lov2' } }]);
    expect(text(partial)).toMatch(/\n\nCould not check: Naolib Micromob.*: Network error\./);

    const none = await mcp.callTool({
      name: 'nearby_stations',
      arguments: { ...at, lon: at.lon + 0.0015, max_distance_meters: 50 },
    });
    expect(text(none)).toMatch(
      /^No network that answered has a station within 50 m.*\n\nCould not/s,
    );

    await client?.close();
    const down: FetchLike = () => Promise.reject(new TypeError('down'));
    const all = await (await connect(down)).callTool({ name: 'nearby_stations', arguments: at });
    expect(all.isError).toBe(true);
    expect(text(all)).toMatch(/Network error\./);
  });

  it('nearby_stations explains when the network has no station in range', async () => {
    const r = await (
      await connect()
    ).callTool({
      name: 'nearby_stations',
      arguments: {
        network_id: 'velib-velos-et-bornes-disponibilite-temps-reel',
        lat: 48.8566,
        lon: 2.3522,
      },
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/^No Vélib .* station within 2000 m; the nearest is \d+ m away\./);
  });

  it.each([
    ['search_networks', { query: 'a' }],
    ['search_networks', { query: 'x'.repeat(81) }],
    ['search_networks', { query: 'lyon', limit: 21 }],
    ['nearby_stations', { network_id: 'x', lat: 91, lon: 0 }],
    ['nearby_stations', { network_id: '', lat: 0, lon: 0 }],
    ['nearby_stations', { network_id: 'x', lat: 0, lon: 181 }],
    ['nearby_stations', { network_id: 'x', lat: 0, lon: 0, limit: 0 }],
    ['nearby_stations', { network_id: 'x', lat: 0, lon: 0, max_distance_meters: 10_001 }],
    ['get_station', { network_id: 'x', station_id: '' }],
  ])('%s rejects out-of-bounds input %j', async (name, args) => {
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
