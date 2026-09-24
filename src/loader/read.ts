/**
 * `read`: the second step of the loader. It reads one source file found by
 * `lookup` into the entries of its layer, each tagged with `$layer`, or
 * reports why it could not.
 *
 * Readers, by the file's extension (`extname`, compared as written):
 * - `.ts`, `.mts`, `.mjs`, `.js`: `import()` of the file's URL (with
 *   `reload`, of a content-keyed specifier; see below), taking the module's
 *   `default` export.
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
 * Nothing is cached here: `import()` is called on every read. With the
 * `reload` option off (the default) the runtime's module cache still
 * applies, so a path already imported in this process yields the module it
 * loaded first, even when the file has since changed. With `reload: true`
 * a module file's bytes are read and hashed first, and the import goes
 * through a specifier carrying that content key: unchanged bytes give the
 * same specifier and the module already loaded, changed bytes give a new
 * specifier and a fresh evaluation. A file that cannot be read then is
 * `load-failed` with `could not read the file`, as a `.json` read is. The
 * option has two limits, both by design:
 * - Only the file itself is evaluated again. A module it imports resolves
 *   to a specifier with no content key and stays cached, so an edit to that
 *   module is not seen.
 * - Every distinct content stays in the runtime's module registry for the
 *   life of the process: one module is retained per edit.
 *

 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { FoundSource } from './lookup';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { error } from '../diagnostics';
import { isPlainObject } from '../merge/plain-object';

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

/** How {@link readSource} reads a source. */
export type ReadOptions = {
  /**
   * Import a module file (`.ts`, `.mts`, `.mjs`, `.js`) through a
   * specifier keyed by its contents, so an edited file is evaluated again
   * within one process. Only that file is evaluated again, and each
   * distinct content stays loaded for the life of the process; see the
   * module description. Other files are read fresh either way. Defaults to
   * `false`: the import uses the file's URL and the runtime's module cache.
   */
  readonly reload?: boolean;
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

/** Run `step`, turning anything it throws into a {@link LoadFailure}. */
async function attempt<T>(what: string, step: () => Promise<T> | T): Promise<T> {
  try {
    return await step();
  } catch (cause) {
    throw new LoadFailure(`${what}: ${messageOf(cause)}`);
  }
}

/** Length, in hex digits, of the content key a reload specifier carries. */
const CONTENT_KEY_LENGTH = 16;

/** Whether this process runs on Bun rather than Node. */
const IS_BUN = typeof process.versions.bun === 'string';

/**
 * The specifier a `reload` import of `path` uses, carrying the content key
 * `key` as the query `?v=<key>`. The form depends on the runtime: Bun
 * ignores a query on a `file://` URL and serves the module it loaded
 * first, but honours one on the plain absolute path; Node honours the query
 * on the file URL, and its plain-path form breaks on a path holding `#`.
 *
 * Not part of the package's public API: exported for its tests.
 *
 * @internal
 * @param path - The module file's absolute path.
 * @param key - The content key of the file's bytes.
 * @param isBun - Whether the import runs on Bun.
 * @returns `` `${path}?v=${key}` `` on Bun, and the file URL of `path` with
 *   `?v=${key}` appended on any other runtime.
 */
export function reloadSpecifier(path: string, key: string, isBun: boolean): string {
  return isBun
    ? `${path}?v=${key}`
    : `${pathToFileURL(path).href}?v=${key}`;
}

/** The specifier to import `path` by: its file URL, or a reload specifier. */
async function moduleSpecifier(path: string, reload: boolean): Promise<string> {
  if (!reload) {
    return pathToFileURL(path).href;
  }
  const bytes = await attempt('could not read the file', () => readFile(path));
  const key = createHash('sha256').update(bytes)
    .digest('hex')
    .slice(0, CONTENT_KEY_LENGTH);
  return reloadSpecifier(path, key, IS_BUN);
}

/** Import the module at `path` and take its `default` export. */
async function readModule(path: string, reload: boolean): Promise<unknown> {
  const specifier = await moduleSpecifier(path, reload);
  const namespace: unknown = await attempt('import failed', () => import(specifier));
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
async function readValue(path: string, loaders: Loaders, reload: boolean): Promise<unknown> {
  const extension = extname(path);
  if (MODULE_EXTENSIONS.has(extension)) {
    return readModule(path, reload);
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
function checkSource(source: unknown): asserts source is FoundSource {
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

/** Refuse `options` that is not a plain object, or a `reload` that is not a boolean. */
function checkOptions(options: unknown): asserts options is ReadOptions {
  if (!isPlainObject(options)) {
    throw new TypeError(`readSource: expected options to be an object, got ${kindOf(options)}`);
  }
  const { reload } = options as { readonly reload?: unknown };
  if (reload !== undefined && typeof reload !== 'boolean') {
    throw new TypeError(`readSource: expected options.reload to be a boolean, got ${kindOf(reload)}`);
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
 *
 * // Sees an edit to rafa.config.ts made since an earlier read.
 * await readSource({ layer: 'project', path: '/repo/rafa.config.ts' }, {}, { reload: true });
 * ```
 *
 * @param source - The layer and the absolute path of its file, as `lookup`
 *   finds them.
 * @param loaders - Host readers by extension for the extensions not read
 *   built in. Defaults to none.
 * @param options - How to read: `reload` imports a module file by its
 *   contents so an edit is seen. Defaults to `{}`, no reload.
 * @returns `{ ok: true, entries }` with the tagged entries in file order,
 *   or `{ ok: false, diagnostic }` with one error-level `load-failed`
 *   diagnostic at `[layer, path]` whose message names the reason.
 * @throws {TypeError} When `source` is not `{ layer, path }` with string
 *   fields and an absolute path, when `loaders` is not a plain object, when
 *   `options` is not a plain object or its `reload` is given and is not a
 *   boolean, or when the `loaders` entry for the file's extension is not a
 *   function.
 */
export async function readSource(
  source: FoundSource,
  loaders: Loaders = {},
  options: ReadOptions = {},
): Promise<ReadResult> {
  checkSource(source);
  checkLoaders(loaders);
  checkOptions(options);
  const { layer, path } = source;
  try {
    const entries = entriesOf(await readValue(path, loaders, options.reload === true));
    return { ok: true, entries: entries.map((entry) => ({ ...entry, $layer: layer })) };
  } catch (cause) {
    if (cause instanceof LoadFailure) {
      return { ok: false, diagnostic: error('load-failed', [layer, path], cause.reason) };
    }
    throw cause;
  }
}
