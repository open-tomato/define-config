import { describe, expect, test } from 'bun:test';
import { assert, jsonValue, property } from 'fast-check';

import { canonicalize } from './canonicalize';

const TAG_NAMES = ['$date', '$map', '$set', '$function'];

/** True when no object in the tree is a lone-tag-key object, which canonicalize refuses. */
function hasNoTagImitation(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(hasNoTagImitation);
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 1 && TAG_NAMES.includes(keys[0] as string)) {
      return false;
    }
    return Object.values(value).every(hasNoTagImitation);
  }
  return true;
}

/** Copy of a JSON value with every `-0` read as `0`. */
function readNegativeZeroAsZero(value: unknown): unknown {
  if (typeof value === 'number') {
    return value + 0;
  }
  if (Array.isArray(value)) {
    return value.map(readNegativeZeroAsZero);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, readNegativeZeroAsZero(entry)]),
    );
  }
  return value;
}

/** Copy of a JSON value with the keys of every object inserted in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeys);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseKeys(entry)]),
    );
  }
  return value;
}

const jsonArbitrary = jsonValue().filter(hasNoTagImitation);

describe('canonicalize properties', () => {
  test('JSON.parse of the canonical text equals the value, -0 read as 0', () => {
    assert(
      property(jsonArbitrary, (value) => {
        // Act
        const parsed = JSON.parse(canonicalize(value)) as unknown;

        // Assert
        expect(parsed).toEqual(readNegativeZeroAsZero(value));
      }),
    );
  });

  test('an object and the same object with reversed key order give one text', () => {
    assert(
      property(jsonArbitrary, (value) => {
        // Act
        const forward = canonicalize(value);
        const reversed = canonicalize(reverseKeys(value));

        // Assert
        expect(reversed).toBe(forward);
      }),
    );
  });

  test('two calls on one value give one text', () => {
    assert(
      property(jsonArbitrary, (value) => {
        // Act
        const first = canonicalize(value);
        const second = canonicalize(value);

        // Assert
        expect(second).toBe(first);
      }),
    );
  });
});
