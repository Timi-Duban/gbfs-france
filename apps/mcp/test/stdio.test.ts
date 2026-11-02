import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));

/** R27: over stdio, stdout must carry JSON-RPC messages only (logs go to stderr). */
it('writes only protocol messages to stdout', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', entry], { stdio: 'pipe' });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const listed = new Promise<void>((resolve) => {
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.includes('"id":2')) resolve();
    });
  });
  const send = (msg: object) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await listed;
  child.kill();

  const lines = stdout.trim().split('\n');
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const line of lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
  expect(stderr).toContain('gbfs-france-mcp ready');
}, 20_000);
