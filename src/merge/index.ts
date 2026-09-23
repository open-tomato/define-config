/**
 * `merge`: the merge stage of the library. It applies an array of config
 * entries left to right with `apply`, then runs the `duplicate-key` and
 * `required-dropped` checks over the provenance that `apply` recorded, and
 * returns the merged value with every diagnostic found.
 *
 * The merge rules themselves (scalars and arrays replace, maps merge,
 * `false` removes, `$replace` swaps a subtree, `$layer` labels an entry)
 * are described in `./apply`; the checks in `./duplicates` and
 * `./required`.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { MergeState } from './apply';
import type { DuplicatesOption } from './duplicates';

import { apply, initialState } from './apply';
import { DEFAULT_DUPLICATES, duplicates } from './duplicates';
import { required } from './required';

/** Options accepted by {@link merge}; every field is optional. */
export interface MergeOptions {
  /**
   * How a key path set by two or more entries of the same `$layer` is
   * reported: `warn` (the default) and `error` yield one `duplicate-key`
   * diagnostic per path at that level, `allow` yields none.
   */
  readonly duplicates?: DuplicatesOption;
  /**
   * Dot-joined key paths (`'a.x'`) that must be present in the merged
   * value. Each absent path yields one error-level `required-dropped`
   * diagnostic. Defaults to none.
   */
  readonly required?: readonly string[];
}

/** What {@link merge} returns. */
export interface MergeResult {
  /**
   * The merged value: a new object sharing no object or array with any
   * entry. Reserved keys (`$replace` anywhere, `$layer` on an entry) never
   * reach it.
   */
  readonly value: Readonly<Record<string, unknown>>;
  /**
   * Every problem found: the `duplicate-key` diagnostics first, then the
   * `required-dropped` ones in the order of `options.required`. A
   * diagnostic's `entry` is the zero-based index of the entry at fault in
   * the `entries` array passed to {@link merge}.
   */
  readonly diagnostics: readonly Diagnostic[];
}

/** The required paths used when the host passes none. */
const NO_REQUIRED: readonly string[] = [];

/** Read and check `options`, filling in the defaults. */
function optionsOf(options: unknown): Required<MergeOptions> {
  if (options === undefined) {
    return { duplicates: DEFAULT_DUPLICATES, required: NO_REQUIRED };
  }
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    const kind = Array.isArray(options)
      ? 'an array'
      : options === null
        ? 'null'
        : typeof options;
    throw new TypeError(`merge: expected options to be an object, got ${kind}`);
  }
  const given = options as MergeOptions;
  return {
    duplicates: given.duplicates ?? DEFAULT_DUPLICATES,
    required: given.required ?? NO_REQUIRED,
  };
}

/**
 * Merge config entries left to right and check the result. Nothing is
 * mutated: neither the entries nor the options are changed, and the merged
 * value is built from new objects.
 *
 * Each entry is applied with its position in `entries` as its index, so
 * the `entry` of every diagnostic points back into `entries`. An empty
 * `entries` merges to `{}` with no diagnostics.
 *
 * @example
 * ```ts
 * merge([{ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } }]);
 * // { value: { a: { x: 1, y: 3, z: 4 } }, diagnostics: [] }
 *
 * merge([{ a: { x: 1 } }, { a: { $replace: true, z: 4 } }], { required: ['a.x'] });
 * // { value: { a: { z: 4 } },
 * //   diagnostics: [{ level: 'error', code: 'required-dropped', path: ['a', 'x'], entry: 1, … }] }
 * ```
 *
 * @param entries - The entries to merge, lowest precedence first; each a
 *   plain object, optionally labelled with a string `$layer`.
 * @param options - `duplicates` (default `'warn'`) and `required`
 *   (default none); see {@link MergeOptions}.
 * @returns The merged value and the diagnostics of both checks.
 * @throws {TypeError} When `entries` is not an array; when an entry (or a
 *   hole in a sparse array) is not a plain object or its `$layer` is not a
 *   string; when `options` is not an object; when `options.duplicates` is
 *   not `warn`, `error` or `allow`; or when `options.required` is not an
 *   array of dot-joined paths.
 */
export function merge(entries: readonly unknown[], options?: MergeOptions): MergeResult {
  if (!Array.isArray(entries)) {
    throw new TypeError(`merge: expected entries to be an array, got ${typeof entries}`);
  }
  const settings = optionsOf(options);
  let state: MergeState = initialState();
  // An index loop rather than reduce: reduce skips the holes of a sparse
  // array, which would hide a missing entry instead of refusing it.
  for (let index = 0; index < entries.length; index += 1) {
    state = apply(state, entries[index], index);
  }
  const diagnostics = [
    ...duplicates(state.provenance, settings.duplicates),
    ...required(state.value, state.provenance, settings.required),
  ];
  return { value: state.value, diagnostics };
}
