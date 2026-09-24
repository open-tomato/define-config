import type { MergeState, Provenance } from './apply';

import { describe, expect, test } from 'bun:test';

import { apply, initialState } from './apply';
import { DEFAULT_DUPLICATES, duplicates } from './duplicates';

/** Apply `entries` in order from the empty state and return the provenance. */
function provenanceOf(entries: readonly unknown[]): Provenance {
  return entries.reduce<MergeState>((state, entry, index) => apply(state, entry, index), initialState()).provenance;
}

describe('same-layer detection', () => {
  test('two entries of one layer setting a.x yield one warn naming the second', () => {
    // Arrange
    const provenance = provenanceOf([
      { $layer: 'project', a: { x: 1 } },
      { $layer: 'project', a: { x: 2 } },
    ]);

    // Act
    const diagnostics = duplicates(provenance);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      level: 'warn',
      code: 'duplicate-key',
      path: ['a', 'x'],
      entry: 1,
    });
    expect(diagnostics[0]?.message).toContain('a.x');
    expect(diagnostics[0]?.message).toContain('"project"');
  });

  test('the same keys set by different layers yield nothing', () => {
    const provenance = provenanceOf([
      { $layer: 'defaults', a: { x: 1 } },
      { $layer: 'project', a: { x: 2 } },
    ]);

    expect(duplicates(provenance)).toEqual([]);
  });

  test('unlabelled entries share one implicit layer', () => {
    const provenance = provenanceOf([{ a: 1 }, { a: 2 }]);

    const diagnostics = duplicates(provenance);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ path: ['a'], entry: 1 });
    expect(diagnostics[0]?.message).toContain('unlabelled');
  });

  test('an unlabelled entry and a labelled one are different layers', () => {
    const provenance = provenanceOf([{ a: 1 }, { $layer: 'project', a: 2 }]);

    expect(duplicates(provenance)).toEqual([]);
  });

  test('three same-layer entries on one path yield one diagnostic naming the last', () => {
    const provenance = provenanceOf([
      { $layer: 'project', a: 1 },
      { $layer: 'project', a: 2 },
      { $layer: 'project', a: 3 },
    ]);

    const diagnostics = duplicates(provenance);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.entry).toBe(2);
    expect(diagnostics[0]?.message).toContain('entries 0, 1, 2');
  });

  test('a layer interleaved with another still collides with itself', () => {
    const provenance = provenanceOf([
      { $layer: 'project', a: 1 },
      { $layer: 'defaults', a: 2 },
      { $layer: 'project', a: 3 },
    ]);

    const diagnostics = duplicates(provenance);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.entry).toBe(2);
  });

  test('collisions in two layers on one path yield one diagnostic naming the last colliding entry', () => {
    const provenance = provenanceOf([
      { $layer: 'defaults', a: 1 },
      { $layer: 'project', a: 2 },
      { $layer: 'project', a: 3 },
      { $layer: 'defaults', a: 4 },
      { $layer: 'user', a: 5 },
    ]);

    const diagnostics = duplicates(provenance);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.entry).toBe(3);
    expect(diagnostics[0]?.message).toContain('"defaults" (entries 0, 3)');
    expect(diagnostics[0]?.message).toContain('"project" (entries 1, 2)');
    expect(diagnostics[0]?.message).not.toContain('"user"');
  });

  test('maps merged by two same-layer entries collide only at the leaves both write', () => {
    const provenance = provenanceOf([
      { $layer: 'project', a: { x: 1, y: 1 } },
      { $layer: 'project', a: { y: 2, z: 2 } },
    ]);

    const diagnostics = duplicates(provenance);

    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([['a', 'y']]);
  });

  test('a $replace counts as setting its path', () => {
    const provenance = provenanceOf([
      { $layer: 'project', a: { x: 1 } },
      { $layer: 'project', a: { $replace: true, z: 4 } },
    ]);

    const diagnostics = duplicates(provenance);

    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([['a']]);
    expect(diagnostics[0]?.entry).toBe(1);
  });

  test('a false removal does not count as setting its path', () => {
    const provenance = provenanceOf([
      { $layer: 'project', a: 1 },
      { $layer: 'project', a: false },
    ]);

    expect(duplicates(provenance)).toEqual([]);
  });

  test('a set after a removal in the same layer is a second set only when an earlier set exists', () => {
    const removedThenSet = provenanceOf([
      { $layer: 'project', a: false },
      { $layer: 'project', a: 2 },
    ]);
    const setRemovedSet = provenanceOf([
      { $layer: 'project', a: 1 },
      { $layer: 'project', a: false },
      { $layer: 'project', a: 3 },
    ]);

    expect(duplicates(removedThenSet)).toEqual([]);
    expect(duplicates(setRemovedSet).map((diagnostic) => diagnostic.entry)).toEqual([2]);
  });

  test('one entry reaching a path twice counts once', () => {
    const provenance = provenanceOf([{ 'a.b': 1, a: { b: 2 } }]);

    expect(provenance.get('a.b')).toHaveLength(2);
    expect(duplicates(provenance)).toEqual([]);
  });

  test('two root $replace entries of one layer do not fire at the empty path', () => {
    const provenance = provenanceOf([
      { $layer: 'project', $replace: true, a: 1 },
      { $layer: 'project', $replace: true, b: 2 },
    ]);

    expect(provenance.get('')).toHaveLength(2);
    expect(duplicates(provenance)).toEqual([]);
  });

  test('paths are reported in the order provenance first recorded them', () => {
    const provenance = provenanceOf([
      { b: 1, a: 1, c: 1 },
      { c: 2, a: 2, b: 2 },
    ]);

    const paths = duplicates(provenance).map((diagnostic) => diagnostic.path);

    expect(paths).toEqual([['b'], ['a'], ['c']]);
  });
});

describe('the warn / error / allow option', () => {
  const provenance = provenanceOf([
    { $layer: 'project', a: 1 },
    { $layer: 'project', a: 2 },
  ]);

  test('defaults to warn', () => {
    expect(DEFAULT_DUPLICATES).toBe('warn');
    expect(duplicates(provenance).map((diagnostic) => diagnostic.level)).toEqual(['warn']);
  });

  test('error reports the same diagnostic at error level', () => {
    const diagnostics = duplicates(provenance, 'error');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'error', code: 'duplicate-key', path: ['a'], entry: 1 });
  });

  test('allow reports nothing', () => {
    expect(duplicates(provenance, 'allow')).toEqual([]);
  });

  test('an unknown option is refused at the type level and at run time', () => {
    // @ts-expect-error -- 'ignore' is not a DuplicatesOption
    expect(() => duplicates(provenance, 'ignore')).toThrow(TypeError);
  });

  test('an empty provenance yields nothing under every option', () => {
    const empty = initialState().provenance;

    expect(duplicates(empty)).toEqual([]);
    expect(duplicates(empty, 'error')).toEqual([]);
    expect(duplicates(empty, 'allow')).toEqual([]);
  });
});

describe('immutability', () => {
  test('reading provenance leaves it unchanged', () => {
    // Arrange
    const provenance = provenanceOf([{ a: { x: 1 } }, { a: { x: 2 } }]);
    const before = structuredClone([...provenance]);

    // Act
    duplicates(provenance, 'error');

    // Assert
    expect([...provenance]).toEqual(before);
  });
});
