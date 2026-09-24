import type { Diagnostic } from '../diagnostics';
import type { Loaders, ReadResult } from './read';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { readSource, reloadSpecifier } from './read';

/*
 * Every file sits flat under a fresh temporary root, named after the case
 * it serves. Module files are imported once per path in this process, so
 * each test that reads a module reads its own file unless it is measuring
 * the module cache on purpose.
 */
let root = '';

const FILES: Readonly<Record<string, string>> = {
  'array.ts': 'const n: number = 1;\nexport default [{ a: { x: n } }, { a: { y: 2 } }];\n',
  'object.mts': 'export default { b: 1 };\n',
  'array.mjs': 'export default [{ c: 1 }];\n',
  'object.js': 'export default { d: true };\n',
  'labelled.mjs': 'export default [{ $layer: \'other\', e: 1 }];\n',
  'shared.mjs': 'export default [{ f: 1 }];\n',
  'cached.mjs': 'export default [{ version: 1 }];\n',
  'empty.mjs': 'export default [];\n',
  'throws.mjs': 'throw new Error(\'boom at load\');\n',
  'syntax.ts': 'export default [{ a: 1 ];\n',
  'nodefault.mjs': 'export const g = 1;\n',
  'string.mjs': 'export default \'not an entry\';\n',
  'instance.mjs': 'export default new (class Config { h = 1; })();\n',
  'holed.mjs': 'export default [{ i: 1 }, 2];\n',
  'nested.mjs': 'export default [[{ j: 1 }]];\n',
  'array.json': '[{ "k": 1 }, { "k": 2 }]',
  'object.json': '{ "l": { "m": 1 } }',
  'scalar.json': '42',
  'null.json': 'null',
  'bad.json': '{ "n": ',
  'config.yaml': 'loop:\n  settingSources: project\n',
  'config.conf': 'o=1',
  'config': 'p: 1\n',
};

function at(name: string): string {
  return join(root, name);
}

/** The diagnostic of a failed read; fails the test when the read succeeded. */
function failure(result: ReadResult): Diagnostic {
  if (result.ok) {
    throw new Error(`expected load-failed, read ${JSON.stringify(result.entries)}`);
  }
  return result.diagnostic;
}

/** The entries of a successful read; fails the test when the read failed. */
function entries(result: ReadResult): readonly Record<string, unknown>[] {
  if (!result.ok) {
    throw new Error(`expected entries, got ${result.diagnostic.message}`);
  }
  return result.entries;
}

const YAML: Loaders = { '.yaml': (text) => Bun.YAML.parse(text) };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'define-config-read-'));
  await Promise.all(Object.entries(FILES).map(([name, text]) => writeFile(at(name), text)));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('modules through import()', () => {
  test('a .ts default array is read in order, TypeScript syntax and all', async () => {
    // Act
    const result = await readSource({ layer: 'project', path: at('array.ts') });

    // Assert
    expect(entries(result)).toEqual([
      { a: { x: 1 }, $layer: 'project' },
      { a: { y: 2 }, $layer: 'project' },
    ]);
  });

  test('a .mts default object is one entry', async () => {
    const result = await readSource({ layer: 'project', path: at('object.mts') });

    expect(entries(result)).toEqual([{ b: 1, $layer: 'project' }]);
  });

  test('a .mjs default array is read', async () => {
    const result = await readSource({ layer: 'user', path: at('array.mjs') });

    expect(entries(result)).toEqual([{ c: 1, $layer: 'user' }]);
  });

  test('a .js default object is read', async () => {
    const result = await readSource({ layer: 'user', path: at('object.js') });

    expect(entries(result)).toEqual([{ d: true, $layer: 'user' }]);
  });

  test('an empty default array reads as no entries, not a failure', async () => {
    const result = await readSource({ layer: 'user', path: at('empty.mjs') });

    expect(result).toEqual({ ok: true, entries: [] });
  });
});

