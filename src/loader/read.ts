/**
 * `read`: the second step of the loader. It reads one source file found by
 * `lookup` into the entries of its layer, each tagged with `$layer`, or
 * reports why it could not.
 *
 * Readers, by the file's extension (`extname`, compared as written):
 * - `.ts`, `.mts`, `.mjs`, `.js`: `import()` of the file's URL, taking the
 *   module's `default` export.
 * - `.json`: `readFile` as UTF-8, then `JSON.parse`.
 * - any other extension: `loaders[ext](text, path)`, the reader the host
 *   supplies, called with the file read as UTF-8 and its absolute path. It
 *   may return the value or a promise of it. A `loaders` entry keyed by one
 *   of the extensions above is not used: those are always read built in.
 *
 * What a reader yields becomes the layer's entries: an array is a list of
 * entries (what `defineConfig` returns), and one plain object is one entry.
 * Every entry is copied with `$layer` set to the source's layer, replacing
 * any `$layer` the file wrote; the value the file yielded is not changed.
 *
 * A source that cannot be read gives one error-level `load-failed`
 * diagnostic at `[layer, path]` and no entries: an extension with no
 * reader, a failing `readFile`, an `import()` that throws (the module
 * throws at load or does not compile), a `JSON.parse` or host reader that
 * throws, a module with no `default` export, and a value that is neither
 * an array nor a plain object, or an array holding something other than a
 * plain object.
 *
 * Nothing is cached here: `import()` is called on every read. The
 * runtime's module cache still applies, so a path already imported in this
 * process yields the module it loaded first, even when the file has since
 * changed.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { Source } from './lookup';

import { readFile } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { error } from '../diagnostics';

/**
 * A reader the host supplies for one extension: it turns the file's text
 * into an array of entries or one entry object.
 *
 * @param text - The file's contents, read as UTF-8.
 * @param path - The file's absolute path, for the reader's own messages.
 * @returns The parsed value, or a promise of it.
 */
export type Loader = (text: string, path: string) => unknown;

/**
 * Host readers keyed by extension with its leading dot (`'.yaml'`), for
 * the extensions not read built in.
 */
export type Loaders = Readonly<Record<string, Loader>>;

/** One entry read from a source, tagged with the source's layer. */
export type TaggedEntry = Readonly<Record<string, unknown>> & {
  /** The layer of the source the entry was read from. */
  readonly $layer: string;
};

/** What {@link readSource} returns: the entries, or why there are none. */
export type ReadResult =
  | {
    /** The source was read. */
    readonly ok: true;
    /** The entries read, in file order, each tagged with `$layer`. */
    readonly entries: readonly TaggedEntry[];
  }
  | {
    /** The source could not be read; the layer contributes nothing. */
    readonly ok: false;
    /** The `load-failed` diagnostic at `[layer, path]`. */
    readonly diagnostic: Diagnostic;
  };

/** Extensions read through `import()`. */
const MODULE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.mts', '.mjs', '.js']);

/** The extension read through `JSON.parse`. */
const JSON_EXTENSION = '.json';

/** A source that could not be read, with the reason why. */
class LoadFailure {
  constructor(readonly reason: string) {}
}

/** The message of a thrown value; `import()` may reject with a non-`Error`. */
function messageOf(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    return String(cause.message);
  }
  return String(cause);
}

/** Describe a value for a message: `null`, `an array`, or its `typeof`. */
function kindOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  if (typeof value === 'object') {
    return 'a non-plain object';
  }
  return typeof value;
}

/** `true` for an object whose prototype is `Object.prototype` or `null`. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Run `step`, turning anything it throws into a {@link LoadFailure}. */
async function attempt<T>(what: string, step: () => Promise<T> | T): Promise<T> {
  try {
    return await step();
  } catch (cause) {
    throw new LoadFailure(`${what}: ${messageOf(cause)}`);
  }
}

/** Import the module at `path` and take its `default` export. */
async function readModule(path: string): Promise<unknown> {
  const namespace: unknown = await attempt('import failed', () => import(pathToFileURL(path).href));
  if (typeof namespace !== 'object' || namespace === null || !('default' in namespace)) {
    throw new LoadFailure('the module has no default export');
  }
  return namespace.default;
}

/** Read `path` as UTF-8 text. */
function readText(path: string): Promise<string> {
  return attempt('could not read the file', () => readFile(path, 'utf8'));
}

