import type { LayerDir } from './lookup';

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { findSources } from './lookup';

/*
 * Tree under a fresh temporary root:
 *
 *   project/rafa.config.ts
 *   project/.rafa/config.yaml
 *   user/.rafa/config.yaml
 *   dirnamed/rafa.config.ts/        (a directory, not a file)
 *   dirnamed/.rafa/config.yaml
 *   filedir                         (a file, so filedir/x runs through a non-directory)
 *   empty/
 */
let root = '';

async function touch(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '');
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'define-config-lookup-'));
  await touch(join(root, 'project', 'rafa.config.ts'));
  await touch(join(root, 'project', '.rafa', 'config.yaml'));
  await touch(join(root, 'user', '.rafa', 'config.yaml'));
  await mkdir(join(root, 'dirnamed', 'rafa.config.ts'), { recursive: true });
  await touch(join(root, 'dirnamed', '.rafa', 'config.yaml'));
  await touch(join(root, 'filedir'));
  await mkdir(join(root, 'empty'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const LOOKUP = ['rafa.config.ts', '.rafa/config.yaml'];

describe('first existing lookup file per layer', () => {
  test('the first lookup name that exists wins, later names are not taken', async () => {
    // Act
    const sources = await findSources(root, LOOKUP, [{ layer: 'project', dir: 'project' }]);

    // Assert
    expect(sources).toEqual([{ layer: 'project', path: join(root, 'project', 'rafa.config.ts') }]);
  });

  test('a later lookup name is taken when the earlier ones are missing', async () => {
    const sources = await findSources(root, LOOKUP, [{ layer: 'user', dir: 'user' }]);

    expect(sources).toEqual([{ layer: 'user', path: join(root, 'user', '.rafa', 'config.yaml') }]);
  });

  test('lookup order, not file order, decides the winner', async () => {
    const reversed = [...LOOKUP].reverse();

    const sources = await findSources(root, reversed, [{ layer: 'project', dir: 'project' }]);

    expect(sources).toEqual([{ layer: 'project', path: join(root, 'project', '.rafa', 'config.yaml') }]);
  });

  test('a directory carrying a lookup name is passed over for the next name', async () => {
    const sources = await findSources(root, LOOKUP, [{ layer: 'x', dir: 'dirnamed' }]);

    expect(sources).toEqual([{ layer: 'x', path: join(root, 'dirnamed', '.rafa', 'config.yaml') }]);
  });
});

describe('layers without a file', () => {
  test('a layer whose dir holds no lookup file contributes no source', async () => {
    const sources = await findSources(root, LOOKUP, [{ layer: 'empty', dir: 'empty' }]);

    expect(sources).toEqual([]);
  });

  test('a layer whose dir does not exist contributes no source', async () => {
    const sources = await findSources(root, LOOKUP, [{ layer: 'gone', dir: 'no-such-dir' }]);

    expect(sources).toEqual([]);
  });

  test('a layer whose dir is a file (ENOTDIR) contributes no source', async () => {
    const sources = await findSources(root, LOOKUP, [{ layer: 'f', dir: 'filedir' }]);

    expect(sources).toEqual([]);
  });

  test('no layers yields no sources', async () => {
    expect(await findSources(root, LOOKUP, [])).toEqual([]);
  });

  test('no lookup names yields no sources', async () => {
    expect(await findSources(root, [], [{ layer: 'project', dir: 'project' }])).toEqual([]);
  });
});

describe('layer order and dir resolution', () => {
  test('sources follow layer order, skipping layers with no file', async () => {
    // Arrange
    const layers: LayerDir[] = [
      { layer: 'user', dir: 'user' },
      { layer: 'empty', dir: 'empty' },
      { layer: 'project', dir: 'project' },
    ];

    // Act
    const sources = await findSources(root, LOOKUP, layers);

    // Assert
    expect(sources).toEqual([
      { layer: 'user', path: join(root, 'user', '.rafa', 'config.yaml') },
      { layer: 'project', path: join(root, 'project', 'rafa.config.ts') },
    ]);
  });

  test('a relative dir resolves against cwd, not the process working directory', async () => {
    // Control: the same relative dir from another cwd finds nothing, so the
    // match above depends on cwd.
    const fromRoot = await findSources(root, LOOKUP, [{ layer: 'p', dir: 'project' }]);
    const fromElsewhere = await findSources(join(root, 'empty'), LOOKUP, [{ layer: 'p', dir: 'project' }]);

    expect(fromRoot).toHaveLength(1);
    expect(fromElsewhere).toEqual([]);
  });

  test('"." resolves to cwd itself', async () => {
    const sources = await findSources(join(root, 'project'), LOOKUP, [{ layer: 'here', dir: '.' }]);

    expect(sources).toEqual([{ layer: 'here', path: join(root, 'project', 'rafa.config.ts') }]);
  });

  test('an absolute dir is used as is, whatever cwd is', async () => {
    const dir = join(root, 'user');

    const sources = await findSources(join(root, 'empty'), LOOKUP, [{ layer: 'user', dir }]);

    expect(sources).toEqual([{ layer: 'user', path: join(dir, '.rafa', 'config.yaml') }]);
  });

  test('a relative dir climbing out of cwd resolves normally', async () => {
    const sources = await findSources(join(root, 'empty'), LOOKUP, [{ layer: 'up', dir: '../user' }]);

    expect(sources).toEqual([{ layer: 'up', path: join(root, 'user', '.rafa', 'config.yaml') }]);
  });

  test('two layers may share a dir and each yields the same file', async () => {
    const sources = await findSources(root, LOOKUP, [
      { layer: 'a', dir: 'project' },
      { layer: 'b', dir: 'project' },
    ]);

    expect(sources.map((source) => source.layer)).toEqual(['a', 'b']);
    expect(sources[0]?.path).toBe(sources[1]?.path ?? '');
  });
});

describe('failures', () => {
  test('a stat failure other than absence is thrown, not read as a missing file', async () => {
    // Arrange: a directory without search permission makes stat fail with
    // EACCES. Root ignores permissions, so the control below proves the
    // setup took effect before the assertion is trusted.
    const locked = join(root, 'locked');
    await touch(join(locked, 'rafa.config.ts'));
    await chmod(locked, 0o000);
    try {
      const probe = await findSources(root, LOOKUP, [{ layer: 'l', dir: 'locked' }]).then(
        () => 'resolved',
        (cause: unknown) => (cause as { code?: string }).code ?? 'unknown',
      );
      if (process.getuid?.() === 0) {
        expect(probe).toBe('resolved');
        return;
      }

      // Assert
      expect(probe).toBe('EACCES');
    } finally {
      await chmod(locked, 0o755);
    }
  });

  test('a lookup that is not an array is refused', async () => {
    // @ts-expect-error lookup must be an array of names
    await expect(findSources(root, 'rafa.config.ts', [])).rejects.toThrow(TypeError);
  });

  test('an empty lookup name is refused with its index', async () => {
    await expect(findSources(root, ['a', ''], [])).rejects.toThrow('lookup[1]');
  });

  test('layers that are not an array are refused', async () => {
    // @ts-expect-error layers must be an array
    await expect(findSources(root, LOOKUP, { layer: 'a', dir: '.' })).rejects.toThrow(TypeError);
  });

  test('a layer without a string dir is refused with its index', async () => {
    // @ts-expect-error dir is required
    await expect(findSources(root, LOOKUP, [{ layer: 'a', dir: '.' }, { layer: 'b' }])).rejects.toThrow('layers[1]');
  });
});
