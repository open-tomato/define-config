import type { MergeState } from './apply';

import { describe, expect, test } from 'bun:test';

import { apply, initialState, pathKey } from './apply';

/** Apply `entries` in order from the empty state. */
function applyAll(entries: readonly unknown[]): MergeState {
  return entries.reduce<MergeState>((state, entry, index) => apply(state, entry, index), initialState());
}

/** Every object (arrays included) reachable from `root`, root first. */
function objectsIn(root: unknown): object[] {
  if (typeof root !== 'object' || root === null) {
    return [];
  }
  return [root, ...Object.values(root).flatMap(objectsIn)];
}

/** `true` when some object reachable from `a` is also reachable from `b`. */
function sharesIdentity(a: unknown, b: unknown): boolean {
  const inB = new Set(objectsIn(b));
  return objectsIn(a).some((object) => inB.has(object));
}

describe('pathKey and initialState', () => {
  test('pathKey dot-joins a path, and the empty path joins to the empty string', () => {
    expect(pathKey(['flows', 'main', 'build'])).toBe('flows.main.build');
    expect(pathKey([])).toBe('');
  });

  test('initialState returns a new empty state on each call', () => {
    // Act
    const first = initialState();
    const second = initialState();

    // Assert
    expect(first.value).toEqual({});
    expect(first.provenance.size).toBe(0);
    expect(first.value).not.toBe(second.value);
    expect(first.provenance).not.toBe(second.provenance);
  });
});

describe('apply: values', () => {
  test('a scalar sets its key and records a set by the entry', () => {
    // Act
    const state = applyAll([{ name: 'app' }]);

    // Assert
    expect(state.value).toEqual({ name: 'app' });
    expect(state.provenance.get('name')).toEqual([{ entry: 0, kind: 'set' }]);
  });

  test('a later scalar replaces an earlier one, and both sets are recorded in order', () => {
    // Act
    const state = applyAll([{ port: 1 }, { port: 2 }]);

    // Assert
    expect(state.value).toEqual({ port: 2 });
    expect(state.provenance.get('port')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'set' },
    ]);
  });

  test('a later array replaces an earlier one whole, never element-wise', () => {
    // Act
    const state = applyAll([{ tags: ['a', 'b', 'c'] }, { tags: ['z'] }]);

    // Assert
    expect(state.value).toEqual({ tags: ['z'] });
    expect(state.provenance.get('tags')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'set' },
    ]);
  });

  test('an array is copied as data: false and $replace inside it are kept, nothing is recorded below it', () => {
    // Arrange
    const list = [{ on: false }, { $replace: true, x: 1 }, [false]];

    // Act
    const state = applyAll([{ list }]);

    // Assert
    expect(state.value).toEqual({ list: [{ on: false }, { $replace: true, x: 1 }, [false]] });
    expect(state.value.list).not.toBe(list);
    expect(sharesIdentity(state.value, list)).toBe(false);
    expect([...state.provenance.keys()]).toEqual(['list']);
  });

  test('null, zero, the empty string and true are values that replace', () => {
    // Act
    const state = applyAll([{ a: { x: 1 }, b: 1, c: 'c', d: false }, { a: null, b: 0, c: '', d: true }]);

    // Assert
    expect(state.value).toEqual({ a: null, b: 0, c: '', d: true });
  });

  test('functions and class instances are values kept by reference, not maps', () => {
    // Arrange
    const handler = () => 'ran';
    const when = new Date(0);

    // Act
    const state = applyAll([{ when: { x: 1 } }, { handler, when }]);

    // Assert
    expect(state.value.handler).toBe(handler);
    expect(state.value.when).toBe(when);
    expect(state.provenance.get('when')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'set' },
    ]);
  });

  test('undefined is the same as an absent key: nothing changes, nothing is recorded', () => {
    // Act
    const state = applyAll([{ a: 1, b: { x: 1 } }, { a: undefined, b: { x: undefined } }]);

    // Assert
    expect(state.value).toEqual({ a: 1, b: { x: 1 } });
    expect(state.provenance.get('a')).toEqual([{ entry: 0, kind: 'set' }]);
    expect(state.provenance.get('b.x')).toEqual([{ entry: 0, kind: 'set' }]);
  });
});

