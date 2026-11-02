// Live smoke: the built server answers nearby_stations on real feeds. Run after `pnpm build`.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { nearbyOutput, searchOutput } from '../src/schemas';

const server = fileURLToPath(new URL('../dist/index.js', import.meta.url));

// Vélib (GBFS 1.x) and Vélo'v (2.3) and Naolib Nantes (3.0), each near a central station.
const CASES = [
  { query: 'Vélib', lat: 48.8566, lon: 2.3522 },
  { query: "Vélo'v", lat: 45.7578, lon: 4.832 },
  { query: 'Naolib Nantes', lat: 47.2184, lon: -1.5536 },
];

const client = new Client({ name: 'live-smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));

let failed = false;
for (const { query, lat, lon } of CASES) {
  const search = await client.callTool({ name: 'search_networks', arguments: { query, limit: 1 } });
  const id = searchOutput.safeParse(search.structuredContent).data?.networks[0]?.id;
  const nearby = id
    ? await client.callTool({ name: 'nearby_stations', arguments: { network_id: id, lat, lon } })
    : undefined;
  const stations = nearbyOutput.safeParse(nearby?.structuredContent).data?.stations ?? [];
  const ok = Boolean(id) && !nearby?.isError && stations.length > 0;
  failed ||= !ok;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${query}: ${id ?? 'not found'}, ${stations.length} station(s)`,
  );
  if (!ok && nearby) console.log(JSON.stringify(nearby.content));
}
await client.close();
process.exitCode = failed ? 1 : 0;
