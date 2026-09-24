/**
 * `createLoader`: the one convenience of the library. It finds each
 * layer's config file, reads it, and runs the stages over what it read:
 *
 * 1. `./lookup` finds the first `lookup` name that is a file in each
 *    layer's directory (a relative `dir` resolves against `cwd`); a layer
 *    with none contributes no source;
 * 2. `./read` reads each source by extension into entries tagged with
 *    `$layer`; a source it cannot read yields one `load-failed` error and
 *    its layer is skipped;
 * 3. `merge` applies every entry read, layer order then file order, with
 *    the host's `required` and `duplicates`; each source is returned with
 *    the range of those entries it contributed, and the merge's provenance
 *    is returned beside it;
 * 4. `validate` runs the host's `schema` over the merged value, when one
 *    is given;
 * 5. `resolveGraph` resolves the merged `flows` section against the host's
 *    `steps`, when a registry is given.
 *
 * Nothing is cached here: every `load` looks up and reads the files again.
 * A `.json` file or one read by a host loader is read fresh each time. A
 * module file (`.ts`, `.mts`, `.mjs`, `.js`) goes through `import()`, and
 * with the `reload` option off (the default) the runtime's module cache
 * applies, so a module source already imported in this process yields the
 * module it loaded first, even after an edit. With `reload: true` the
 * config file is evaluated again when its bytes change; a module it
 * imports stays cached, and one module is retained per distinct content
 * for the life of the process (see {@link LoaderOptions.reload}).
 *
 * A config file read through `import()` is code, and it runs when it is
 * loaded; which files to trust is the host's decision.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { Graph, StepRegistry } from '../graph/types';
import type { Provenance } from '../merge/apply';
import type { DuplicatesOption } from '../merge/duplicates';
import type { StandardSchemaV1 } from '../standard-schema';
import type { SchemaSection } from '../validate';
import type { FoundSource, LayerDir } from './lookup';
import type { Loaders, ReadResult, TaggedEntry } from './read';

import { resolveGraph } from '../graph';
import { merge } from '../merge';
import { validate, validateSections } from '../validate';

import { findSources } from './lookup';
import { readSource } from './read';

export type { LayerDir } from './lookup';
export type { Loader, Loaders } from './read';

/** The file found for one layer, and the entries it contributed. */
export interface Source extends FoundSource {
  /**
   * The half-open range `[from, to)` of entry indexes this file
   * contributed: the indexes that the `entry` of a merge diagnostic and of
   * a provenance record use, all layers' entries concatenated in layer
   * order. Ranges follow source order and meet end to start, so they tile
   * the entries read. `from === to` when the file contributed no entry:
   * it failed to read, or it yielded an empty array.
   */
  readonly entries: readonly [from: number, to: number];
}

/** Options accepted by {@link createLoader} and {@link load}. */
export interface LoaderOptions {
  /**
   * File names to try in each layer directory, first match wins. A name may
   * hold a subpath, such as `.rafa/config.yaml`.
   */
  readonly lookup: readonly string[];
  /**
   * Layers in order, lowest precedence first: a label and the directory to
   * look in. A relative `dir` resolves against the `cwd` given to `load`.
   */
  readonly layers: readonly LayerDir[];
  /**
   * What the merged value must satisfy: one Standard Schema V1 schema over
   * the whole value, or `[path, schema]` sections each validated over the
   * subtree at `path`. When absent, nothing is validated.
   */
  readonly schema?: StandardSchemaV1 | readonly SchemaSection[];
  /**
   * The host's step registry. When given, the merged `flows` section is
   * resolved into a graph; when absent, no graph is built.
   */
  readonly steps?: StepRegistry;
  /** Dot-joined key paths that must be present in the merged value. */
  readonly required?: readonly string[];
  /**
   * Host readers by extension (`'.yaml'`) for the extensions not read built
   * in (`.ts`, `.mts`, `.mjs`, `.js`, `.json`).
   */
  readonly loaders?: Loaders;
  /**
   * How a key set by two entries of the same layer is reported: `warn`
   * (the default), `error` or `allow`.
   */
  readonly duplicates?: DuplicatesOption;
  /**
   * Whether a module config file (`.ts`, `.mts`, `.mjs`, `.js`) is
   * evaluated again when its bytes change. Defaults to `false`: the
   * runtime's module cache applies, and a file already imported in this
   * process yields the module it loaded first. With `true`, each `load`
   * reads the file's bytes and imports it by their content, so an edit is
   * seen and an unchanged file is not evaluated again. Two limits, by
   * design: only the config file itself is evaluated again, and the
   * modules it imports stay cached; and every distinct content stays in the
   * runtime's module registry for the life of the process, one module
   * retained per edit. A `.json` file or one read by `loaders` is read
   * fresh either way. A CLI that loads once needs nothing.
   */
  readonly reload?: boolean;
}

