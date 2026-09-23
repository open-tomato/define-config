import { describe, expect, test } from 'bun:test';
import { array, assert, boolean, constant, constantFrom, dictionary, integer, letrec, oneof, property, shuffledSubarray, string, tuple } from 'fast-check';

import { merge } from './index';

type Tree = Record<string, unknown>;

const KEYS = ['a', 'b', 'c'] as const;
const key = constantFrom(...KEYS);

const leaf = oneof(
  integer(),
  string(),
  boolean(),
  constant(null),
  array(integer(), { maxLength: 3 }),
  array(dictionary(key, integer()), { maxLength: 2 }),
);

/** A keyed map over a small alphabet with `$replace` and `false` sprinkled in. */
const { map } = letrec<{ map: Tree; slot: unknown }>((tie) => ({
  slot: oneof(
    { depthSize: 'small' },
    leaf,
    constant(false),
    tie('map'),
  ),
  map: oneof(
    dictionary(key, tie('slot')),
    tuple(dictionary(key, tie('slot'))).map(([rest]) => ({ $replace: true, ...rest })),
  ),
}));

/** A value that is set (never `false`): a leaf or a map. */
const settable = oneof(leaf, map);

/** Every object and array reachable from `root`, including `root`. */
function identities(root: unknown, into: Set<object> = new Set()): Set<object> {
  if (typeof root === 'object' && root !== null && !into.has(root)) {
    into.add(root);
    for (const child of Object.values(root)) {
      identities(child, into);
    }
  }
  return into;
}

describe('merge properties', () => {
  test('entries of distinct layers merge to the same value in any layer-preserving order', () => {
    // Arrange: each entry owns its own leaf keys under shared parents, so
    // the layers never overwrite each other and only their order varies.
    const ordered = array(tuple(settable, settable), { minLength: 1, maxLength: 5 })
      .map((pairs) => pairs.map(([a, b], index): Tree => ({
        $layer: `layer-${index}`,
        a: { [`k${index}`]: a },
        b: { [`k${index}`]: b },
      })))
      .chain((entries) => tuple(
        constant(entries),
        shuffledSubarray(entries, { minLength: entries.length, maxLength: entries.length }),
      ));

    assert(property(ordered, ([entries, shuffled]) => {
      // Act
      const original = merge(entries, { duplicates: 'allow' });
      const reordered = merge(shuffled, { duplicates: 'allow' });

      // Assert
      expect(reordered.value).toEqual(original.value);
    }));
  });

  test('$replace applied twice equals applied once', () => {
    assert(property(map, key, map, (base, at, rest) => {
      // Arrange
      const replacing = { [at]: { $replace: true, ...rest } };

      // Act
      const once = merge([base, replacing]);
      const twice = merge([base, replacing, replacing]);

      // Assert
      expect(twice.value).toEqual(once.value);
    }));
  });

  test('false followed by a set yields the set value', () => {
    assert(property(map, key, settable, (base, at, set) => {
      // Act
      const result = merge([base, { [at]: false }, { [at]: set }]);
      const alone = merge([{ [at]: set }]);

      // Assert
      expect(result.value[at]).toEqual(alone.value[at]);
    }));
  });

  test('the merged value shares no object identity with any entry', () => {
    assert(property(array(map, { maxLength: 5 }), (entries) => {
      // Arrange
      const inputs = new Set<object>();
      for (const entry of entries) {
        identities(entry, inputs);
      }

      // Act
      const { value } = merge(entries);

      // Assert
      for (const object of identities(value)) {
        expect(inputs.has(object)).toBe(false);
      }
    }));
  });
});
