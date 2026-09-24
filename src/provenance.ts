/**
 * Provenance lookup: read the records of one key path out of a merge or
 * load result.
 *
 * @module
 */

import type { Provenance, ProvenanceRecord } from './merge/apply';

import { pathKey } from './merge/apply';

/** What an unknown path yields: no records, frozen and shared. */
const NO_RECORDS: readonly ProvenanceRecord[] = Object.freeze([]);

/**
 * The provenance records of one key path: which entries touched it, in
 * the order they applied, each `{ entry, kind }` plus `layer` when the
 * entry has a `$layer`. The last record names the entry that last touched
 * the path.
 *
 * `path` is either dot-joined (`'a.x'`) or an array of keys (`['a', 'x']`),
 * which is joined with dots, so both name the same path. The root path is
 * `''` (or `[]`), where an entry that is itself `{ $replace: true, … }`
 * records `replace`. Keys that contain a dot share a path with the nested
 * keys they spell, the same limit as the provenance map itself.
 *
 * @param result - Any value with a `provenance` map, such as the result of
 *   `merge`.
 * @param path - The key path, dot-joined or as an array of keys.
 * @returns The path's records, or an empty frozen array when no entry
 *   touched it.
 */
export function provenanceOf(
  result: { readonly provenance: Provenance },
  path: string | readonly string[],
): readonly ProvenanceRecord[] {
  const key = typeof path === 'string'
    ? path
    : pathKey(path);
  return result.provenance.get(key) ?? NO_RECORDS;
}
