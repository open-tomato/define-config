import { describe, expect, test } from 'bun:test';

import { DIAGNOSTIC_CODES, error, pathToString, warn } from './diagnostics';

describe('DIAGNOSTIC_CODES', () => {
  test('lists the eleven stable codes without duplicates', () => {
    expect([...DIAGNOSTIC_CODES]).toEqual([
      'duplicate-key',
      'required-dropped',
      'handler-conflict',
      'unknown-step',
      'unknown-outcome',
      'impure-when',
      'cycle',
      'interactive-unattended',
      'unreachable',
      'schema',
      'load-failed',
    ]);
    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length);
  });
});

describe('pathToString', () => {
  test('renders the empty path as (root)', () => {
    expect(pathToString([])).toBe('(root)');
  });

  test('dot-joins plain segments', () => {
    expect(pathToString(['a'])).toBe('a');
    expect(pathToString(['flows', 'main', 'build'])).toBe('flows.main.build');
  });

  test('brackets segments that would be ambiguous when dot-joined', () => {
    expect(pathToString(['a', 'b.c'])).toBe('a["b.c"]');
    expect(pathToString(['a.b'])).toBe('["a.b"]');
    expect(pathToString(['a', ''])).toBe('a[""]');
    expect(pathToString(['a', 'x[0]', 'y'])).toBe('a["x[0]"].y');
    expect(pathToString(['a', 'q"t'])).toBe('a["q\\"t"]');
  });

  test('keeps ["a.b"] and ["a","b"] distinct', () => {
    expect(pathToString(['a.b'])).not.toBe(pathToString(['a', 'b']));
  });
});

describe('error and warn', () => {
  test('error builds an error-level diagnostic without entry by default', () => {
    // Arrange
    const path = ['a', 'x'];

    // Act
    const diagnostic = error('required-dropped', path, 'a.x was dropped');

    // Assert
    expect(diagnostic).toEqual({
      level: 'error',
      code: 'required-dropped',
      path: ['a', 'x'],
      message: 'a.x was dropped',
    });
    expect('entry' in diagnostic).toBe(false);
  });

  test('warn builds a warn-level diagnostic carrying the entry index', () => {
    const diagnostic = warn('duplicate-key', ['a'], 'set twice', { entry: 0 });

    expect(diagnostic).toEqual({
      level: 'warn',
      code: 'duplicate-key',
      path: ['a'],
      message: 'set twice',
      entry: 0,
    });
  });

  test('copies the path so later mutation of the input does not leak', () => {
    const path = ['a'];
    const diagnostic = error('schema', path, 'bad');

    path.push('b');

    expect(diagnostic.path).toEqual(['a']);
  });

  test('refuses an unknown code at the type level', () => {
    // @ts-expect-error 'no-such-code' is not a DiagnosticCode
    error('no-such-code', [], 'x');
    warn('cycle', [], 'x');
  });
});
