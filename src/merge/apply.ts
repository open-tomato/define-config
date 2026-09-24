/**
 * `apply`: one merge step. It lays one entry onto the state accumulated from
 * the entries before it and returns a new state; neither the entry nor the
 * previous state is changed.
 *
 * Rules, per key of the entry:
 * - a scalar, a function, an array or any non-plain object (a `Date`, a
 *   `Map`, a class instance) is a value: it replaces what was there. An
 *   array is never merged element-wise.
 * - a plain object is a keyed map: it merges into the map already there,
 *   key by key and recursively, or starts a new map when none is there.
 * - `false` removes the key.
 * - `{ $replace: true, …rest }` replaces the whole subtree at the key with
 *   `rest`, discarding what earlier entries put there. `rest` is read by the
 *   same rules onto an empty map, so a `false` inside it leaves its key out.
 *   The `$replace` key never reaches the value, whatever it is set to; only
 *   `true` replaces.
 * - `undefined` is the same as an absent key: it changes nothing.
 * - `$layer` on the entry itself labels its layer and never reaches the
 *   value. Below the top level it is an ordinary key.
 *
 * While it applies, `apply` records provenance: which entries touched which
 * key path, and how. The duplicate and required checks read it instead of
 * walking the entries again.
 *
 * @module
 */

/** A plain object: the only kind of value the merge descends into. */
type PlainObject = Readonly<Record<string, unknown>>;

/**
 * How an entry touched a key path:
 * - `set`: wrote a value there, or started a new map there (a map merged
 *   into a map already at the path records nothing at the path itself,
 *   only at the keys below it that it writes);
 * - `remove`: had `false` there, whether or not the key existed;
 * - `replace`: had `{ $replace: true, … }` there.
 */
export type ProvenanceKind = 'set' | 'remove' | 'replace';

/** One touch of a key path by one entry. */
export interface ProvenanceRecord {
  /** Zero-based index of the entry, as passed to {@link apply}. */
  readonly entry: number;
  /** The entry's `$layer`; absent when the entry carries none. */
  readonly layer?: string;
  /** What the entry did at the path. */
  readonly kind: ProvenanceKind;
}

/**
 * Provenance: for each dot-joined key path (see {@link pathKey}), the
 * records of the entries that touched it, in the order they applied. A path
 * keeps its records after a later entry removes or replaces it, so the
 * history of a dropped path stays readable.
 *
 * Keys that themselves contain a dot share a dot-joined path with the
 * nested keys they spell (`{ 'a.b': 1 }` and `{ a: { b: 1 } }` both record
 * at `a.b`), the same limit as the dot-joined `Required` paths of
 * `ConfigEntry`.
 */
export type Provenance = ReadonlyMap<string, readonly ProvenanceRecord[]>;

/** What the merge carries from one entry to the next. */
export interface MergeState {
  /** The value merged so far. */
  readonly value: Readonly<Record<string, unknown>>;
  /** Who touched which path so far. */
  readonly provenance: Provenance;
}

/** The key under which `$replace` marks a replacing subtree. */
const REPLACE_KEY = '$replace';
/** The key under which a top-level entry names its layer. */
const LAYER_KEY = '$layer';

/**
 * Join a key path with dots, as provenance keys and `required` paths are
 * written. The empty path (the entry itself) joins to `''`.
 *
 * @param path - Key path, outermost key first.
 * @returns The dot-joined path.
 */
export function pathKey(path: readonly string[]): string {
  return path.join('.');
}

/**
 * The state before any entry applies: an empty value and no provenance.
 * Each call returns a new state.
 *
 * @returns A new empty state.
 */
export function initialState(): MergeState {
  return { value: {}, provenance: new Map() };
}

/** `true` for an object whose prototype is `Object.prototype` or `null`. */
function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Deep-copy a value that is kept whole (an array and what it holds, or a
 * plain object inside one). Arrays are data, so nothing inside them is
 * interpreted: `false` and `$replace` are copied as they are. Other values
 * are returned as they are: primitives have no identity, and functions and
 * class instances cannot be copied faithfully.
 */
function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(copyValue);
  }
  if (isPlainObject(value)) {
    // Object.fromEntries defines own properties, so a `__proto__` key stays
    // a key instead of changing the copy's prototype.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, copyValue(item)]),
    );
  }
  return value;
}

/** Who is applying, and where the records they leave go. */
interface Context {
  readonly entry: number;
  readonly layer: string | undefined;
  readonly records: [string, ProvenanceRecord][];
}

