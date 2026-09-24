/**
 * `isPlainObject`: the one test the merge, the graph stages and the loader
 * use to tell a keyed map from a value. Internal: it is not exported from
 * the package entry.
 *
 * @module
 */

/** A plain object: the only kind of value the merge descends into. */
export type PlainObject = Readonly<Record<string, unknown>>;

/**
 * Whether `value` is a plain object: an object whose prototype is
 * `Object.prototype` (an object literal) or `null` (`Object.create(null)`).
 * Arrays, class instances, built-ins such as `Date` and `Map`, functions,
 * `null` and primitives are not.
 *
 * @param value - Any value.
 * @returns `true` when `value` is a plain object, narrowing it to
 *   {@link PlainObject}.
 */
export function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
