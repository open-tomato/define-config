import { join } from 'node:path';

import { expect, test } from 'bun:test';

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
    { layer: 'user', path: join(FIXTURES, 'user', '.rafa', 'config.yaml') },
    { layer: 'project', path: join(FIXTURES, 'project', 'rafa.config.ts') },
  ]);
  expect(result.config).toEqual({
    build: { command: 'bun run build', retries: 2, timeout: 30 },
    locale: 'en',
    name: 'project',
  });
  expect(result.graph).toBeUndefined();
  expect(Number.isFinite(elapsed)).toBe(true);
});
