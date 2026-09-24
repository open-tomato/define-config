import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { createLoader } from '../index';

/** Runs `body` with a fresh temporary directory, removed afterwards. */
async function inTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'define-config-reload-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function loaderFor(name: string, dir: string, reload: boolean | undefined): ReturnType<typeof createLoader> {
  return createLoader({
    lookup: [name],
    layers: [{ layer: 'project', dir }],
    ...(reload === undefined
      ? {}
      : { reload }),
  });
}

describe('reload across load calls', () => {
  test('a config rewritten with a syntax error is load-failed, then its fix loads', async () => {
    await inTempDir(async (dir) => {
      // Arrange
      const file = join(dir, 'rafa.config.mjs');
      await writeFile(file, 'export default { v: 1 };\n');
      const loader = loaderFor('rafa.config.mjs', dir, true);
      await loader.load(dir);

      // Act
      await writeFile(file, 'export default { v: ;\n');
      const broken = await loader.load(dir);
      await writeFile(file, 'export default { v: 3 };\n');
      const fixed = await loader.load(dir);

      // Assert
      expect(broken.diagnostics.map(({ code }) => code)).toEqual(['load-failed']);
      expect(fixed.diagnostics).toEqual([]);
      expect(fixed.config).toEqual({ v: 3 });
    });
  });

  test('with reload off, a second load returns the first module\'s value', async () => {
    await inTempDir(async (dir) => {
      // Arrange
      const file = join(dir, 'rafa.config.mjs');
      await writeFile(file, 'export default { v: 1 };\n');
      const loader = loaderFor('rafa.config.mjs', dir, undefined);
      const first = await loader.load(dir);

      // Act
      await writeFile(file, 'export default { v: 2 };\n');
      const second = await loader.load(dir);

      // Assert
      expect(first.config).toEqual({ v: 1 });
      expect(second.config).toEqual({ v: 1 });
    });
  });

  test('with reload: true, a second load of rafa.config.ts returns the edit', async () => {
    await inTempDir(async (dir) => {
      // Arrange
      const file = join(dir, 'rafa.config.ts');
      await writeFile(file, 'const v: number = 1;\nexport default { v };\n');
      const loader = loaderFor('rafa.config.ts', dir, true);
      const first = await loader.load(dir);

      // Act
      await writeFile(file, 'const v: number = 2;\nexport default { v };\n');
      const second = await loader.load(dir);

      // Assert
      expect(first.config).toEqual({ v: 1 });
      expect(second.diagnostics).toEqual([]);
      expect(second.config).toEqual({ v: 2 });
    });
  });

  test('100 loads of an unchanged file evaluate it once', async () => {
    await inTempDir(async (dir) => {
      // Arrange
      const counter = 'defineConfigReloadTestCount100';
      const store = globalThis as unknown as Record<string, number | undefined>;
      store[counter] = 0;
      await writeFile(join(dir, 'rafa.config.mjs'), [
        `globalThis.${counter} = (globalThis.${counter} ?? 0) + 1;`,
        'export default { v: 1, nested: { a: [1, 2] } };',
        '',
      ].join('\n'));
      const loader = loaderFor('rafa.config.mjs', dir, true);

      // Act
      const results = [];
      for (let i = 0; i < 100; i += 1) {
        results.push(await loader.load(dir));
      }

      // Assert
      expect(store[counter]).toBe(1);
      const first = results[0]?.config ?? {};
      expect(first).toEqual({ v: 1, nested: { a: [1, 2] } });
      for (const result of results) {
        expect(result.config).toEqual(first);
      }
      delete store[counter];
    });
  });

  test('an imported helper stays cached while the config is re-evaluated', async () => {
    await inTempDir(async (dir) => {
      // Arrange
      // Documented behaviour: only the config file is re-evaluated, so a change to
      // that behaviour must update this test and the README.
      await writeFile(join(dir, 'defaults.mjs'), 'export const port = 1;\n');
      const configFile = join(dir, 'rafa.config.mjs');
      await writeFile(configFile, 'import { port } from \'./defaults.mjs\';\nexport default { own: 1, port };\n');
      const loader = loaderFor('rafa.config.mjs', dir, true);
      await loader.load(dir);

      // Act
      await writeFile(join(dir, 'defaults.mjs'), 'export const port = 2;\n');
      await writeFile(configFile, 'import { port } from \'./defaults.mjs\';\nexport default { own: 2, port };\n');
      const second = await loader.load(dir);

      // Assert
      expect(second.config).toEqual({ own: 2, port: 1 });
    });
  });

  test.each([true, false])('a .json layer beside a module layer is read fresh with reload: %p', async (reload) => {
    await inTempDir(async (dir) => {
      // Arrange
      await mkdir(join(dir, 'json'));
      await mkdir(join(dir, 'mod'));
      const jsonFile = join(dir, 'json', 'config.json');
      await writeFile(jsonFile, '{ "j": 1 }');
      await writeFile(join(dir, 'mod', 'config.mjs'), 'export default { m: 1 };\n');
      const loader = createLoader({
        lookup: ['config.json', 'config.mjs'],
        layers: [{ layer: 'user', dir: join(dir, 'json') }, { layer: 'project', dir: join(dir, 'mod') }],
        reload,
      });
      await loader.load(dir);

      // Act
      await writeFile(jsonFile, '{ "j": 2 }');
      const second = await loader.load(dir);

      // Assert
      expect(second.config).toEqual({ j: 2, m: 1 });
    });
  });
});
