import type { LoaderOptions } from '.';
import type { StepRegistry } from '../graph/types';
import type { StandardSchemaV1 } from '../standard-schema';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createLoader, load } from '.';

/*
 * Tree under a fresh temporary root:
 *
 *   empty/                          (no lookup file)
 *   user/.rafa/config.yaml          (read only through a host loader)
 *   project/config.json
 *   broken/config.json              (invalid JSON)
 *   dupes/config.json               (two entries setting a.x)
 *   flows/config.json               (a flows section)
 *   mutable/config.json             (rewritten by the no-cache test)
 */
let root = '';

const LOOKUP = ['config.json', '.rafa/config.yaml'];

const FILES: Readonly<Record<string, string>> = {
  'user/.rafa/config.yaml': 'a:\n  x: 1\n  y: 1\n',
  'project/config.json': '{ "a": { "y": 2 }, "b": true }',
  'broken/config.json': '{ "a": ',
  'dupes/config.json': '[{ "a": { "x": 1 } }, { "a": { "x": 2 } }]',
  'flows/config.json': JSON.stringify({ flows: { next: { build: { onSuccess: 'test' }, test: {} } } }),
  'mutable/config.json': '{ "version": 1 }',
};

const YAML = { '.yaml': (text: string): unknown => Bun.YAML.parse(text) };

const STEPS: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
};

/** A hand-written schema refusing a value whose `b` is not `false`. */
const B_FALSE: StandardSchemaV1 = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => ((value as { b?: unknown }).b === false
      ? { value }
      : { issues: [{ message: 'b must be false', path: ['b'] }] }),
  },
};

function at(...segments: string[]): string {
  return join(root, ...segments);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'define-config-loader-'));
  await mkdir(at('empty'));
  await Promise.all(Object.entries(FILES).map(async ([name, text]) => {
    await mkdir(join(at(name), '..'), { recursive: true });
    await writeFile(at(name), text);
  }));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('no layer found', () => {
  test('no source, an empty config and no diagnostic', async () => {
    // Arrange
    const loader = createLoader({ lookup: LOOKUP, layers: [{ layer: 'user', dir: 'empty' }] });

    // Act
    const result = await loader.load(root);

    // Assert
    expect(result).toEqual({ config: {}, diagnostics: [], sources: [] });
  });

  test('with steps, an empty graph is still returned', async () => {
    const result = await load(root, { lookup: LOOKUP, layers: [{ layer: 'user', dir: 'empty' }], steps: STEPS });

    expect(result.graph).toEqual({ nodes: {}, edges: [], flows: {} });
    expect(result.diagnostics).toEqual([]);
  });

  test('an empty layer list is no source either', async () => {
    const result = await load(root, { lookup: LOOKUP, layers: [] });

    expect(result).toEqual({ config: {}, diagnostics: [], sources: [] });
  });
});

describe('layers', () => {
  test('sources come in layer order and later layers win, relative dirs against cwd', async () => {
    // Arrange
    const options: LoaderOptions = {
      lookup: LOOKUP,
      layers: [{ layer: 'user', dir: 'user' }, { layer: 'none', dir: 'empty' }, { layer: 'project', dir: at('project') }],
      loaders: YAML,
    };

    // Act
    const result = await load(root, options);

    // Assert
    expect(result.sources).toEqual([
      { layer: 'user', path: at('user', '.rafa', 'config.yaml') },
      { layer: 'project', path: at('project', 'config.json') },
    ]);
    expect(result.config).toEqual({ a: { x: 1, y: 2 }, b: true });
    expect(result.diagnostics).toEqual([]);
  });

  test('$layer never reaches the merged config', async () => {
    const result = await load(root, { lookup: LOOKUP, layers: [{ layer: 'project', dir: 'project' }] });

    expect(Object.keys(result.config)).toEqual(['a', 'b']);
  });
});

describe('a layer skipped on load-failed', () => {
  test('a source with no reader is reported and its layer contributes nothing', async () => {
    // Arrange: no loaders, so the user layer's .yaml has no reader.
    const layers = [{ layer: 'user', dir: 'user' }, { layer: 'project', dir: 'project' }];

    // Act
    const result = await load(root, { lookup: LOOKUP, layers });

    // Assert
    const yamlPath = at('user', '.rafa', 'config.yaml');
    expect(result.config).toEqual({ a: { y: 2 }, b: true });
    expect(result.sources.map(({ layer }) => layer)).toEqual(['user', 'project']);
    expect(result.diagnostics).toEqual([
      {
        level: 'error',
        code: 'load-failed',
        path: ['user', yamlPath],
        message: 'no reader for extension ".yaml"; pass one in loaders',
      },
    ]);
  });

  test('invalid JSON skips that layer only, and load-failed comes before merge diagnostics', async () => {
    // Act
    const result = await load(root, {
      lookup: LOOKUP,
      layers: [{ layer: 'broken', dir: 'broken' }, { layer: 'project', dir: 'project' }],
      required: ['a.x'],
    });

    // Assert
    expect(result.config).toEqual({ a: { y: 2 }, b: true });
    expect(result.diagnostics.map(({ code, path }) => [code, path])).toEqual([
      ['load-failed', ['broken', at('broken', 'config.json')]],
      ['required-dropped', ['a', 'x']],
    ]);
  });
});