describe('JSON built in', () => {
  test('a .json array is read as entries', async () => {
    const result = await readSource({ layer: 'defaults', path: at('array.json') });

    expect(entries(result)).toEqual([{ k: 1, $layer: 'defaults' }, { k: 2, $layer: 'defaults' }]);
  });

  test('a .json object is one entry', async () => {
    const result = await readSource({ layer: 'defaults', path: at('object.json') });

    expect(entries(result)).toEqual([{ l: { m: 1 }, $layer: 'defaults' }]);
  });

  test('a loaders entry for .json is not used: JSON is always read built in', async () => {
    // Arrange
    const calls: string[] = [];
    const loaders: Loaders = { '.json': (text) => {
      calls.push(text);
      return { fromHost: true };
    } };

    // Act
    const result = await readSource({ layer: 'defaults', path: at('object.json') }, loaders);

    // Assert
    expect(entries(result)).toEqual([{ l: { m: 1 }, $layer: 'defaults' }]);
    expect(calls).toEqual([]);
  });
});

describe('host loaders for other extensions', () => {
  test('.yaml is read through loaders[\'.yaml\'] with Bun.YAML.parse', async () => {
    const result = await readSource({ layer: 'user', path: at('config.yaml') }, YAML);

    expect(entries(result)).toEqual([{ loop: { settingSources: 'project' }, $layer: 'user' }]);
  });

  test('the host reader gets the file text and its absolute path', async () => {
    // Arrange
    const calls: Array<[string, string]> = [];
    const loaders: Loaders = { '.conf': (text, path) => {
      calls.push([text, path]);
      return {};
    } };

    // Act
    await readSource({ layer: 'user', path: at('config.conf') }, loaders);

    // Assert
    expect(calls).toEqual([['o=1', at('config.conf')]]);
  });

  test('a host reader may return a promise', async () => {
    const loaders: Loaders = { '.conf': async (text) => ({ raw: text }) };

    const result = await readSource({ layer: 'user', path: at('config.conf') }, loaders);

    expect(entries(result)).toEqual([{ raw: 'o=1', $layer: 'user' }]);
  });
});

describe('$layer tagging', () => {
  test('the source layer replaces a $layer the file wrote', async () => {
    const result = await readSource({ layer: 'project', path: at('labelled.mjs') });

    expect(entries(result)).toEqual([{ e: 1, $layer: 'project' }]);
  });

  test('tagging copies each entry: the module\'s default export is not changed', async () => {
    // Arrange
    const path = at('shared.mjs');

    // Act
    const first = entries(await readSource({ layer: 'user', path }));
    const second = entries(await readSource({ layer: 'project', path }));
    const namespace = (await import(pathToFileURL(path).href)) as { default: unknown };

    // Assert: both reads keep their own layer, and the cached module's
    // value never gained one.
    expect(first).toEqual([{ f: 1, $layer: 'user' }]);
    expect(second).toEqual([{ f: 1, $layer: 'project' }]);
    expect(namespace.default).toEqual([{ f: 1 }]);
  });

  test('a host reader\'s value is not changed either', async () => {
    const value = { q: 1 };

    const result = await readSource({ layer: 'user', path: at('config.conf') }, { '.conf': () => value });

    expect(entries(result)).toEqual([{ q: 1, $layer: 'user' }]);
    expect(value).toEqual({ q: 1 });
  });
});

describe('the runtime module cache', () => {
  test('a module path already imported yields its first contents after the file changes', async () => {
    // Arrange
    const path = at('cached.mjs');
    const before = entries(await readSource({ layer: 'user', path }));
    await writeFile(path, 'export default [{ version: 2 }];\n');

    // Act
    const after = entries(await readSource({ layer: 'user', path }));

    // Assert: import() ran again but the runtime served its cached module.
    // Control: the file really changed, read here as text.
    expect(before).toEqual([{ version: 1, $layer: 'user' }]);
    expect(after).toEqual([{ version: 1, $layer: 'user' }]);
    expect(await Bun.file(path).text()).toContain('version: 2');
  });
});