/** What {@link load} returns. */
export interface LoadResult {
  /**
   * The merged value of every entry read. It is returned even when there
   * are errors; with no source read it is `{}`.
   */
  readonly config: Readonly<Record<string, unknown>>;
  /**
   * The step graph of the merged `flows` section. Present only when
   * `steps` was given; a missing `flows` section resolves to an empty
   * graph.
   */
  readonly graph?: Graph;
  /**
   * Every problem found, in stage order: the `load-failed` errors in layer
   * order, then merge's, then the schema's, then the graph's. The `entry`
   * of a merge diagnostic indexes the entries read, all layers' entries
   * concatenated in layer order.
   */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The file found for each layer that has one, in layer order, with an
   * absolute `path` and the `entries` range it contributed. A source that
   * failed to read is listed here too, with an empty range; its
   * `load-failed` diagnostic says why it contributed nothing.
   */
  readonly sources: readonly Source[];
  /**
   * Which entries touched which key path, as `merge` recorded it: each
   * dot-joined path (`''` for the root) mapped to its records in entry
   * order. A record's `entry` falls in the `entries` range of exactly one
   * source, which names the file it came from. Read one path with
   * `provenanceOf`. The map, its arrays and its records are frozen.
   */
  readonly provenance: Provenance;
}

/** What {@link createLoader} returns. */
export interface ConfigLoader {
  /**
   * Look up, read, merge, validate and resolve the config for `cwd`; see
   * {@link load}.
   *
   * @param cwd - Directory a relative layer `dir` resolves against.
   * @returns The merged config, the graph when `steps` was given, every
   *   diagnostic, the sources found and the provenance.
   */
  readonly load: (cwd: string) => Promise<LoadResult>;
}

/** `typeof`, told apart for `null` and arrays, for messages. */
function kindOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value)
    ? 'an array'
    : typeof value;
}

/** `true` for a non-null object that is not an array. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Refuse options that are not an object, or a `schema`/`steps`/`reload` of the wrong kind. */
function checkOptions(options: unknown): asserts options is LoaderOptions {
  if (!isRecord(options)) {
    throw new TypeError(`createLoader: expected options to be an object, got ${kindOf(options)}`);
  }
  const { schema, steps, reload } = options;
  if (schema !== undefined && typeof schema !== 'object') {
    throw new TypeError(`createLoader: expected schema to be a Standard Schema or sections, got ${kindOf(schema)}`);
  }
  if (schema === null) {
    throw new TypeError('createLoader: expected schema to be a Standard Schema or sections, got null');
  }
  if (steps !== undefined && !isRecord(steps)) {
    throw new TypeError(`createLoader: expected steps to be an object, got ${kindOf(steps)}`);
  }
  if (reload !== undefined && typeof reload !== 'boolean') {
    throw new TypeError(`createLoader: expected reload to be a boolean, got ${kindOf(reload)}`);
  }
}

/** Validate `value` with a whole-value schema or with sections. */
function schemaDiagnostics(value: unknown, schema: LoaderOptions['schema']): readonly Diagnostic[] {
  if (schema === undefined) {
    return [];
  }
  return Array.isArray(schema)
    ? validateSections(value, schema as readonly SchemaSection[])
    : validate(value, schema as StandardSchemaV1);
}

/**
 * The merged `flows` section as `resolveGraph` takes it. A missing section
 * is no flows; a section that is not an object is also read as no flows,
 * since telling the host its type is wrong is the schema's job.
 */
function flowsOf(config: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const flows = config['flows'];
  return isRecord(flows)
    ? flows
    : {};
}

/** The entries a read yielded; none when it failed. */
function entriesOf(result: ReadResult): readonly TaggedEntry[] {
  return result.ok
    ? result.entries
    : [];
}

/**
 * Read every source, keeping source order; failures become diagnostics.
 * Each source's `entries` range is counted from its own read, in the order
 * the entries are concatenated, so a failed read holds an empty range.
 */
