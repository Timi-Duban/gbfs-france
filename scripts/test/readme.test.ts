import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import snapshot from '../../packages/gbfs-core/data/catalog.json';
import { catalogSchema } from '../../packages/gbfs-core/src/catalog/schema';
import { renderNetworkList } from '../catalog-builder';

const catalog = catalogSchema.parse(snapshot);

it.each(['README.md', 'README.fr.md'])(
  '%s lists the networks of the committed snapshot',
  (file) => {
    const readme = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    expect(readme).toContain('<!-- networks:start -->');
    expect(renderNetworkList(readme, catalog)).toBe(readme);
  },
);
