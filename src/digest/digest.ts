import { createHash } from 'node:crypto';

import { canonicalize } from './canonicalize';

/**
 * Hashes a value by its canonical text.
 *
 * Returns `'sha256:'` followed by the lowercase hex SHA-256 of
 * `canonicalize(value)` encoded as UTF-8. Synchronous, built on
 * `node:crypto`. Two values with one canonical text share one digest, so
 * key order does not change it. A function is hashed by its name, never by
 * its body: two functions with one name give one digest.
 *
 * @param value - The value to hash.
 * @returns `sha256:` and 64 lowercase hex characters.
 * @throws {@link CanonicalizeError} Whatever `canonicalize` throws: a
 * `cyclic-value` or `not-canonical` refusal, with its `path`.
 */
export function digest(value: unknown): string {
  const hash = createHash('sha256')
    .update(canonicalize(value), 'utf8')
    .digest('hex');
  return `sha256:${hash}`;
}
