import type { ProvenanceRecord } from './apply';

import { describe, expect, test } from 'bun:test';

import { provenanceOf } from '../provenance';

import { merge } from './index';

describe('a key set by defaults and overridden by project', () => {
  const entries = [
    { $layer: 'defaults', a: { x: 1 } },
    { $layer: 'project', a: { x: 2 } },
  ];
  const expected: ProvenanceRecord[] = [
    { entry: 0, layer: 'defaults', kind: 'set' },
    { entry: 1, layer: 'project', kind: 'set' },
  ];

  test('holds two records in entry order through result.provenance.get', () => {
    // Arrange
    const result = merge(entries);

    // Act
    const records = result.provenance.get('a.x');

    // Assert
    expect(records).toEqual(expected);
  });

  test('holds the same records through provenanceOf, by string or array path', () => {
    const result = merge(entries);

    expect(provenanceOf(result, 'a.x')).toEqual(expected);
    expect(provenanceOf(result, ['a', 'x'])).toEqual(expected);
  });
});

describe('a key removed with false', () => {
  const entries = [
    { $layer: 'defaults', a: { x: 1, y: 2 } },
    { $layer: 'project', a: { x: false } },
  ];
  const expected: ProvenanceRecord[] = [
    { entry: 0, layer: 'defaults', kind: 'set' },
    { entry: 1, layer: 'project', kind: 'remove' },
  ];

  test('holds remove last through result.provenance.get', () => {
    const result = merge(entries);

    const records = result.provenance.get('a.x');

    expect(result.value).toEqual({ a: { y: 2 } });
    expect(records).toEqual(expected);
    expect(records?.at(-1)?.kind).toBe('remove');
  });

  test('holds remove last through provenanceOf', () => {
    const result = merge(entries);

    expect(provenanceOf(result, 'a.x')).toEqual(expected);
    expect(provenanceOf(result, ['a', 'y'])).toEqual([{ entry: 0, layer: 'defaults', kind: 'set' }]);
  });
});

describe('a keyed $replace', () => {
  const entries = [
    { $layer: 'defaults', a: { x: 1, y: 2 } },
    { $layer: 'project', a: { $replace: true, x: 9 } },
  ];

  test('keeps the pre-replace records of a path under it and holds replace at the key, via result.provenance.get', () => {
    const result = merge(entries);

    expect(result.value).toEqual({ a: { x: 9 } });
    expect(result.provenance.get('a.y')).toEqual([{ entry: 0, layer: 'defaults', kind: 'set' }]);
    expect(result.provenance.get('a.x')).toEqual([
      { entry: 0, layer: 'defaults', kind: 'set' },
      { entry: 1, layer: 'project', kind: 'set' },
    ]);
    expect(result.provenance.get('a')?.at(-1)).toEqual({ entry: 1, layer: 'project', kind: 'replace' });
  });

  test('reads the same records through provenanceOf', () => {
    const result = merge(entries);

    expect(provenanceOf(result, 'a.y')).toEqual([{ entry: 0, layer: 'defaults', kind: 'set' }]);
    expect(provenanceOf(result, ['a']).at(-1)).toEqual({ entry: 1, layer: 'project', kind: 'replace' });
  });
});