describe('reloadSpecifier', () => {
  test('on bun it is the plain absolute path with ?v=<key>', () => {
    expect(reloadSpecifier('/repo/rafa.config.ts', 'abc123', true)).toBe('/repo/rafa.config.ts?v=abc123');
  });

  test('on node it is the file URL with ?v=<key>', () => {
    const specifier = reloadSpecifier('/repo/rafa.config.ts', 'abc123', false);

    expect(specifier).toBe('file:///repo/rafa.config.ts?v=abc123');
  });

  test('on node a # in the path is percent-encoded, so the query is not a fragment', () => {
    // Act
    const specifier = reloadSpecifier('/repo/a#b/rafa.config.ts', 'abc123', false);

    // Assert: the URL still parses to the same file and the same key.
    // Control: the bun form keeps the # as written.
    expect(specifier).toBe('file:///repo/a%23b/rafa.config.ts?v=abc123');
    expect(new URL(specifier).pathname).toBe('/repo/a%23b/rafa.config.ts');
    expect(new URL(specifier).search).toBe('?v=abc123');
    expect(reloadSpecifier('/repo/a#b/rafa.config.ts', 'abc123', true)).toBe('/repo/a#b/rafa.config.ts?v=abc123');
  });
});

describe('reload', () => {
  /*
   * Each case writes its own files under its own mkdtemp directory: a
   * module imported once stays in this process's registry for the rest of
   * the run, whichever file imported it.
   */
  const dirs: string[] = [];

  async function freshDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'define-config-reload-'));
    dirs.push(dir);
    return dir;
  }

  const store = globalThis as Record<string, unknown>;

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test('an .mjs file read, rewritten and read again yields the edit', async () => {
    // Arrange
    const path = join(await freshDir(), 'rafa.config.mjs');
    await writeFile(path, 'export default { version: 1 };\n');
    const before = entries(await readSource({ layer: 'project', path }, {}, { reload: true }));
    await writeFile(path, 'export default { version: 2 };\n');

    // Act
    const after = entries(await readSource({ layer: 'project', path }, {}, { reload: true }));

    // Assert
    expect(before).toEqual([{ version: 1, $layer: 'project' }]);
    expect(after).toEqual([{ version: 2, $layer: 'project' }]);
  });

  test('a .ts file read, rewritten and read again yields the edit', async () => {
    // Arrange
    const path = join(await freshDir(), 'rafa.config.ts');
    await writeFile(path, 'const v: number = 1;\nexport default { version: v };\n');
    const before = entries(await readSource({ layer: 'project', path }, {}, { reload: true }));
    await writeFile(path, 'const v: number = 2;\nexport default { version: v };\n');

    // Act
    const after = entries(await readSource({ layer: 'project', path }, {}, { reload: true }));

    // Assert
    expect(before).toEqual([{ version: 1, $layer: 'project' }]);
    expect(after).toEqual([{ version: 2, $layer: 'project' }]);
  });

  test('a file read 100 times unchanged is evaluated once', async () => {
    // Arrange
    const counter = 'defineConfigReadReloadOnce';
    const path = join(await freshDir(), 'rafa.config.mjs');
    await writeFile(path, `globalThis.${counter} = (globalThis.${counter} ?? 0) + 1;\nexport default { n: 1 };\n`);

    // Act
    const results: ReadResult[] = [];
    for (let read = 0; read < 100; read += 1) {
      results.push(await readSource({ layer: 'project', path }, {}, { reload: true }));
    }

    // Assert: every read succeeded, and the counter the fixture bumps on
    // each evaluation moved once.
    expect(results.map((result) => entries(result))).toEqual(
      Array.from({ length: 100 }, () => [{ n: 1, $layer: 'project' }]),
    );
    expect(store[counter]).toBe(1);
  });

  test('an edit is a fresh evaluation, counted by the fixture', async () => {
    // Arrange: the control for the case above: the same counter does move
    // when the bytes change, so a count of 1 there was not a dead counter.
    const counter = 'defineConfigReadReloadEdited';
    const path = join(await freshDir(), 'rafa.config.mjs');
    const bump = `globalThis.${counter} = (globalThis.${counter} ?? 0) + 1;\n`;
    const text = (n: number): string => `${bump}export default { n: ${n} };\n`;
    await writeFile(path, text(1));
    await readSource({ layer: 'project', path }, {}, { reload: true });
    await writeFile(path, text(2));

    // Act
    await readSource({ layer: 'project', path }, {}, { reload: true });

    // Assert
    expect(store[counter]).toBe(2);
  });

  test('a module the config imports stays cached: the config\'s edit sits beside the helper\'s old value', async () => {
    // Arrange
    const dir = await freshDir();
    const path = join(dir, 'rafa.config.mjs');
    await writeFile(join(dir, 'helper.mjs'), 'export const helper = \'old\';\n');
    await writeFile(path, 'import { helper } from \'./helper.mjs\';\nexport default { config: \'old\', helper };\n');
    const before = entries(await readSource({ layer: 'project', path }, {}, { reload: true }));
    await writeFile(join(dir, 'helper.mjs'), 'export const helper = \'new\';\n');
    await writeFile(path, 'import { helper } from \'./helper.mjs\';\nexport default { config: \'new\', helper };\n');

    // Act
    const after = entries(await readSource({ layer: 'project', path }, {}, { reload: true }));

    // Assert: only the config file is evaluated again.
    expect(before).toEqual([{ config: 'old', helper: 'old', $layer: 'project' }]);
    expect(after).toEqual([{ config: 'new', helper: 'old', $layer: 'project' }]);
  });

  test('a module file removed before the read is load-failed naming could not read the file', async () => {
    // Arrange: control: the same path read with reload while it existed.
    const path = join(await freshDir(), 'rafa.config.mjs');
    await writeFile(path, 'export default { gone: false };\n');
    expect(entries(await readSource({ layer: 'project', path }, {}, { reload: true }))).toEqual([
      { gone: false, $layer: 'project' },
    ]);
    await rm(path);

    // Act
    const result = await readSource({ layer: 'project', path }, {}, { reload: true });

    // Assert
    expect(failure(result)).toMatchObject({
      level: 'error',
      code: 'load-failed',
      path: ['project', path],
    });
    expect(failure(result).message).toStartWith('could not read the file: ');
  });
});