describe('graph absent when steps is not given', () => {
  test('without steps the result carries no graph key, even with a flows section', async () => {
    // Act
    const result = await load(root, { lookup: LOOKUP, layers: [{ layer: 'project', dir: 'flows' }] });

    // Assert
    expect('graph' in result).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  test('control: with steps the same flows resolve into a graph', async () => {
    const result = await load(root, { lookup: LOOKUP, layers: [{ layer: 'project', dir: 'flows' }], steps: STEPS });

    expect(result.graph?.edges).toEqual([{ from: 'next.build', outcome: 'success', to: 'next.test', repeat: false }]);
    expect(result.diagnostics).toEqual([]);
  });

  test('graph diagnostics follow the merge and schema ones', async () => {
    // Arrange: `test` is not in this registry.
    const steps: StepRegistry = { build: { outcomes: ['success', 'fail'] } };

    // Act
    const result = await load(root, {
      lookup: LOOKUP,
      layers: [{ layer: 'project', dir: 'flows' }],
      steps,
      schema: B_FALSE,
    });

    // Assert
    expect(result.graph).toBeDefined();
    expect(result.diagnostics[0]?.code).toBe('schema');
    expect(result.diagnostics.slice(1).map(({ code }) => code)).toContain('unknown-step');
  });
});

describe('merge and validate options', () => {
  test('duplicates defaults to warn, and entry indexes the entries read', async () => {
    const result = await load(root, { lookup: LOOKUP, layers: [{ layer: 'project', dir: 'dupes' }] });

    expect(result.diagnostics).toMatchObject([{ level: 'warn', code: 'duplicate-key', path: ['a', 'x'], entry: 1 }]);
  });

  test('duplicates: allow is passed through to merge', async () => {
    const result = await load(root, {
      lookup: LOOKUP,
      layers: [{ layer: 'project', dir: 'dupes' }],
      duplicates: 'allow',
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.config).toEqual({ a: { x: 2 } });
  });

  test('a whole-value schema reports schema errors at their path', async () => {
    const result = await load(root, { lookup: LOOKUP, layers: [{ layer: 'project', dir: 'project' }], schema: B_FALSE });

    expect(result.diagnostics).toEqual([{ level: 'error', code: 'schema', path: ['b'], message: 'b must be false' }]);
  });

  test('schema sections are validated at their prefixed paths', async () => {
    const result = await load(root, {
      lookup: LOOKUP,
      layers: [{ layer: 'project', dir: 'project' }],
      schema: [[['a'], B_FALSE]],
    });

    expect(result.diagnostics.map(({ path }) => path)).toEqual([['a', 'b']]);
  });
});

describe('no caching', () => {
  test('a second load reads the file again', async () => {
    // Arrange
    const loader = createLoader({ lookup: LOOKUP, layers: [{ layer: 'project', dir: 'mutable' }] });
    const first = await loader.load(root);

    // Act
    await writeFile(at('mutable', 'config.json'), '{ "version": 2 }');
    const second = await loader.load(root);

    // Assert
    expect(first.config).toEqual({ version: 1 });
    expect(second.config).toEqual({ version: 2 });
  });
});

describe('createLoader binds its options', () => {
  test('a later change to the caller\'s arrays does not reach the loader', async () => {
    // Arrange
    const lookup = [...LOOKUP];
    const layers = [{ layer: 'project', dir: 'project' }];
    const loader = createLoader({ lookup, layers });

    // Act
    lookup.length = 0;
    layers[0] = { layer: 'project', dir: 'empty' };
    const result = await loader.load(root);

    // Assert
    expect(result.sources).toEqual([{ layer: 'project', path: at('project', 'config.json') }]);
  });

  test('malformed options are refused at creation', () => {
    expect(() => createLoader(null as unknown as LoaderOptions)).toThrow(TypeError);
    expect(() => createLoader({ lookup: [], layers: [], steps: [] as unknown as StepRegistry })).toThrow(
      'createLoader: expected steps to be an object, got an array',
    );
    expect(() => createLoader({ lookup: [], layers: [], schema: null as unknown as StandardSchemaV1 })).toThrow(
      'createLoader: expected schema to be a Standard Schema or sections, got null',
    );
  });

  test('a malformed layer list is refused when load runs', async () => {
    const loader = createLoader({ lookup: LOOKUP, layers: 'project' as unknown as LoaderOptions['layers'] });

    await expect(loader.load(root)).rejects.toThrow('layers: expected an array of { layer, dir }, got string');
  });
});
