import { describe, expect, test } from 'bun:test';

import { isPlainObject } from './plain-object';

describe('isPlainObject', () => {
  test('an object literal is plain', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  test('an object with a null prototype is plain', () => {
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  test('an array is not plain', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2])).toBe(false);
  });

  test('a class instance is not plain', () => {
    class Point {
      readonly x = 1;
    }
    expect(isPlainObject(new Point())).toBe(false);
    expect(isPlainObject(new Date(0))).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
  });

  test('an object whose prototype is another plain object is not plain', () => {
    expect(isPlainObject(Object.create({}))).toBe(false);
  });

  test('null is not plain', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  test('primitives and functions are not plain', () => {
    for (const value of [undefined, 0, 1n, 'a', true, Symbol('s'), () => 1]) {
      expect(isPlainObject(value)).toBe(false);
    }
  });

  test('a true result narrows to a readable record', () => {
    const value: unknown = { a: 1 };
    if (isPlainObject(value)) {
      const read: unknown = value.a;
      expect(read).toBe(1);
      // @ts-expect-error the narrowed record is readonly
      value.a = 2;
    }
  });
});
