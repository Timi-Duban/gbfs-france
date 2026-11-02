import { expect, it } from 'vitest';
import pkg from '../package.json';
import serverJson from '../server.json';

it('server.json matches package.json (MCP registry ownership and version)', () => {
  expect(serverJson.name).toBe(pkg.mcpName);
  expect(serverJson.version).toBe(pkg.version);
  expect(serverJson.packages).toEqual([
    expect.objectContaining({ registryType: 'npm', identifier: pkg.name, version: pkg.version }),
  ]);
});

it('ships only the bundle, with the private core inlined', () => {
  expect(pkg.files).toEqual(['dist']);
  expect(Object.keys(pkg.dependencies)).not.toContain('@gbfs-france/core');
});
