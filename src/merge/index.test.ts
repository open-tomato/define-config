import type { MergeOptions } from './index';

import { describe, expect, test } from 'bun:test';

import { merge } from './index';

/** Two same-layer entries colliding at `a.x`, and nothing else. */
const COLLIDING = [
  { $layer: 'project', a: { x: 1 } },
  { $layer: 'project', a: { x: 2 } },
];

/** Freeze a value and everything inside it, so a mutation would throw. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('the merged value', () => {
  test('entries apply left to right, maps merging and scalars replacing', () => {
    // Arrange
    const entries = [{ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } }];

    // Act
    const result = merge(entries);

    // Assert
    expect(result.value).toEqual({ a: { x: 1, y: 3, z: 4 } });
  });

  test('unlabelled entries share one layer, so both setting a.y is a duplicate', () => {
    const { diagnostics } = merge([{ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } }]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'warn', code: 'duplicate-key', path: ['a', 'y'], entry: 1 });
  });

  test('no entries merge to an empty value with no diagnostics', () => {
    expect(merge([])).toEqual({ value: {}, diagnostics: [], provenance: new Map() });
  });

  test('reserved keys never reach the value', () => {
    const result = merge([{ $layer: 'defaults', a: { x: 1 } }, { a: { $replace: true, z: 4 } }]);

    expect(result.value).toEqual({ a: { z: 4 } });
  });

  test('frozen entries and options merge without being changed', () => {
    const entries = deepFreeze([{ a: { x: 1 }, list: [1, 2] }, { a: { x: false, y: 2 } }]);
    const options = deepFreeze({ duplicates: 'error', required: ['a.x'] } satisfies MergeOptions);

    const result = merge(entries, options);

    expect(result.value).toEqual({ a: { y: 2 }, list: [1, 2] });
    expect(entries).toEqual([{ a: { x: 1 }, list: [1, 2] }, { a: { x: false, y: 2 } }]);
    expect(result.value.list).not.toBe(entries[0]?.list);
  });
});

describe('option defaults', () => {
  test('without options, a same-layer duplicate is a warn', () => {
    // Act
    const { diagnostics } = merge(COLLIDING);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'warn', code: 'duplicate-key', path: ['a', 'x'] });
  });

  test('an empty options object gives the same result as none', () => {
    expect(merge(COLLIDING, {})).toEqual(merge(COLLIDING));
  });

  test('options set to undefined fall back to the defaults', () => {
    const result = merge(COLLIDING, { duplicates: undefined, required: undefined });

    expect(result).toEqual(merge(COLLIDING));
  });

  test('without required, a dropped path is not reported', () => {
    const entries = [{ $layer: 'defaults', a: { x: 1 } }, { $layer: 'project', a: { $replace: true, z: 4 } }];

    const { diagnostics } = merge(entries);

    expect(diagnostics).toEqual([]);
  });

  test('only the duplicates option is overridden when required alone is given', () => {
    const { diagnostics } = merge(COLLIDING, { required: ['a.x'] });

    expect(diagnostics.map((diagnostic) => diagnostic.level)).toEqual(['warn']);
  });
});

describe('options reach the checks', () => {
  test('duplicates: error reports the duplicate at error level', () => {
    const { diagnostics } = merge(COLLIDING, { duplicates: 'error' });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'error', code: 'duplicate-key' });
  });

  test('duplicates: allow reports nothing', () => {
    expect(merge(COLLIDING, { duplicates: 'allow' }).diagnostics).toEqual([]);
  });

  test('entries of different layers never collide', () => {
    const entries = [{ $layer: 'defaults', a: { x: 1 } }, { $layer: 'project', a: { x: 2 } }];

    expect(merge(entries).diagnostics).toEqual([]);
  });

  test('required reports each absent path, in the order given', () => {
    const { diagnostics } = merge([{ a: { x: 1 } }], { required: ['b', 'a.x', 'c.d'] });

    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([['b'], ['c', 'd']]);
    expect(diagnostics.every((diagnostic) => diagnostic.code === 'required-dropped')).toBe(true);
  });

  test('duplicate diagnostics come before required ones', () => {
    const entries = [...COLLIDING, { $layer: 'user', a: false }];

    const { diagnostics } = merge(entries, { required: ['a.x'] });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['duplicate-key', 'required-dropped']);
  });
});

describe('entry-index bookkeeping', () => {
  test('a required-dropped error names the position of the dropping entry', () => {
    // Arrange
    const entries = [{ a: { x: 1 } }, { b: 1 }, { c: 2 }, { a: { $replace: true, z: 4 } }];

    // Act
    const { diagnostics } = merge(entries, { duplicates: 'allow', required: ['a.x'] });

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'required-dropped', path: ['a', 'x'], entry: 3 });
  });

  test('a duplicate names the position of the last colliding entry, past other layers', () => {
    const entries = [
      { $layer: 'project', a: { x: 1 } },
      { $layer: 'defaults', b: 1 },
      { $layer: 'project', a: { x: 2 } },
      { $layer: 'user', c: 1 },
      { $layer: 'project', a: { x: 3 } },
    ];

    const { diagnostics } = merge(entries);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'duplicate-key', path: ['a', 'x'], entry: 4 });
  });

  test('a path no entry ever set is reported without an entry', () => {
    const { diagnostics } = merge([{ a: 1 }, { b: 2 }], { required: ['c'] });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).not.toHaveProperty('entry');
  });

  test('an invalid entry is refused under its position', () => {
    expect(() => merge([{ a: 1 }, { b: 2 }, 'c'])).toThrow('entry 2: expected a plain object, got string');
  });

  test('a hole in a sparse array is refused under its position, not skipped', () => {
    // eslint-disable-next-line no-sparse-arrays
    const entries = [{ a: 1 }, , { b: 2 }];

    expect(() => merge(entries)).toThrow('entry 1: expected a plain object, got undefined');
  });

  test('a bad $layer is refused under its position', () => {
    expect(() => merge([{ a: 1 }, { $layer: 7 }])).toThrow('entry 1: $layer must be a string');
  });
});

describe('invalid arguments', () => {
  test('entries that are not an array are refused', () => {
    // @ts-expect-error: entries must be an array
    expect(() => merge({ a: 1 })).toThrow('merge: expected entries to be an array, got object');
  });

  test('options that are not an object are refused', () => {
    // @ts-expect-error: options must be an object
    expect(() => merge([], 'warn')).toThrow('merge: expected options to be an object, got string');
    // @ts-expect-error: options must be an object
    expect(() => merge([], null)).toThrow('got null');
    // @ts-expect-error: options must be an object
    expect(() => merge([], [])).toThrow('got an array');
  });

  test('an unknown duplicates option is refused', () => {
    // @ts-expect-error: duplicates is warn, error or allow
    expect(() => merge([], { duplicates: 'ignore' })).toThrow('expected \'warn\', \'error\' or \'allow\'');
  });

  test('a required path that is not a string is refused', () => {
    // @ts-expect-error: required paths are strings
    expect(() => merge([], { required: [1] })).toThrow('required[0]: expected a dot-joined path');
  });
});

describe('the provenance', () => {
  test('a.x holds one record per entry, with a layer key only on the labelled one', () => {
    // Arrange
    const entries = [{ a: { x: 1 } }, { $layer: 'project', a: { x: 2 } }];

    // Act
    const records = merge(entries).provenance.get('a.x');

    // Assert
    expect(records).toEqual([{ entry: 0, kind: 'set' }, { entry: 1, layer: 'project', kind: 'set' }]);
    expect(records?.[0]).not.toHaveProperty('layer');
  });

  test('the map, each record array and each record are frozen', () => {
    // Arrange
    const entries = [{ a: { x: 1 } }, { a: { x: 2 } }];

    // Act
    const { provenance } = merge(entries);
    const records = provenance.get('a.x') ?? [];

    // Assert
    expect(records).toHaveLength(2);
    expect(Object.isFrozen(provenance)).toBe(true);
    expect(Object.isFrozen(records)).toBe(true);
    expect(records.every((touch) => Object.isFrozen(touch))).toBe(true);
    expect(() => (records as unknown[]).push({ entry: 2, kind: 'set' })).toThrow(TypeError);
  });
});
