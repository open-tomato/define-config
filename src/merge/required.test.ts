import type { MergeState } from './apply';

import { describe, expect, test } from 'bun:test';

import { apply, initialState } from './apply';
import { required } from './required';

/** Apply `entries` in order from the empty state. */
function stateOf(entries: readonly unknown[]): MergeState {
  return entries.reduce<MergeState>((state, entry, index) => apply(state, entry, index), initialState());
}

/** Merge `entries` and run the required check over `paths`. */
function check(entries: readonly unknown[], paths: readonly string[]) {
  const state = stateOf(entries);
  return required(state.value, state.provenance, paths);
}

describe('present paths', () => {
  test('a path present in the merged value yields nothing', () => {
    expect(check([{ a: { x: 1 } }, { a: { y: 2 } }], ['a.x', 'a.y', 'a'])).toEqual([]);
  });

  test('a present path holding a falsy value still counts as present', () => {
    expect(check([{ a: { x: 0, y: '', z: null } }], ['a.x', 'a.y', 'a.z'])).toEqual([]);
  });

  test('a path set again after it was dropped is present', () => {
    expect(check([{ a: { x: 1 } }, { a: false }, { a: { x: 2 } }], ['a.x'])).toEqual([]);
  });

  test('no required paths yields nothing', () => {
    expect(check([{ a: false }], [])).toEqual([]);
  });
});

describe('the entry that dropped the path', () => {
  test('a $replace above the path names the replacing entry', () => {
    // Arrange
    const entries = [{ a: { x: 1 } }, { a: { $replace: true, z: 4 } }];

    // Act
    const diagnostics = check(entries, ['a.x']);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      level: 'error',
      code: 'required-dropped',
      path: ['a', 'x'],
      entry: 1,
    });
    expect(diagnostics[0]?.message).toContain('a.x');
    expect(diagnostics[0]?.message).toContain('entry 1 replaced a with $replace');
  });

  test('false at the path itself names the removing entry', () => {
    const diagnostics = check([{ a: { x: 1 } }, { b: 1 }, { a: { x: false } }], ['a.x']);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.entry).toBe(2);
    expect(diagnostics[0]?.message).toContain('removed a.x with false');
  });

  test('false above the path names the removing entry', () => {
    const diagnostics = check([{ a: { b: { c: 1 } } }, { a: false }], ['a.b.c']);

    expect(diagnostics.map((diagnostic) => diagnostic.entry)).toEqual([1]);
    expect(diagnostics[0]?.message).toContain('removed a with false');
  });

  test('a $replace on the entry itself names that entry', () => {
    const diagnostics = check([{ a: { x: 1 } }, { $replace: true, b: 2 }], ['a.x']);

    expect(diagnostics.map((diagnostic) => diagnostic.entry)).toEqual([1]);
    expect(diagnostics[0]?.message).toContain('replaced the whole value');
  });

  test('a value that is not a map above the path names the entry that set it', () => {
    const scalar = check([{ a: { x: 1 } }, { a: 5 }], ['a.x']);
    const list = check([{ a: { x: 1 } }, { a: [{ x: 1 }] }], ['a.x']);

    expect(scalar.map((diagnostic) => diagnostic.entry)).toEqual([1]);
    expect(scalar[0]?.message).toContain('set a to a value that is not a map');
    expect(list.map((diagnostic) => diagnostic.entry)).toEqual([1]);
  });

  test('a $replace at the path itself does not drop it', () => {
    expect(check([{ a: { x: 1 } }, { a: { $replace: true } }], ['a'])).toEqual([]);
  });

  test('of several drops, the first after the last set is named', () => {
    const diagnostics = check(
      [{ a: { x: 1 } }, { a: { x: false } }, { a: false }, { a: { $replace: true } }],
      ['a.x'],
    );

    expect(diagnostics.map((diagnostic) => diagnostic.entry)).toEqual([1]);
  });

  test('drops before the last set are not named', () => {
    const diagnostics = check(
      [{ a: { x: 1 } }, { a: false }, { a: { x: 2 } }, { a: { $replace: true, y: 1 } }],
      ['a.x'],
    );

    expect(diagnostics.map((diagnostic) => diagnostic.entry)).toEqual([3]);
  });

  test('a map restarted over a scalar is not mistaken for the drop', () => {
    const diagnostics = check([{ a: { x: 1 } }, { a: 5 }, { a: { y: 1 } }], ['a.x']);

    expect(diagnostics.map((diagnostic) => diagnostic.entry)).toEqual([1]);
  });
});