describe('load-failed', () => {
  test('an extension with no reader is load-failed at [layer, path]', async () => {
    // Control: the same file reads when a reader is given.
    expect((await readSource({ layer: 'user', path: at('config.yaml') }, YAML)).ok).toBe(true);

    // Act
    const result = await readSource({ layer: 'user', path: at('config.yaml') });

    // Assert
    expect(failure(result)).toEqual({
      level: 'error',
      code: 'load-failed',
      path: ['user', at('config.yaml')],
      message: 'no reader for extension ".yaml"; pass one in loaders',
    });
  });

  test('a file with no extension has no reader', async () => {
    const result = await readSource({ layer: 'user', path: at('config') }, YAML);

    expect(failure(result).message).toBe('no reader for a file with no extension; pass one in loaders');
  });

  test('extensions compare as written: .YAML is not .yaml', async () => {
    const result = await readSource({ layer: 'user', path: at('config.YAML') }, YAML);

    expect(failure(result).message).toContain('".YAML"');
  });

  test('a module that throws at load is load-failed with the thrown message', async () => {
    const result = await readSource({ layer: 'project', path: at('throws.mjs') });

    expect(failure(result)).toMatchObject({
      code: 'load-failed',
      path: ['project', at('throws.mjs')],
      message: 'import failed: boom at load',
    });
  });

  test('a module that does not compile is load-failed', async () => {
    const result = await readSource({ layer: 'project', path: at('syntax.ts') });

    expect(failure(result).message).toStartWith('import failed: ');
  });

  test('a module file that does not exist is load-failed', async () => {
    const result = await readSource({ layer: 'project', path: at('missing.ts') });

    expect(failure(result).message).toStartWith('import failed: ');
  });

  test('a module with no default export is load-failed', async () => {
    const result = await readSource({ layer: 'project', path: at('nodefault.mjs') });

    expect(failure(result).message).toBe('the module has no default export');
  });

  test('a default that is a string is a non-entry export', async () => {
    const result = await readSource({ layer: 'project', path: at('string.mjs') });

    expect(failure(result).message).toBe('expected an array of entries or one entry object, got string');
  });

  test('a default that is a class instance is a non-entry export', async () => {
    const result = await readSource({ layer: 'project', path: at('instance.mjs') });

    expect(failure(result).message).toBe(
      'expected an array of entries or one entry object, got a non-plain object',
    );
  });

  test('an array holding a non-object names the entry at fault', async () => {
    const result = await readSource({ layer: 'project', path: at('holed.mjs') });

    expect(failure(result).message).toBe('entry 1: expected an entry object, got number');
  });

  test('an array holding an array is refused, not flattened', async () => {
    const result = await readSource({ layer: 'project', path: at('nested.mjs') });

    expect(failure(result).message).toBe('entry 0: expected an entry object, got an array');
  });

  test('a host reader yielding a sparse array is refused at the hole', async () => {
    // eslint-disable-next-line no-sparse-arrays
    const loaders: Loaders = { '.conf': () => [{ r: 1 }, , { r: 2 }] };

    const result = await readSource({ layer: 'user', path: at('config.conf') }, loaders);

    expect(failure(result).message).toBe('entry 1: expected an entry object, got undefined');
  });

  test('a JSON scalar is a non-entry value', async () => {
    const result = await readSource({ layer: 'defaults', path: at('scalar.json') });

    expect(failure(result).message).toBe('expected an array of entries or one entry object, got number');
  });

  test('JSON null is a non-entry value', async () => {
    const result = await readSource({ layer: 'defaults', path: at('null.json') });

    expect(failure(result).message).toBe('expected an array of entries or one entry object, got null');
  });

  test('invalid JSON is load-failed', async () => {
    const result = await readSource({ layer: 'defaults', path: at('bad.json') });

    expect(failure(result).message).toStartWith('invalid JSON: ');
  });

  test('a JSON file that cannot be read is load-failed', async () => {
    const result = await readSource({ layer: 'defaults', path: at('missing.json') });

    expect(failure(result).message).toStartWith('could not read the file: ');
  });

  test('a host reader that throws is load-failed naming the reader', async () => {
    const loaders: Loaders = { '.conf': () => {
      throw new Error('bad line 1');
    } };

    const result = await readSource({ layer: 'user', path: at('config.conf') }, loaders);

    expect(failure(result).message).toBe('loaders[".conf"] threw: bad line 1');
  });

  test('a host reader whose promise rejects is load-failed', async () => {
    const loaders: Loaders = { '.conf': () => Promise.reject(new Error('later')) };

    const result = await readSource({ layer: 'user', path: at('config.conf') }, loaders);

    expect(failure(result).message).toBe('loaders[".conf"] threw: later');
  });

  test('a host reader yielding a scalar is a non-entry value', async () => {
    const result = await readSource({ layer: 'user', path: at('config.conf') }, { '.conf': () => 'text' });

    expect(failure(result).message).toBe('expected an array of entries or one entry object, got string');
  });
});