describe('apply: maps', () => {
  test('maps merge key by key, recursively', () => {
    // Act
    const state = applyAll([{ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } }]);

    // Assert
    expect(state.value).toEqual({ a: { x: 1, y: 3, z: 4 } });
  });

  test('a map merged into a map records only the keys it writes, not the map path', () => {
    // Act
    const state = applyAll([{ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } }]);

    // Assert
    expect(state.provenance.get('a')).toEqual([{ entry: 0, kind: 'set' }]);
    expect(state.provenance.get('a.x')).toEqual([{ entry: 0, kind: 'set' }]);
    expect(state.provenance.get('a.y')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'set' },
    ]);
    expect(state.provenance.get('a.z')).toEqual([{ entry: 1, kind: 'set' }]);
  });

  test('deep maps merge at every depth', () => {
    // Act
    const state = applyAll([
      { flows: { main: { lint: { run: 'lint' }, build: { run: 'build' } } } },
      { flows: { main: { build: { retries: 2 } } } },
    ]);

    // Assert
    expect(state.value).toEqual({
      flows: { main: { lint: { run: 'lint' }, build: { run: 'build', retries: 2 } } },
    });
    expect(state.provenance.get('flows.main.build.retries')).toEqual([{ entry: 1, kind: 'set' }]);
  });

  test('a map over a scalar starts a new map and records a set at its path', () => {
    // Act
    const state = applyAll([{ a: 5 }, { a: { x: 1 } }]);

    // Assert
    expect(state.value).toEqual({ a: { x: 1 } });
    expect(state.provenance.get('a')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'set' },
    ]);
  });

  test('a scalar over a map replaces the map', () => {
    // Act
    const state = applyAll([{ a: { x: 1 } }, { a: 5 }]);

    // Assert
    expect(state.value).toEqual({ a: 5 });
    expect(state.provenance.get('a')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'set' },
    ]);
  });

  test('an empty map creates its key and records a set', () => {
    // Act
    const state = applyAll([{ steps: {} }]);

    // Assert
    expect(state.value).toEqual({ steps: {} });
    expect(state.provenance.get('steps')).toEqual([{ entry: 0, kind: 'set' }]);
  });

  test('keys keep their order: existing keys first, new keys after, a rewritten key in place', () => {
    // Act
    const state = applyAll([{ b: 1, a: 1 }, { c: 1, b: 2 }]);

    // Assert
    expect(Object.keys(state.value)).toEqual(['b', 'a', 'c']);
  });
});

describe('apply: false removes', () => {
  test('false removes a key and records a remove', () => {
    // Act
    const state = applyAll([{ steps: { lint: { run: 'lint' }, build: { run: 'build' } } }, { steps: { lint: false } }]);

    // Assert
    expect(state.value).toEqual({ steps: { build: { run: 'build' } } });
    expect(state.provenance.get('steps.lint')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'remove' },
    ]);
  });

  test('the history below a removed key stays in provenance', () => {
    // Act
    const state = applyAll([{ a: { x: 1 } }, { a: false }]);

    // Assert
    expect(state.value).toEqual({});
    expect(state.provenance.get('a.x')).toEqual([{ entry: 0, kind: 'set' }]);
    expect(state.provenance.get('a')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'remove' },
    ]);
  });

  test('false on an absent key leaves it absent and still records the remove', () => {
    // Act
    const state = applyAll([{ a: { x: 1 } }, { a: { y: false }, b: false }]);

    // Assert
    expect(state.value).toEqual({ a: { x: 1 } });
    expect('b' in state.value).toBe(false);
    expect(state.provenance.get('a.y')).toEqual([{ entry: 1, kind: 'remove' }]);
    expect(state.provenance.get('b')).toEqual([{ entry: 1, kind: 'remove' }]);
  });

  test('a set after a false restores the key with the new value', () => {
    // Act
    const state = applyAll([{ a: { x: 1 } }, { a: false }, { a: { y: 2 } }]);

    // Assert
    expect(state.value).toEqual({ a: { y: 2 } });
  });
});