/** The host reader for `extension`, if one is given; refuses a non-function. */
function hostLoader(extension: string, loaders: Loaders): Loader | undefined {
  if (!Object.hasOwn(loaders, extension)) {
    return undefined;
  }
  const loader: unknown = loaders[extension];
  if (typeof loader !== 'function') {
    throw new TypeError(`loaders[${JSON.stringify(extension)}]: expected a function, got ${typeof loader}`);
  }
  return loader as Loader;
}

/** Read the raw value of `path` with the reader its extension selects. */
async function readValue(path: string, loaders: Loaders): Promise<unknown> {
  const extension = extname(path);
  if (MODULE_EXTENSIONS.has(extension)) {
    return readModule(path);
  }
  if (extension === JSON_EXTENSION) {
    const text = await readText(path);
    return attempt('invalid JSON', () => JSON.parse(text) as unknown);
  }
  const loader = hostLoader(extension, loaders);
  if (loader === undefined) {
    const shown = extension === ''
      ? 'a file with no extension'
      : `extension ${JSON.stringify(extension)}`;
    throw new LoadFailure(`no reader for ${shown}; pass one in loaders`);
  }
  const text = await readText(path);
  return attempt(`loaders[${JSON.stringify(extension)}] threw`, () => loader(text, path));
}

/** The entries `value` holds: an array of plain objects, or one plain object. */
function entriesOf(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (isPlainObject(value)) {
    return [value];
  }
  if (!Array.isArray(value)) {
    throw new LoadFailure(`expected an array of entries or one entry object, got ${kindOf(value)}`);
  }
  // An index loop rather than map: map skips the holes of a sparse array.
  const entries: Readonly<Record<string, unknown>>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (!isPlainObject(entry)) {
      throw new LoadFailure(`entry ${index}: expected an entry object, got ${kindOf(entry)}`);
    }
    entries.push(entry);
  }
  return entries;
}

/** Refuse a source that is not `{ layer, path }` with an absolute path. */
function checkSource(source: unknown): asserts source is Source {
  if (typeof source !== 'object' || source === null) {
    throw new TypeError(`readSource: expected a source { layer, path }, got ${kindOf(source)}`);
  }
  const { layer, path } = source as Partial<Record<'layer' | 'path', unknown>>;
  if (typeof layer !== 'string' || typeof path !== 'string') {
    throw new TypeError('readSource: layer and path must both be strings');
  }
  if (!isAbsolute(path)) {
    throw new TypeError(`readSource: path must be absolute, got ${JSON.stringify(path)}`);
  }
}

/** Refuse `loaders` that is not a plain object. */
function checkLoaders(loaders: unknown): asserts loaders is Loaders {
  if (!isPlainObject(loaders)) {
    throw new TypeError(`readSource: expected loaders to be an object, got ${kindOf(loaders)}`);
  }
}

/**
 * Read one source into its layer's entries, by the rules in this module's
 * description. The value the file yields is never changed: each entry is a
 * shallow copy carrying `$layer`.
 *
 * @example
 * ```ts
 * await readSource({ layer: 'user', path: '/home/me/.rafa/config.yaml' }, {
 *   '.yaml': (text) => Bun.YAML.parse(text),
 * });
 * // { ok: true, entries: [{ loop: { settingSources: 'project' }, $layer: 'user' }] }
 *
 * await readSource({ layer: 'user', path: '/home/me/.rafa/config.yaml' });
 * // { ok: false, diagnostic: { level: 'error', code: 'load-failed',
 * //   path: ['user', '/home/me/.rafa/config.yaml'],
 * //   message: 'no reader for extension ".yaml"; pass one in loaders' } }
 * ```
 *
 * @param source - The layer and the absolute path of its file, as `lookup`
 *   finds them.
 * @param loaders - Host readers by extension for the extensions not read
 *   built in. Defaults to none.
 * @returns `{ ok: true, entries }` with the tagged entries in file order,
 *   or `{ ok: false, diagnostic }` with one error-level `load-failed`
 *   diagnostic at `[layer, path]` whose message names the reason.
 * @throws {TypeError} When `source` is not `{ layer, path }` with string
 *   fields and an absolute path, when `loaders` is not a plain object, or
 *   when the `loaders` entry for the file's extension is not a function.
 */
export async function readSource(source: Source, loaders: Loaders = {}): Promise<ReadResult> {
  checkSource(source);
  checkLoaders(loaders);
  const { layer, path } = source;
  try {
    const entries = entriesOf(await readValue(path, loaders));
    return { ok: true, entries: entries.map((entry) => ({ ...entry, $layer: layer })) };
  } catch (cause) {
    if (cause instanceof LoadFailure) {
      return { ok: false, diagnostic: error('load-failed', [layer, path], cause.reason) };
    }
    throw cause;
  }
}
