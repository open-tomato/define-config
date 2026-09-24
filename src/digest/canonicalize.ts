/**
 * `canonicalize`: one byte-stable JSON text for a config value or a graph,
 * whatever order its keys were inserted in. `digest` hashes this text.
 *
 * Rules:
 * - JSON text with no whitespace.
 * - plain-object keys are sorted by UTF-16 code unit (the default
 *   `Array.prototype.sort` on strings) at every level; arrays keep their
 *   order.
 * - a property whose value is `undefined` is dropped, and so is every
 *   symbol key.
 * - a number is written as `String(n)`, with `-0` written `0`; a string as
 *   `JSON.stringify(s)`, with no Unicode normalisation; `true`, `false` and
 *   `null` as in JSON.
 * - any other object that is not a plain object (a class instance) is
 *   written by its own enumerable string keys, as a plain object.
 * - an object reached twice by different paths (a shared reference, not a
 *   cycle) is written twice.
 *
 * Values that are not JSON are written as tagged objects on the library's
 * reserved `$` namespace, so none of them collides with a plain value:
 * - a `Date` is `{"$date":"<toISOString()>"}`;
 * - a `Map` is `{"$map":[[k,v],…]}`, its entries sorted by the canonical
 *   text of the key, ties broken by the canonical text of the value;
 * - a `Set` is `{"$set":[…]}`, its members sorted by canonical text;
 * - a function is `{"$function":"<fn.name>"}`, `""` for an anonymous
 *   function. Its body is never read.
 *
 * @module
 */

import { pathToString } from '../diagnostics';

/** The keys of the tagged objects `canonicalize` writes. */
const TAG_NAMES: ReadonlySet<string> = new Set(['$date', '$map', '$set', '$function']);

/**
 * The error `canonicalize` (and so `digest`) throws for a value that has
 * no canonical text.
 *
 * - `code: 'cyclic-value'`: a value that contains itself. Only the
 *   ancestors on the current path count, so a shared reference reached by
 *   two paths is not refused.
 * - `code: 'not-canonical'`: `NaN`, `Infinity`, `-Infinity`, a `bigint`, a
 *   symbol value, `undefined` where it would be written (the root value, an
 *   array element, a `Map` key or value, a `Set` member), an invalid
 *   `Date`, and an object whose only written key is one of the tag names
 *   `$date`, `$map`, `$set` and `$function`, which would otherwise print as
 *   the tagged value it imitates. Writing `null` for any of these would
 *   collide with a real `null`.
 *
 * `path` is the key path from the root to the offending value, outermost
 * key first, `[]` for the root. An array index or a `Set` member's position
 * in insertion order is a decimal string (`['a', '0']`); a `Map` value's
 * segment is the canonical text of its key. A refusal inside a `Map` key
 * carries the `Map`'s path followed by the path inside the key.
 *
 * @example
 * ```ts
 * try {
 *   canonicalize({ a: [NaN] });
 * } catch (error) {
 *   if (error instanceof CanonicalizeError) {
 *     error.code; // 'not-canonical'
 *     error.path; // ['a', '0']
 *   }
 * }
 * ```
 */
export class CanonicalizeError extends Error {
  /** Why the value has no canonical text. */
  readonly code: 'cyclic-value' | 'not-canonical';

  /** Key path from the root to the offending value, outermost key first. */
  readonly path: string[];

  /**
   * @param code - Why the value has no canonical text.
   * @param path - Key path from the root to the offending value.
   * @param message - Human-readable description of the problem.
   */
  constructor(code: 'cyclic-value' | 'not-canonical', path: readonly string[], message: string) {
    super(message);
    this.name = 'CanonicalizeError';
    this.code = code;
    this.path = [...path];
  }
}

/** A `not-canonical` refusal of `what` at `path`. */
function notCanonical(path: readonly string[], what: string): CanonicalizeError {
  return new CanonicalizeError(
    'not-canonical',
    path,
    `canonicalize: ${what} at ${pathToString(path)} has no canonical text`,
  );
}

/** Compare two canonical texts by UTF-16 code unit. */
function byCodeUnit(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right
    ? 1
    : 0;
}

/** The canonical text of a number, refusing `NaN` and `±Infinity`. */
function writeNumber(value: number, path: readonly string[]): string {
  if (!Number.isFinite(value)) {
    throw notCanonical(path, String(value));
  }
  return Object.is(value, -0)
    ? '0'
    : String(value);
}

