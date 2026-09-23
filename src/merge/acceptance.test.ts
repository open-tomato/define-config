import { describe, expect, test } from 'bun:test';

import { merge } from './index';

describe('merge definition-of-done examples', () => {
  test('nested maps merge key by key', () => {
    // Arrange
    const entries = [{ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } }];

    // Act
    const result = merge(entries);

    // Assert
    expect(result.value).toEqual({ a: { x: 1, y: 3, z: 4 } });
  });

  test('$replace swaps the whole subtree', () => {
    // Arrange
    const entries = [{ a: { x: 1 } }, { a: { $replace: true, z: 4 } }];

    // Act
    const result = merge(entries);

    // Assert
    expect(result.value).toEqual({ a: { z: 4 } });
  });

  test('a required path dropped by $replace yields one required-dropped error naming entry 1', () => {
    // Arrange
    const entries = [{ a: { x: 1 } }, { a: { $replace: true, z: 4 } }];

    // Act
    const result = merge(entries, { required: ['a.x'] });

    // Assert
    // Unlabelled entries share one layer, so a duplicate-key warning on a.z
    // may accompany it; only the required-dropped errors are counted here.
    const dropped = result.diagnostics.filter(d => d.code === 'required-dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      code: 'required-dropped',
      level: 'error',
      entry: 1,
    });
  });

  test('two entries of one $layer setting a.x yield one duplicate-key warning', () => {
    // Arrange
    const entries = [
      { $layer: 'project', a: { x: 1 } },
      { $layer: 'project', a: { x: 2 } },
    ];

    // Act
    const result = merge(entries);

    // Assert
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'duplicate-key', level: 'warn' });
  });

  test('the same entries under defaults and project layers yield no diagnostic', () => {
    // Arrange
    const entries = [
      { $layer: 'defaults', a: { x: 1 } },
      { $layer: 'project', a: { x: 2 } },
    ];

    // Act
    const result = merge(entries);

    // Assert
    expect(result.diagnostics).toEqual([]);
    expect(result.value).toEqual({ a: { x: 2 } });
  });
});

describe('lists are values', () => {
  test('a list set by two layers is the second list unchanged', () => {
    // Arrange
    const entries = [
      { $layer: 'defaults', list: [1, 2, 3] },
      { $layer: 'project', list: [4, 5] },
    ];

    // Act
    const result = merge(entries);

    // Assert
    expect(result.value).toEqual({ list: [4, 5] });
    expect(result.diagnostics).toEqual([]);
  });
});