describe('apply: $replace swaps the subtree', () => {
  test('$replace discards what earlier entries put at the key and keeps only rest', () => {
    // Act
    const state = applyAll([{ a: { x: 1 } }, { a: { $replace: true, z: 4 } }]);

    // Assert
    expect(state.value).toEqual({ a: { z: 4 } });
  });

  test('$replace is recorded at its path, and the keys of rest as sets', () => {
    // Act
    const state = applyAll([{ a: { x: 1 } }, { a: { $replace: true, z: 4 } }]);

    // Assert
    expect(state.provenance.get('a')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'replace' },
    ]);
    expect(state.provenance.get('a.z')).toEqual([{ entry: 1, kind: 'set' }]);
    expect(state.provenance.get('a.x')).toEqual([{ entry: 0, kind: 'set' }]);
  });

  test('the $replace key never reaches the value, at any depth', () => {
    // Act
    const state = applyAll([
      { a: { b: { c: 1 } } },
      { a: { $replace: true, b: { $replace: true, d: 2 } } },
    ]);

    // Assert
    expect(state.value).toEqual({ a: { b: { d: 2 } } });
    expect(JSON.stringify(state.value)).not.toContain('$replace');
    expect(state.provenance.get('a.b')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'replace' },
    ]);
  });

  test('rest is read onto an empty map: a false inside it leaves its key out', () => {
    // Act
    const state = applyAll([{ a: { x: 1, y: 2 } }, { a: { $replace: true, x: false, z: { q: 1 } } }]);

    // Assert
    expect(state.value).toEqual({ a: { z: { q: 1 } } });
    expect(state.provenance.get('a.x')).toEqual([
      { entry: 0, kind: 'set' },
      { entry: 1, kind: 'remove' },
    ]);
    expect(state.provenance.get('a.z')).toEqual([{ entry: 1, kind: 'set' }]);
  });

  test('$replace with nothing else empties the subtree but keeps the key', () => {
    // Act
    const state = applyAll([{ a: { x: 1 } }, { a: { $replace: true } }]);

    // Assert
    expect(state.value).toEqual({ a: {} });
  });

  test('$replace on an absent key starts the subtree from rest', () => {
    // Act
    const state = applyAll([{ $replace: false, a: { $replace: true, z: 4 } }]);

    // Assert
    expect(state.value).toEqual({ a: { z: 4 } });
    expect(state.provenance.get('a')).toEqual([{ entry: 0, kind: 'replace' }]);
  });

  test('$replace set to anything but true merges, and its key is still dropped', () => {
    // Act
    const state = applyAll([{ a: { x: 1 } }, { a: { $replace: false, z: 4 } }, { a: { $replace: 'yes', w: 5 } }]);

    // Assert
    expect(state.value).toEqual({ a: { x: 1, z: 4, w: 5 } });
    expect(state.provenance.get('a')).toEqual([{ entry: 0, kind: 'set' }]);
  });

  test('$replace applied twice gives the value it gives once', () => {
    // Arrange
    const replacing = { a: { $replace: true, z: 4 } };

    // Act
    const once = applyAll([{ a: { x: 1 } }, replacing]);
    const twice = applyAll([{ a: { x: 1 } }, replacing, replacing]);

    // Assert
    expect(twice.value).toEqual(once.value);
  });

  test('$replace on the entry itself replaces the whole value and records at the empty path', () => {
    // Act
    const state = applyAll([{ a: 1, b: { x: 1 } }, { $replace: true, c: 3 }]);

    // Assert
    expect(state.value).toEqual({ c: 3 });
    expect(state.provenance.get('')).toEqual([{ entry: 1, kind: 'replace' }]);
  });
});

describe('apply: $layer', () => {
  test('$layer on the entry labels its records and never reaches the value', () => {
    // Act
    const state = applyAll([{ $layer: 'defaults', a: { x: 1 } }, { $layer: 'project', a: { x: false } }]);

    // Assert
    expect(state.value).toEqual({ a: {} });
    expect(state.provenance.get('a.x')).toEqual([
      { entry: 0, layer: 'defaults', kind: 'set' },
      { entry: 1, layer: 'project', kind: 'remove' },
    ]);
  });

  test('an entry without $layer leaves layer out of its records', () => {
    // Act
    const state = applyAll([{ a: 1 }]);
    const [touch] = state.provenance.get('a') ?? [];

    // Assert
    expect(touch).toBeDefined();
    expect(touch !== undefined && 'layer' in touch).toBe(false);
  });

  test('$layer below the top level is an ordinary key', () => {
    // Act
    const state = applyAll([{ meta: { $layer: 'kept' } }]);

    // Assert
    expect(state.value).toEqual({ meta: { $layer: 'kept' } });
    expect(state.provenance.get('meta.$layer')).toEqual([{ entry: 0, kind: 'set' }]);
  });

  test('a $layer that is not a string is refused with a TypeError naming the entry', () => {
    // Arrange
    const state = applyAll([{ a: 1 }]);

    // Act / Assert
    expect(() => apply(state, { $layer: 7, a: 2 }, 1)).toThrow(new TypeError('entry 1: $layer must be a string, got number'));
    expect(() => apply(state, { $layer: 'user', a: 2 }, 1)).not.toThrow();
  });
});