describe('refused arguments', () => {
  test('a relative path is refused rather than resolved against the process', async () => {
    await expect(readSource({ layer: 'user', path: 'config.json' })).rejects.toThrow('path must be absolute');
  });

  test('a source without a string layer is refused', async () => {
    // @ts-expect-error layer is required
    await expect(readSource({ path: at('object.json') })).rejects.toThrow(TypeError);
  });

  test('loaders that are not an object are refused', async () => {
    // @ts-expect-error loaders is a record of readers
    await expect(readSource({ layer: 'user', path: at('object.json') }, [])).rejects.toThrow(
      'expected loaders to be an object, got an array',
    );
  });

  test('a loaders entry that is not a function is refused when its extension is read', async () => {
    // @ts-expect-error a reader is a function
    const loaders: Loaders = { '.conf': 'yaml' };

    await expect(readSource({ layer: 'user', path: at('config.conf') }, loaders)).rejects.toThrow(
      'loaders[".conf"]: expected a function, got string',
    );
  });

  test('a reload that is not a boolean is refused', async () => {
    // Control: a boolean reload reads the same source.
    expect((await readSource({ layer: 'user', path: at('object.json') }, {}, { reload: false })).ok).toBe(true);

    await expect(
      // @ts-expect-error reload is a boolean
      readSource({ layer: 'user', path: at('object.json') }, {}, { reload: 'yes' }),
    ).rejects.toThrow(new TypeError('readSource: expected options.reload to be a boolean, got string'));
  });

  test('options that are not an object are refused', async () => {
    // @ts-expect-error options is an object
    await expect(readSource({ layer: 'user', path: at('object.json') }, {}, true)).rejects.toThrow(
      'expected options to be an object, got boolean',
    );
  });
});
