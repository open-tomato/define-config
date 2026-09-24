/**
 * `validate`: runs a Standard Schema V1 schema over a value and reports every
 * issue it raises as a `schema` diagnostic.
 *
 * Rules:
 * - each issue becomes `{ level: 'error', code: 'schema', path, message }`;
 *   a success result yields `[]`.
 * - each issue path segment, a bare `PropertyKey` or a `{ key }` segment,
 *   is turned into a string with `String`, so `0` becomes `'0'` and a symbol
 *   becomes `'Symbol(description)'`. An issue with no path gets `[]`.
 * - validation is synchronous only: a schema whose `validate` returns a
 *   Promise makes `validate` throw a `TypeError` naming the schema's vendor.
 *
 * `validateSections` validates the value found at each section path with that
 * section's schema and prefixes each issue's path with the section path. The
 * result is the union of every section's diagnostics, so a module's schema
 * can add a diagnostic but never remove one another schema raised.
 *
 * @module
 */

import type { Diagnostic } from './diagnostics';
import type { StandardSchemaV1 } from './standard-schema';

import { error } from './diagnostics';

/**
 * One section to validate: the key path of the subtree, outermost key first,
 * and the schema that subtree must satisfy. The empty path names the whole
 * value.
 */
export type SchemaSection = readonly [path: readonly string[], schema: StandardSchemaV1];

type IssuePath = StandardSchemaV1.Issue['path'];

/** `true` for a Promise or any other thenable. */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }
  return typeof (value as { readonly then?: unknown }).then === 'function';
}

/** Turn a Standard Schema issue path into a string key path. */
function toPath(path: IssuePath): string[] {
  if (path === undefined) {
    return [];
  }
  return path.map((segment) => {
    if (typeof segment === 'object' && segment !== null) {
      return String(segment.key);
    }
    return String(segment);
  });
}

/** Read the value at `path`; a missing subtree yields `undefined`. */
function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Readonly<Record<string, unknown>>)[key];
  }
  return current;
}

/**
 * Validate `value` against a Standard Schema V1 `schema`, synchronously.
 *
 * @param value - The value to validate.
 * @param schema - Any schema implementing Standard Schema V1.
 * @returns One `error`-level `schema` diagnostic per issue, in the order the
 *   schema reported them; `[]` when the value is valid.
 * @throws TypeError when the schema's `validate` returns a Promise; the
 *   message names `schema['~standard'].vendor`.
 */
export function validate(value: unknown, schema: StandardSchemaV1): Diagnostic[] {
  const standard = schema['~standard'];
  const result = standard.validate(value);
  if (isPromiseLike(result)) {
    throw new TypeError(
      `Schema from vendor "${standard.vendor}" validated asynchronously; only synchronous validation is supported`,
    );
  }
  if (result.issues === undefined) {
    return [];
  }
  return result.issues.map((issue) => error('schema', toPath(issue.path), issue.message));
}

/**
 * Validate each section of `value` with its own schema. The value at a
 * section path is read through own keys of objects; a missing subtree is
 * validated as `undefined`. Each diagnostic's path is the section path
 * followed by the issue path.
 *
 * @param value - The value holding every section.
 * @param sections - `[path, schema]` pairs, validated in order.
 * @returns The diagnostics of every section, concatenated in section order.
 * @throws TypeError when any section's schema validates asynchronously.
 */
export function validateSections(
  value: unknown,
  sections: readonly SchemaSection[],
): Diagnostic[] {
  return sections.flatMap(([path, schema]) => {
    const prefix = (diagnostic: Diagnostic): Diagnostic => ({
      ...diagnostic,
      path: [...path, ...diagnostic.path],
    });
    return validate(valueAt(value, path), schema).map(prefix);
  });
}
