import { join } from 'node:path';

import { expect, test } from 'bun:test';

import { provenanceOf } from '../provenance';

import { createLoader } from '.';

const FIXTURES = join(import.meta.dir, 'fixtures', 'acceptance');

test('loads a project rafa.config.ts over a user .rafa/config.yaml', async () => {
  // Arrange
  const loader = createLoader({
    lookup: ['rafa.config.ts', '.rafa/config.yaml'],
    layers: [
      { layer: 'user', dir: 'user' },
      { layer: 'project', dir: 'project' },
    ],
    loaders: { '.yaml': (text: string): unknown => Bun.YAML.parse(text) },
  });

  // Act
  const start = performance.now();
  const result = await loader.load(FIXTURES);
  const elapsed = performance.now() - start;
  console.log(`createLoader load: ${elapsed.toFixed(2)} ms`);

  // Assert
  expect(result.diagnostics).toEqual([]);
  expect(result.sources).toEqual([
    { layer: 'user', path: join(FIXTURES, 'user', '.rafa', 'config.yaml'), entries: [0, 1] },
    { layer: 'project', path: join(FIXTURES, 'project', 'rafa.config.ts'), entries: [1, 2] },
  ]);
  expect(result.config).toEqual({
    build: { command: 'bun run build', retries: 2, timeout: 30 },
    locale: 'en',
    name: 'project',
  });
  expect(result.graph).toBeUndefined();
  expect(Number.isFinite(elapsed)).toBe(true);
});

test('the fixture sources tile the entries and map a path to its files', async () => {
  // Arrange
  const loader = createLoader({
    lookup: ['rafa.config.ts', '.rafa/config.yaml'],
    layers: [
      { layer: 'user', dir: 'user' },
      { layer: 'project', dir: 'project' },
    ],
    loaders: { '.yaml': (text: string): unknown => Bun.YAML.parse(text) },
  });

  // Act
  const result = await loader.load(FIXTURES);
  const total = result.sources.at(-1)?.entries[1] ?? 0;
  const touched = [...result.provenance.values()].flat().map(record => record.entry);
  const owners = result.sources.map(source => source.path);
  const ownerOf = (entry: number): string | undefined => result.sources
    .find(source => entry >= source.entries[0] && entry < source.entries[1])?.path;

  // Assert
  expect(result.sources.map(source => source.entries)).toEqual([[0, 1], [1, 2]]);
  expect(result.sources[0]?.entries[0]).toBe(0);
  result.sources.slice(1).forEach((source, index) => {
    expect(source.entries[0]).toBe(result.sources[index]?.entries[1] ?? -1);
  });
  expect(total).toBe(2);
  expect(touched.length).toBeGreaterThan(0);
  touched.forEach((entry) => {
    expect(entry).toBeGreaterThanOrEqual(0);
    expect(entry).toBeLessThan(total);
    expect(ownerOf(entry)).toBeDefined();
  });
  expect(provenanceOf(result, 'build.retries').map(record => ownerOf(record.entry))).toEqual(owners);
});
