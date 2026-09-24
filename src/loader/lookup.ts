/**
 * `lookup`: the first step of the loader. For each layer, in the order
 * given, it tries the lookup names in order under the layer's directory and
 * keeps the first one that exists as a file, yielding one source per layer
 * that has one.
 *
 * Rules:
 * - a relative `dir` resolves against `cwd`; an absolute `dir` is kept.
 *   Lookup names resolve against the layer's directory and may hold a
 *   subpath, such as `.rafa/config.yaml`.
 * - a name "exists" when `stat` succeeds on it and it is a file. A
 *   directory carrying a lookup name is passed over, since it cannot be
 *   read as a config.
 * - a path that is missing (`ENOENT`) or runs through a non-directory
 *   (`ENOTDIR`) is passed over. Any other `stat` failure, such as
 *   `EACCES`, is thrown rather than read as absence.
 * - a layer with no matching file yields no source; sources keep layer
 *   order.
 *
 * Nothing is read beyond `stat`, and nothing is cached: each call looks
 * again.
 *
 * @module
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

/** One layer the loader reads: a label and the directory to look in. */
export interface LayerDir {
  /** Label of the layer, carried into `$layer` of every entry read from it. */
  readonly layer: string;
  /** Directory to look in; a relative one resolves against `cwd`. */
  readonly dir: string;
}

/** The file found for one layer. */
export interface Source {
  /** Label of the layer the file was found for. */
  readonly layer: string;
  /** Absolute path of the file. */
  readonly path: string;
}

/** `stat` error codes read as "this name does not exist here". */
const ABSENT_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/** `true` for a Node system error whose code means the path is absent. */
function isAbsence(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) {
    return false;
  }
  return typeof cause.code === 'string' && ABSENT_CODES.has(cause.code);
}

/** `true` when `path` exists and is a file; throws on a failure other than absence. */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (cause) {
    if (isAbsence(cause)) {
      return false;
    }
    throw cause;
  }
}

/** The first of `names` that is a file under `dir`, tried in order. */
async function firstFile(dir: string, names: readonly string[]): Promise<string | undefined> {
  for (const name of names) {
    const path = resolve(dir, name);
    if (await isFile(path)) {
      return path;
    }
  }
  return undefined;
}

/** Refuse a lookup list that is not an array of non-empty strings. */
function checkLookup(names: unknown): asserts names is readonly string[] {
  if (!Array.isArray(names)) {
    throw new TypeError(`lookup: expected an array of file names, got ${typeof names}`);
  }
  names.forEach((name: unknown, index) => {
    if (typeof name !== 'string' || name === '') {
      throw new TypeError(`lookup[${index}]: expected a non-empty file name, got ${JSON.stringify(name)}`);
    }
  });
}

/** Refuse a layer list that is not an array of `{ layer, dir }` with string fields. */
function checkLayers(layers: unknown): asserts layers is readonly LayerDir[] {
  if (!Array.isArray(layers)) {
    throw new TypeError(`layers: expected an array of { layer, dir }, got ${typeof layers}`);
  }
  layers.forEach((item: unknown, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new TypeError(`layers[${index}]: expected { layer, dir }, got ${JSON.stringify(item)}`);
    }
    const { layer, dir } = item as Partial<Record<'layer' | 'dir', unknown>>;
    if (typeof layer !== 'string' || typeof dir !== 'string') {
      throw new TypeError(`layers[${index}]: layer and dir must both be strings`);
    }
  });
}

/**
 * Find the first existing lookup file in each layer's directory, by the
 * rules in this module's description. Layers are looked up concurrently;
 * the result keeps layer order.
 *
 * @example
 * ```ts
 * await findSources('/work/project', ['rafa.config.ts', '.rafa/config.yaml'], [
 *   { layer: 'user', dir: '/home/me' },
 *   { layer: 'project', dir: '.' },
 * ]);
 * // [{ layer: 'user', path: '/home/me/.rafa/config.yaml' },
 * //  { layer: 'project', path: '/work/project/rafa.config.ts' }]
 * ```
 *
 * @param cwd - Directory a relative layer `dir` resolves against; itself
 *   resolved against the process working directory when relative.
 * @param lookup - File names to try in each layer directory, first match
 *   wins.
 * @param layers - Layers in order, each a label and a directory.
 * @returns One source per layer that holds a lookup file, in layer order,
 *   with an absolute `path`.
 * @throws {TypeError} When `lookup` is not an array of non-empty strings, or
 *   `layers` is not an array of `{ layer, dir }` with string fields.
 * @throws The `stat` error, unchanged, when a lookup path fails for a reason
 *   other than `ENOENT` or `ENOTDIR`.
 */
export async function findSources(
  cwd: string,
  lookup: readonly string[],
  layers: readonly LayerDir[],
): Promise<Source[]> {
  checkLookup(lookup);
  checkLayers(layers);
  const found = await Promise.all(
    layers.map(async ({ layer, dir }) => ({ layer, path: await firstFile(resolve(cwd, dir), lookup) })),
  );
  return found.flatMap(({ layer, path }) => (path === undefined
    ? []
    : [{ layer, path }]));
}