/** The canonical text of an object written by its own enumerable string keys. */
function writeKeyed(
  value: object,
  path: readonly string[],
  ancestors: Set<object>,
): string {
  const record = value as Readonly<Record<string, unknown>>;
  const properties = Object.keys(record)
    .sort()
    .map((key) => [key, record[key]] as const)
    .filter(([, member]) => member !== undefined);
  const [only] = properties;
  if (properties.length === 1 && only !== undefined && TAG_NAMES.has(only[0])) {
    throw notCanonical(path, `an object whose only key is ${only[0]}`);
  }
  const members = properties.map(([key, member]) => `${JSON.stringify(key)}:${write(member, [...path, key], ancestors)}`);
  return `{${members.join(',')}}`;
}

/** The canonical text of a `Map`, entries sorted by key text then value text. */
function writeMap(
  value: ReadonlyMap<unknown, unknown>,
  path: readonly string[],
  ancestors: Set<object>,
): string {
  const entries = [...value].map(([key, member]) => {
    const keyText = write(key, path, ancestors);
    return [keyText, write(member, [...path, keyText], ancestors)] as const;
  });
  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => byCodeUnit(leftKey, rightKey) || byCodeUnit(leftValue, rightValue));
  return `{"$map":[${entries.map(([key, member]) => `[${key},${member}]`).join(',')}]}`;
}

/** The canonical text of a `Set`, members sorted by canonical text. */
function writeSet(
  value: ReadonlySet<unknown>,
  path: readonly string[],
  ancestors: Set<object>,
): string {
  const members = [...value].map((member, index) => write(member, [...path, String(index)], ancestors));
  members.sort(byCodeUnit);
  return `{"$set":[${members.join(',')}]}`;
}

/** The canonical text of an object: a container, a `Date`, or a keyed object. */
function writeObject(
  value: object,
  path: readonly string[],
  ancestors: Set<object>,
): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw notCanonical(path, 'an invalid Date');
    }
    return `{"$date":${JSON.stringify(value.toISOString())}}`;
  }
  if (ancestors.has(value)) {
    throw new CanonicalizeError(
      'cyclic-value',
      path,
      `canonicalize: the value at ${pathToString(path)} contains itself`,
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      return `[${Array.from(items, (item, index) => write(item, [...path, String(index)], ancestors)).join(',')}]`;
    }
    if (value instanceof Map) {
      return writeMap(value, path, ancestors);
    }
    if (value instanceof Set) {
      return writeSet(value, path, ancestors);
    }
    return writeKeyed(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/** The canonical text of any value, `path` naming where it sits. */
function write(
  value: unknown,
  path: readonly string[],
  ancestors: Set<object>,
): string {
  switch (typeof value) {
    case 'undefined':
      throw notCanonical(path, 'undefined');
    case 'boolean':
      return value
        ? 'true'
        : 'false';
    case 'number':
      return writeNumber(value, path);
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      throw notCanonical(path, 'a bigint');
    case 'symbol':
      throw notCanonical(path, 'a symbol');
    case 'function':
      return `{"$function":${JSON.stringify(value.name)}}`;
    case 'object':
      return value === null
        ? 'null'
        : writeObject(value, path, ancestors);
  }
}

/**
 * The canonical JSON text of `value`: the same text for the same content,
 * whatever order its keys, `Map` entries or `Set` members were inserted in.
 * See the module rules above: sorted keys, dropped `undefined` properties
 * and symbol keys, `-0` written `0`, and the tagged objects `$date`,
 * `$map`, `$set` and `$function` for values that are not JSON. A plain
 * object carrying another `$` key, such as `$start` or `$replace`, is
 * written as an ordinary key.
 *
 * @example
 * ```ts
 * canonicalize({ b: 1, a: { d: [2, 1], c: -0 } });
 * // '{"a":{"c":0,"d":[2,1]},"b":1}'
 * ```
 *
 * @param value - Any value.
 * @returns The canonical JSON text of `value`.
 * @throws {@link CanonicalizeError} with `code: 'cyclic-value'` for a value
 *   that contains itself, or `code: 'not-canonical'` for a value that has
 *   no canonical text; `path` names where it sits.
 */
export function canonicalize(value: unknown): string {
  return write(value, [], new Set());
}