describe('paths no entry dropped', () => {
  test('a path no entry ever set yields an error without an entry', () => {
    const diagnostics = check([{ a: { y: 1 } }], ['a.x']);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'error', code: 'required-dropped', path: ['a', 'x'] });
    expect(diagnostics[0]).not.toHaveProperty('entry');
    expect(diagnostics[0]?.message).toContain('no entry sets it');
  });

  test('false on a path never set does not count as dropping it', () => {
    const diagnostics = check([{ a: { x: false } }], ['a.x']);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).not.toHaveProperty('entry');
  });

  test('no entries at all reports every required path without an entry', () => {
    const diagnostics = check([], ['a', 'b.c']);

    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([['a'], ['b', 'c']]);
    expect(diagnostics.every((diagnostic) => diagnostic.entry === undefined)).toBe(true);
  });

  test('a dotted key records the path but is not the nested path, and no entry is named', () => {
    const diagnostics = check([{ 'a.x': 1 }], ['a.x']);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).not.toHaveProperty('entry');
    expect(diagnostics[0]?.message).toContain('absent from the merged value');
  });
});

describe('presence', () => {
  test('a path through an array is absent', () => {
    expect(check([{ a: ['x'] }], ['a.0'])).toHaveLength(1);
  });

  test('a path through a class instance is absent', () => {
    class Box {
      readonly x = 1;
    }

    expect(check([{ a: new Box() }], ['a.x'])).toHaveLength(1);
  });

  test('an inherited key does not count as present', () => {
    expect(check([{ a: {} }], ['a.toString'])).toHaveLength(1);
  });
});

describe('the paths option', () => {
  test('diagnostics follow the order of the paths', () => {
    const diagnostics = check([{ a: 1 }], ['c', 'a', 'b']);

    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([['c'], ['b']]);
  });

  test('a path listed twice is reported once', () => {
    expect(check([], ['a.x', 'a.x'])).toHaveLength(1);
  });

  test('a path with an empty key is refused', () => {
    expect(() => check([], [''])).toThrow(TypeError);
    expect(() => check([], ['a..b'])).toThrow(TypeError);
    expect(() => check([], ['a.'])).toThrow(TypeError);
  });

  test('a non-string path is refused at the type level and at run time', () => {
    const state = stateOf([]);

    // @ts-expect-error -- a path is a dot-joined string
    expect(() => required(state.value, state.provenance, [['a', 'x']])).toThrow(TypeError);
  });

  test('a non-array paths option is refused at the type level and at run time', () => {
    const state = stateOf([]);

    // @ts-expect-error -- paths is an array
    expect(() => required(state.value, state.provenance, 'a.x')).toThrow(TypeError);
  });
});

describe('immutability', () => {
  test('the check leaves the value, the provenance and the paths unchanged', () => {
    // Arrange
    const state = stateOf([{ a: { x: 1 } }, { a: { $replace: true, z: 4 } }]);
    const value = structuredClone(state.value);
    const provenance = structuredClone([...state.provenance]);
    const paths = ['a.x', 'a.z'];

    // Act
    required(state.value, state.provenance, paths);

    // Assert
    expect(state.value).toEqual(value);
    expect([...state.provenance]).toEqual(provenance);
    expect(paths).toEqual(['a.x', 'a.z']);
  });
});
