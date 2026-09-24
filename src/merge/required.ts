/**
 * `required`: the `required-dropped` check of the merge. It looks up each
 * required dot-joined path in the merged value and, for every one that is
 * absent, reports an error naming the entry that dropped it, read from the
 * provenance `apply` recorded.
 *
 * Rules:
 * - a path is present when every key along it is an own key of a plain
 *   object in the merged value. The merge descends only into plain objects,
 *   so a path through an array, a scalar or a class instance is absent.
 * - the entry named is the first one to drop the path after the last entry
 *   that set it. An entry drops the path when it has `false` at the path or
 *   at a key above it, `{ $replace: true, … }` at a key above it (or on the
 *   entry itself), or a value that is not a map at a key above it.
 * - when no entry ever set the path, or none can be seen dropping it, the
 *   diagnostic carries no `entry`.
 * - a path listed twice is reported once.
 *
 * Like provenance, required paths are dot-joined, so a key that itself
 * contains a dot cannot be named.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { Provenance, ProvenanceRecord } from './apply';

import { error, pathToString } from '../diagnostics';

import { pathKey } from './apply';
import { isPlainObject } from './plain-object';

/** An entry that dropped a path, and how. */
interface Drop {
  readonly entry: number;
  readonly how: string;
}

/** `true` when every key of `path` is an own key of a plain object in `value`. */
function isPresent(value: unknown, path: readonly string[]): boolean {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) {
      return false;
    }
    current = current[key];
  }
  return true;
}

/** Split a required path into keys, refusing an empty path or empty key. */
function splitRequired(key: unknown, index: number): string[] {
  if (typeof key !== 'string') {
    throw new TypeError(`required[${index}]: expected a dot-joined path, got ${typeof key}`);
  }
  const path = key.split('.');
  if (path.some((segment) => segment === '')) {
    throw new TypeError(`required[${index}]: ${JSON.stringify(key)} has an empty key`);
  }
  return path;
}

/** The last entry that set or replaced exactly this path, if any. */
function lastSet(records: readonly ProvenanceRecord[]): number | undefined {
  return records
    .filter((touch) => touch.kind !== 'remove')
    .reduce<number | undefined>((last, touch) => Math.max(touch.entry, last ?? touch.entry), undefined);
}

/**
 * How a record at `at`, the path or a key above it, dropped the path. Only
 * records after the last set of the path are read, and a `set` or `replace`
 * at the path itself is such a set, so any record read here drops it.
 */
function dropOf(touch: ProvenanceRecord, at: readonly string[]): string {
  const where = at.length === 0
    ? 'the whole value'
    : pathToString(at);
  if (touch.kind === 'remove') {
    return `removed ${where} with false`;
  }
  return touch.kind === 'replace'
    ? `replaced ${where} with $replace`
    : `set ${where} to a value that is not a map`;
}

/** The first entry after `since` to drop `path`, reading provenance at it and above it. */
function dropperOf(provenance: Provenance, path: readonly string[], since: number): Drop | undefined {
  const drops: Drop[] = [];
  for (let depth = 0; depth <= path.length; depth += 1) {
    const at = path.slice(0, depth);
    for (const touch of provenance.get(pathKey(at)) ?? []) {
      if (touch.entry > since) {
        drops.push({ entry: touch.entry, how: dropOf(touch, at) });
      }
    }
  }
  return drops.reduce<Drop | undefined>(
    (first, drop) => (first === undefined || drop.entry < first.entry
      ? drop
      : first),
    undefined,
  );
}

/** Build the diagnostic for one absent path. */
function report(provenance: Provenance, path: readonly string[]): Diagnostic {
  const name = pathToString(path);
  const since = lastSet(provenance.get(pathKey(path)) ?? []);
  if (since === undefined) {
    return error('required-dropped', path, `${name} is required but no entry sets it`);
  }
  const drop = dropperOf(provenance, path, since);
  if (drop === undefined) {
    return error('required-dropped', path, `${name} is required but absent from the merged value`);
  }
  const message = `${name} is required but was dropped: entry ${drop.entry} ${drop.how}`;
  return error('required-dropped', path, message, { entry: drop.entry });
}

/**
 * Report every required path absent from the merged value, by the rules in
 * this module's description. Diagnostics follow the order of `paths`.
 * Nothing is mutated.
 *
 * @example
 * ```ts
 * let state = initialState();
 * state = apply(state, { a: { x: 1 } }, 0);
 * state = apply(state, { a: { $replace: true, z: 4 } }, 1);
 * required(state.value, state.provenance, ['a.x']);
 * // [{ level: 'error', code: 'required-dropped', path: ['a', 'x'], entry: 1, message: … }]
 * ```
 *
 * @param value - The value merged from all entries.
 * @param provenance - The provenance `apply` recorded over the same entries.
 * @param paths - Dot-joined key paths that must be present, such as `'a.x'`.
 * @returns One error-level `required-dropped` diagnostic per absent path,
 *   with `entry` set to the entry that dropped it when one did.
 * @throws {TypeError} When `paths` is not an array, or one of its items is
 *   not a string or has an empty key (`''`, `'a..b'`, `'a.'`).
 */
export function required(
  value: Readonly<Record<string, unknown>>,
  provenance: Provenance,
  paths: readonly string[],
): Diagnostic[] {
  if (!Array.isArray(paths)) {
    throw new TypeError(`required: expected an array of dot-joined paths, got ${typeof paths}`);
  }
  const split = paths.map((key: unknown, index) => splitRequired(key, index));
  return split
    .filter((path, index) => split.findIndex((other) => pathKey(other) === pathKey(path)) === index)
    .filter((path) => !isPresent(value, path))
    .map((path) => report(provenance, path));
}