async function readAll(
  found: readonly FoundSource[],
  loaders: Loaders | undefined,
  reload: boolean,
): Promise<{ sources: readonly Source[]; entries: readonly TaggedEntry[]; diagnostics: readonly Diagnostic[] }> {
  const reads = await Promise.all(found.map(async (source) => ({ source, result: await readSource(source, loaders, { reload }) })));
  let next = 0;
  const sources = reads.map(({ source, result }): Source => {
    const from = next;
    next += entriesOf(result).length;
    return { layer: source.layer, path: source.path, entries: [from, next] };
  });
  return {
    sources,
    entries: reads.flatMap(({ result }) => entriesOf(result)),
    diagnostics: reads.flatMap(({ result }) => (result.ok
      ? []
      : [result.diagnostic])),
  };
}

/**
 * Load the config for `cwd` in one call, by the steps in this module's
 * description. Sources are looked up and read concurrently; results keep
 * layer order. Nothing passed in is mutated.
 *
 * @example
 * ```ts
 * await load('/work/project', {
 *   lookup: ['rafa.config.ts', '.rafa/config.yaml'],
 *   layers: [{ layer: 'user', dir: '/home/me' }, { layer: 'project', dir: '.' }],
 *   loaders: { '.yaml': (text) => Bun.YAML.parse(text) },
 * });
 * // { config: { … }, diagnostics: [],
 * //   sources: [{ layer: 'user', path: '/home/me/.rafa/config.yaml', entries: [0, 1] },
 * //             { layer: 'project', path: '/work/project/rafa.config.ts', entries: [1, 2] }],
 * //   provenance: Map(…) {…} }
 * ```
 *
 * @param cwd - Directory a relative layer `dir` resolves against.
 * @param options - See {@link LoaderOptions}.
 * @returns `{ config, graph, diagnostics, sources, provenance }`; `graph`
 *   only when `options.steps` is given.
 * @throws {TypeError} When `options` is not an object, `schema` is not an
 *   object, `steps` is not an object, or `reload` is given and is not a
 *   boolean; when `lookup` or `layers` is
 *   malformed (see `findSources`); when `loaders` is not an object or its
 *   entry for a found file's extension is not a function (see
 *   `readSource`); when `required` or `duplicates` is malformed (see
 *   `merge`); or when the schema validates asynchronously.
 * @throws The `stat` error, unchanged, when a lookup path fails for a
 *   reason other than absence.
 */
export async function load(cwd: string, options: LoaderOptions): Promise<LoadResult> {
  checkOptions(options);
  const found = await findSources(cwd, options.lookup, options.layers);
  const read = await readAll(found, options.loaders, options.reload === true);
  const merged = merge(read.entries, {
    ...(options.duplicates === undefined
      ? {}
      : { duplicates: options.duplicates }),
    ...(options.required === undefined
      ? {}
      : { required: options.required }),
  });
  const checked = schemaDiagnostics(merged.value, options.schema);
  const base = {
    config: merged.value,
    sources: read.sources,
    provenance: merged.provenance,
  };
  if (options.steps === undefined) {
    return { ...base, diagnostics: [...read.diagnostics, ...merged.diagnostics, ...checked] };
  }
  const resolved = resolveGraph(flowsOf(merged.value), options.steps);
  return {
    ...base,
    graph: resolved.graph,
    diagnostics: [...read.diagnostics, ...merged.diagnostics, ...checked, ...resolved.diagnostics],
  };
}

/**
 * Create a loader bound to `options`. The options are checked and copied
 * now, so a later change to the caller's `lookup` or `layers` arrays does
 * not reach the loader; each `load(cwd)` then runs {@link load}.
 *
 * @example
 * ```ts
 * const loader = createLoader({
 *   lookup: ['rafa.config.ts', '.rafa/config.yaml'],
 *   layers: [{ layer: 'user', dir: homedir() }, { layer: 'project', dir: '.' }],
 *   schema,
 *   steps,
 *   loaders: { '.yaml': (text) => Bun.YAML.parse(text) },
 * });
 * const { config, graph, diagnostics, sources, provenance } = await loader.load(process.cwd());
 * ```
 *
 * @param options - See {@link LoaderOptions}.
 * @returns `{ load }`.
 * @throws {TypeError} When `options` is not an object, `schema` is not an
 *   object, `steps` is not an object, or `reload` is given and is not a
 *   boolean. Every other malformed option is
 *   refused by `load`.
 */
export function createLoader(options: LoaderOptions): ConfigLoader {
  checkOptions(options);
  const bound: LoaderOptions = {
    ...options,
    lookup: Array.isArray(options.lookup)
      ? [...options.lookup]
      : options.lookup,
    layers: Array.isArray(options.layers)
      ? options.layers.map((item) => (isRecord(item)
        ? { ...item }
        : item))
      : options.layers,
  };
  return { load: (cwd) => load(cwd, bound) };
}