function record(context: Context, path: readonly string[], kind: ProvenanceKind): void {
  const touch: ProvenanceRecord = context.layer === undefined
    ? { entry: context.entry, kind }
    : { entry: context.entry, layer: context.layer, kind };
  context.records.push([pathKey(path), touch]);
}

/**
 * Lay `patch` onto `base` (or onto nothing) and return the new map. Keys of
 * `base` that `patch` does not touch keep their order and their value, by
 * reference; keys new to the map follow them.
 */
function applyMap(
  base: PlainObject | undefined,
  patch: PlainObject,
  path: readonly string[],
  context: Context,
): Record<string, unknown> {
  const result = new Map<string, unknown>(base === undefined
    ? []
    : Object.entries(base));
  for (const key of Object.keys(patch)) {
    const isReserved = key === REPLACE_KEY || (path.length === 0 && key === LAYER_KEY);
    const value = patch[key];
    if (isReserved || value === undefined) {
      continue;
    }
    const childPath = [...path, key];
    if (value === false) {
      result.delete(key);
      record(context, childPath, 'remove');
    } else if (isPlainObject(value)) {
      result.set(key, applyChild(result.get(key), value, childPath, context));
    } else {
      result.set(key, copyValue(value));
      record(context, childPath, 'set');
    }
  }
  return Object.fromEntries(result);
}

/** Apply a map-valued patch at one key: replace, merge, or start a map. */
function applyChild(
  current: unknown,
  patch: PlainObject,
  path: readonly string[],
  context: Context,
): Record<string, unknown> {
  if (patch[REPLACE_KEY] === true) {
    record(context, path, 'replace');
    return applyMap(undefined, patch, path, context);
  }
  if (isPlainObject(current)) {
    return applyMap(current, patch, path, context);
  }
  record(context, path, 'set');
  return applyMap(undefined, patch, path, context);
}

/** Read and check the entry's `$layer`. */
function layerOf(entry: PlainObject, index: number): string | undefined {
  const layer = entry[LAYER_KEY];
  if (layer === undefined || typeof layer === 'string') {
    return layer;
  }
  throw new TypeError(`entry ${index}: $layer must be a string, got ${typeof layer}`);
}

/** Append the new records to a copy of the provenance. */
function extend(
  provenance: Provenance,
  records: readonly [string, ProvenanceRecord][],
): Provenance {
  const next = new Map(provenance);
  for (const [key, touch] of records) {
    next.set(key, [...(next.get(key) ?? []), touch]);
  }
  return next;
}

/**
 * Apply one entry onto the merged state, by the rules in this module's
 * description, and return the new state. Nothing is mutated: the result is
 * a new value and a new provenance map. Every plain object and array the
 * result takes from `entry` is a copy, while functions and class instances
 * are kept by reference; subtrees of `state.value` the entry does
 * not touch are shared with the new value by reference, which is safe
 * because no step of the merge mutates a value.
 *
 * A `$replace: true` on the entry itself replaces the whole value merged so
 * far, and is recorded at the empty path `''`.
 *
 * @example
 * ```ts
 * const first = apply(initialState(), { a: { x: 1, y: 2 } }, 0);
 * const second = apply(first, { a: { y: 3, z: 4 } }, 1);
 * second.value; // { a: { x: 1, y: 3, z: 4 } }
 * second.provenance.get('a.y'); // [{ entry: 0, kind: 'set' }, { entry: 1, kind: 'set' }]
 * ```
 *
 * @param state - The state merged from the entries before this one.
 * @param entry - The entry to apply: a plain object.
 * @param index - Zero-based index of the entry, recorded in provenance.
 * @returns The new state.
 * @throws {TypeError} When `entry` is not a plain object, or its `$layer`
 *   is present and not a string.
 */
export function apply(state: MergeState, entry: unknown, index: number): MergeState {
  if (!isPlainObject(entry)) {
    const kind = Array.isArray(entry)
      ? 'an array'
      : entry === null
        ? 'null'
        : typeof entry;
    throw new TypeError(`entry ${index}: expected a plain object, got ${kind}`);
  }
  const context: Context = { entry: index, layer: layerOf(entry, index), records: [] };
  const isRootReplace = entry[REPLACE_KEY] === true;
  if (isRootReplace) {
    record(context, [], 'replace');
  }
  const value = applyMap(isRootReplace
    ? undefined
    : state.value, entry, [], context);
  return { value, provenance: extend(state.provenance, context.records) };
}
