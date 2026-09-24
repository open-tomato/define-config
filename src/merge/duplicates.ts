/**
 * `duplicates`: the `duplicate-key` check of the merge. It reads the
 * provenance `apply` recorded and reports each key path that two or more
 * entries of the same layer set.
 *
 * Rules:
 * - a path counts as set by an entry when the entry recorded `set` or
 *   `replace` there. A `remove` (`false`) sets nothing, and a map merged
 *   into a map already at the path records nothing at the path itself, so
 *   only the keys below it that both entries write can collide.
 * - entries are grouped by `$layer`; unlabelled entries share one implicit
 *   layer. Entries of different layers override each other silently.
 * - one path yields at most ONE diagnostic, however many entries collide
 *   there, and it names the last colliding entry.
 * - an entry that reaches the same path twice (`{ 'a.b': 1, a: { b: 2 } }`)
 *   counts once.
 * - the empty path (a `$replace: true` on an entry itself) is not a key
 *   path and never fires.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { Provenance, ProvenanceRecord } from './apply';

import { error, pathToString, warn } from '../diagnostics';

/**
 * How `merge` treats a key path set by two entries of the same layer:
 * `warn` (the default) and `error` report a `duplicate-key` diagnostic at
 * that level; `allow` reports nothing.
 */
export type DuplicatesOption = 'warn' | 'error' | 'allow';

/** The option `merge` uses when the host passes none. */
export const DEFAULT_DUPLICATES: DuplicatesOption = 'warn';

/** Every accepted {@link DuplicatesOption}, for the runtime check. */
const OPTIONS: readonly unknown[] = ['warn', 'error', 'allow'];

/** A path's colliding entries within one layer, in the order they applied. */
interface Collision {
  readonly layer: string | undefined;
  readonly entries: readonly number[];
}

/** Split a dot-joined provenance key back into a key path. */
function splitPath(key: string): string[] {
  return key.split('.');
}

/** Render a layer for a message; the implicit layer has no name. */
function layerName(layer: string | undefined): string {
  return layer === undefined
    ? 'the unlabelled layer'
    : `layer ${JSON.stringify(layer)}`;
}

/**
 * The layers in which two or more distinct entries set the path, each with
 * those entries in apply order.
 */
function collisionsOf(records: readonly ProvenanceRecord[]): Collision[] {
  const byLayer = new Map<string | undefined, number[]>();
  for (const touch of records) {
    if (touch.kind === 'remove') {
      continue;
    }
    const entries = byLayer.get(touch.layer) ?? [];
    if (!entries.includes(touch.entry)) {
      byLayer.set(touch.layer, [...entries, touch.entry]);
    }
  }
  return [...byLayer]
    .filter(([, entries]) => entries.length >= 2)
    .map(([layer, entries]) => ({ layer, entries }));
}

/** Build the one diagnostic for a path with at least one collision. */
function report(
  key: string,
  collisions: readonly Collision[],
  option: 'warn' | 'error',
): Diagnostic {
  const path = splitPath(key);
  const last = Math.max(...collisions.flatMap((collision) => collision.entries));
  const detail = collisions
    .map((collision) => `${layerName(collision.layer)} (entries ${collision.entries.join(', ')})`)
    .join('; ');
  const message = `${pathToString(path)} is set more than once within one layer: ${detail}`;
  const build = option === 'error'
    ? error
    : warn;
  return build('duplicate-key', path, message, { entry: last });
}

/**
 * Report every key path that two or more entries of the same layer set, by
 * the rules in this module's description. Paths are reported in the order
 * provenance first recorded them. Nothing is mutated.
 *
 * @example
 * ```ts
 * let state = initialState();
 * state = apply(state, { $layer: 'project', a: { x: 1 } }, 0);
 * state = apply(state, { $layer: 'project', a: { x: 2 } }, 1);
 * duplicates(state.provenance);
 * // [{ level: 'warn', code: 'duplicate-key', path: ['a', 'x'], entry: 1, message: … }]
 * ```
 *
 * @param provenance - The provenance recorded by `apply` over all entries.
 * @param option - `warn` (default) or `error` sets the diagnostics' level;
 *   `allow` turns the check off.
 * @returns One `duplicate-key` diagnostic per colliding path, with `entry`
 *   set to the last colliding entry; empty under `allow`.
 * @throws {TypeError} When `option` is not `warn`, `error` or `allow`.
 */
export function duplicates(
  provenance: Provenance,
  option: DuplicatesOption = DEFAULT_DUPLICATES,
): Diagnostic[] {
  if (!OPTIONS.includes(option)) {
    throw new TypeError(`duplicates: expected 'warn', 'error' or 'allow', got ${String(option)}`);
  }
  if (option === 'allow') {
    return [];
  }
  return [...provenance]
    .filter(([key]) => key !== '')
    .map(([key, records]) => [key, collisionsOf(records)] as const)
    .filter(([, collisions]) => collisions.length > 0)
    .map(([key, collisions]) => report(key, collisions, option));
}
