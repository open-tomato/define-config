import { describe, expect, test } from 'bun:test';

import { CanonicalizeError, canonicalize } from './canonicalize';

/** The error `canonicalize(value)` throws, failing the test when it returns. */
function refusalOf(value: unknown): CanonicalizeError {
  try {
    const text = canonicalize(value);
    throw new Error(`expected a refusal, got ${text}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalizeError);
    return error as CanonicalizeError;
  }
}

describe('canonicalize refusals', () => {
  test('an object that contains itself is cyclic-value at the repeat', () => {
    // Arrange
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('cyclic-value');
    expect(error.path).toEqual(['self']);
    expect(error.name).toBe('CanonicalizeError');
  });

  test('an array that contains itself is cyclic-value at the repeat', () => {
    // Arrange
    const value: unknown[] = [1];
    value.push({ inner: value });

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('cyclic-value');
    expect(error.path).toEqual(['1', 'inner']);
  });

  test('NaN inside an array is not-canonical at its index', () => {
    // Arrange
    const value = { a: [NaN] };

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual(['a', '0']);
  });

  test('Infinity and -Infinity are not-canonical', () => {
    // Arrange
    const positive = { x: Infinity };
    const negative = { y: -Infinity };

    // Act
    const positiveError = refusalOf(positive);
    const negativeError = refusalOf(negative);

    // Assert
    expect(positiveError.code).toEqual('not-canonical');
    expect(positiveError.path).toEqual(['x']);
    expect(negativeError.code).toEqual('not-canonical');
    expect(negativeError.path).toEqual(['y']);
  });

  test('a bigint is not-canonical', () => {
    // Arrange
    const value = { n: 1n };

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual(['n']);
  });

  test('a symbol value is not-canonical', () => {
    // Arrange
    const value = { s: Symbol('s') };

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual(['s']);
  });

  test('undefined inside an array is not-canonical at its index', () => {
    // Arrange
    const value = [undefined];

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual(['0']);
  });

  test('undefined as the root value is not-canonical at the root', () => {
    // Arrange
    const value = undefined;

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual([]);
  });

  test('an invalid Date is not-canonical', () => {
    // Arrange
    const value = { when: new Date('not a date') };

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual(['when']);
  });

  test('a plain object whose only key is a tag name is not-canonical', () => {
    // Arrange
    const value = { $date: 'x' };

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual([]);
  });

  test('every tag name is refused as the only key, nested', () => {
    for (const tag of ['$date', '$map', '$set', '$function']) {
      // Arrange
      const value = { outer: { [tag]: 'x' } };

      // Act
      const error = refusalOf(value);

      // Assert
      expect(error.code).toEqual('not-canonical');
      expect(error.path).toEqual(['outer']);
    }
  });

  test('a refusal inside a Map value carries the key text as its segment', () => {
    // Arrange
    const value = { m: new Map([['k', NaN]]) };

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual(['m', '"k"']);
  });

  test('a refusal inside a Set carries the member position as its segment', () => {
    // Arrange
    const value = new Set([1, NaN]);

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual(['1']);
  });

  test('the message names the path', () => {
    // Arrange
    const value = { a: [NaN] };

    // Act
    const error = refusalOf(value);

    // Assert
    expect(error.message).toBe('canonicalize: NaN at a.0 has no canonical text');
  });
});

describe('canonicalize plain values', () => {
  test('keys are sorted at every level, arrays keep their order, -0 is 0', () => {
    // Arrange
    const value = { b: 1, a: { d: [2, 1], c: -0 } };

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('{"a":{"c":0,"d":[2,1]},"b":1}');
  });

  test('keys are sorted by UTF-16 code unit, nested', () => {
    // Arrange
    const value = { a: 1, B: { z: 1, a: 2, Z: 3 } };

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('{"B":{"Z":3,"a":2,"z":1},"a":1}');
  });

  test('undefined properties and symbol keys are dropped', () => {
    // Arrange
    const value = { a: 1, gone: undefined, [Symbol('s')]: 2, nested: { x: undefined } };

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('{"a":1,"nested":{}}');
  });

  test('numbers are written as String(n), -0 as 0', () => {
    // Arrange
    const table: ReadonlyArray<readonly [number, string]> = [
      [1e21, '1e+21'],
      [1e-7, '1e-7'],
      [0.1, '0.1'],
      [-0, '0'],
      [2 ** 53, '9007199254740992'],
      [5e-324, '5e-324'],
    ];

    for (const [value, expected] of table) {
      // Act
      const text = canonicalize(value);

      // Assert
      expect(text).toBe(expected);
    }
  });

  test('a string is written as JSON.stringify writes it, without normalisation', () => {
    // Arrange
    const value = 'say "hi"\u0001 \u{1F345} é';

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('"say \\"hi\\"\\u0001 \u{1F345} é"');
  });

  test('true, false and null are written as in JSON', () => {
    // Arrange
    const value = [true, false, null];

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('[true,false,null]');
  });

  test('a plain object carrying $start is written with an ordinary key', () => {
    // Arrange
    const value = { $start: 'build', build: { ok: 'done' } };

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('{"$start":"build","build":{"ok":"done"}}');
  });

  test('a tag name beside another key is written as an ordinary key', () => {
    // Arrange
    const value = { $date: 'x', other: 1 };

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('{"$date":"x","other":1}');
  });

  test('a shared object under two keys is written twice', () => {
    // Arrange
    const shared = { v: 1 };
    const value = { a: shared, b: shared, list: [shared, shared] };

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('{"a":{"v":1},"b":{"v":1},"list":[{"v":1},{"v":1}]}');
  });
});

describe('canonicalize tagged values', () => {
  test('a Date is written as $date with its ISO text', () => {
    // Arrange
    const value = { when: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)) };

    // Act
    const text = canonicalize(value);

    // Assert
    expect(text).toBe('{"when":{"$date":"2026-01-02T03:04:05.006Z"}}');
  });

  test('a Map inserted in two orders gives one text, sorted by key text', () => {
    // Arrange
    const forward = new Map<unknown, unknown>([['b', 2], [1, { y: 1, x: 2 }], ['a', 1]]);
    const backward = new Map<unknown, unknown>([['a', 1], [1, { x: 2, y: 1 }], ['b', 2]]);

    // Act
    const forwardText = canonicalize(forward);
    const backwardText = canonicalize(backward);

    // Assert
    expect(forwardText).toBe('{"$map":[["a",1],["b",2],[1,{"x":2,"y":1}]]}');
    expect(backwardText).toBe(forwardText);
  });

  test('Map entries whose keys share one text are ordered by value text', () => {
    // Arrange
    const forward = new Map<unknown, unknown>([[{}, 2], [{}, 1]]);
    const backward = new Map<unknown, unknown>([[{}, 1], [{}, 2]]);

    // Act
    const forwardText = canonicalize(forward);
    const backwardText = canonicalize(backward);

    // Assert
    expect(forwardText).toBe('{"$map":[[{},1],[{},2]]}');
    expect(backwardText).toBe(forwardText);
  });

  test('a Set inserted in two orders gives one text, sorted by member text', () => {
    // Arrange
    const forward = new Set<unknown>(['b', 10, 'a', 9]);
    const backward = new Set<unknown>([9, 'a', 10, 'b']);

    // Act
    const forwardText = canonicalize(forward);
    const backwardText = canonicalize(backward);

    // Assert
    expect(forwardText).toBe('{"$set":["a","b",10,9]}');
    expect(backwardText).toBe(forwardText);
  });

  test('a named function is written as $function with its name', () => {
    // Arrange
    function build(): number {
      return 1;
    }

    // Act
    const text = canonicalize({ run: build });

    // Assert
    expect(text).toBe('{"run":{"$function":"build"}}');
  });

  test('an anonymous function is written as $function with an empty name', () => {
    // Arrange
    const functions = [(() => () => 1)()];

    // Act
    const text = canonicalize(functions);

    // Assert
    expect(text).toBe('[{"$function":""}]');
  });

  test('a class instance is written by its own enumerable properties', () => {
    // Arrange
    class Point {
      readonly y: number;
      readonly x: number;
      constructor(x: number, y: number) {
        this.y = y;
        this.x = x;
      }
      get sum(): number {
        return this.x + this.y;
      }
    }

    // Act
    const text = canonicalize({ at: new Point(1, 2) });

    // Assert
    expect(text).toBe('{"at":{"x":1,"y":2}}');
  });
});

describe('canonicalize size', () => {
  test('a 10 000-key object is canonicalized in under 1 000 ms', () => {
    // Arrange
    const keyCount = 10_000;
    const limitMs = 1_000;
    const value = Object.fromEntries(Array.from({ length: keyCount }, (_, index) => [`key${keyCount - index}`, { index, tags: ['a', 'b'] }]));

    // Act
    const started = performance.now();
    const text = canonicalize(value);
    const elapsedMs = performance.now() - started;
    console.log(`canonicalize: ${keyCount} keys in ${elapsedMs.toFixed(1)} ms`);

    // Assert
    expect(text.startsWith('{"key1":{"index":9999,')).toBe(true);
    expect(elapsedMs).toBeLessThan(limitMs);
  });
});