describe('apply: input checks', () => {
  test('an entry that is not a plain object is refused with a TypeError naming the entry', () => {
    // Arrange
    const state = initialState();

    // Act / Assert
    expect(() => apply(state, null, 0)).toThrow(new TypeError('entry 0: expected a plain object, got null'));
    expect(() => apply(state, [{ a: 1 }], 1)).toThrow(new TypeError('entry 1: expected a plain object, got an array'));
    expect(() => apply(state, 'a', 2)).toThrow(new TypeError('entry 2: expected a plain object, got string'));
    expect(() => apply(state, new Date(0), 3)).toThrow(new TypeError('entry 3: expected a plain object, got object'));
    expect(() => apply(state, Object.create(null), 4)).not.toThrow();
  });

  test('a __proto__ key from parsed JSON stays an own key and pollutes no prototype', () => {
    // Arrange
    const entry: unknown = JSON.parse('{"__proto__": {"polluted": true}, "a": {"__proto__": {"deep": true}}}');

    // Act
    const state = apply(initialState(), entry, 0);

    // Assert
    expect(Object.getPrototypeOf(state.value)).toBe(Object.prototype);
    expect(Object.keys(state.value)).toEqual(['__proto__', 'a']);
    expect(Object.getOwnPropertyDescriptor(state.value, '__proto__')?.value).toEqual({ polluted: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).deep).toBeUndefined();
  });
});

describe('apply: immutability', () => {
  test('neither the entry nor the previous state is changed', () => {
    // Arrange
    const first = { $layer: 'p', a: { x: 1, y: [1, 2] }, b: { c: 1 } };
    const second = { $layer: 'p', a: { $replace: true, z: 4 }, b: { c: false }, d: [{ e: 1 }] };
    const before = apply(initialState(), first, 0);
    const snapshots = {
      first: structuredClone(first),
      second: structuredClone(second),
      value: structuredClone(before.value),
      provenance: structuredClone([...before.provenance]),
    };

    // Act
    const after = apply(before, second, 1);

    // Assert
    expect(after).not.toBe(before);
    expect(after.provenance).not.toBe(before.provenance);
    expect(first).toEqual(snapshots.first);
    expect(second).toEqual(snapshots.second);
    expect(before.value).toEqual(snapshots.value);
    expect([...before.provenance]).toEqual(snapshots.provenance);
    // Control: the snapshot comparison sees a change when there is one.
    expect(after.value).not.toEqual(snapshots.value);
    expect([...after.provenance]).not.toEqual(snapshots.provenance);
  });

  test('the value shares no object with any entry', () => {
    // Arrange
    const entries = [
      { a: { x: { deep: 1 } }, list: [{ item: 1 }] },
      { a: { $replace: true, y: { deep: 2 } }, b: {} },
    ];

    // Act
    const state = applyAll(entries);

    // Assert
    expect(state.value).toEqual({ a: { y: { deep: 2 } }, list: [{ item: 1 }], b: {} });
    expect(sharesIdentity(state.value, entries)).toBe(false);
    // Control: the identity check finds a shared object when there is one.
    expect(sharesIdentity({ held: entries[0]?.list }, entries)).toBe(true);
  });

  test('a subtree the entry does not touch is shared with the previous value', () => {
    // Arrange
    const before = applyAll([{ kept: { x: 1 }, changed: { y: 1 } }]);

    // Act
    const after = apply(before, { changed: { y: 2 } }, 1);

    // Assert
    expect(after.value.kept).toBe(before.value.kept);
    expect(after.value.changed).not.toBe(before.value.changed);
    expect(before.value.changed).toEqual({ y: 1 });
  });
});
