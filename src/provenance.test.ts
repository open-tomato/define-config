import type { ProvenanceRecord } from './merge/apply';

import { describe, expect, test } from 'bun:test';

import { merge } from './merge';
import { provenanceOf } from './provenance';

/** The spec's `a.x` example: an unlayered entry, then a `project` one. */
const ENTRIES = [
  { a: { x: 1 } },
  { $layer: 'project', a: { x: 2 } },
];

/** The records the spec expects at `a.x` for {@link ENTRIES}. */
const A_X: readonly ProvenanceRecord[] = [
  { entry: 0, kind: 'set' },
  { entry: 1, layer: 'project', kind: 'set' },
];

describe('provenanceOf', () => {
  test('a dot-joined path yields that path\'s records', () => {
    // Arrange
    const result = merge(ENTRIES);

    // Act
    const records = provenanceOf(result, 'a.x');

    // Assert
    expect(records).toEqual(A_X);
    expect(records).toBe(result.provenance.get('a.x') ?? []);
  });

  test('an array path yields the same records as its dot-joined form', () => {
    // Arrange
    const result = merge(ENTRIES);

    // Act
    const records = provenanceOf(result, ['a', 'x']);

    // Assert
    expect(records).toEqual(A_X);
    expect(records).toBe(provenanceOf(result, 'a.x'));
  });

  test('the root path \'\' yields a root-level $replace', () => {
    // Arrange
    const result = merge([{ a: 1 }, { $replace: true, b: 2 }]);

    // Act
    const byString = provenanceOf(result, '');
    const byArray = provenanceOf(result, []);

    // Assert
    expect(byString).toEqual([{ entry: 1, kind: 'replace' }]);
    expect(byArray).toEqual([{ entry: 1, kind: 'replace' }]);
  });

  test('an unknown path yields an empty frozen array', () => {
    // Arrange
    const result = merge(ENTRIES);

    // Act
    const records = provenanceOf(result, 'a.nope');

    // Assert
    expect(records).toEqual([]);
    expect(Object.isFrozen(records)).toBe(true);
    expect(provenanceOf(result, ['b'])).toEqual([]);
  });

  test('takes any value with a provenance map, not only a merge result', () => {
    // Arrange
    const holder = { provenance: new Map([['k', [{ entry: 3, kind: 'remove' as const }]]]) };

    // Act
    const records = provenanceOf(holder, ['k']);

    // Assert
    expect(records).toEqual([{ entry: 3, kind: 'remove' }]);
  });
});
