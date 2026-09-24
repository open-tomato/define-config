import { describe, expect, test } from 'bun:test';

import { CanonicalizeError } from './canonicalize';
import { digest } from './digest';

describe('digest', () => {
  test('a refusal propagates as CanonicalizeError', () => {
    // Arrange
    const value = { a: [Number.NaN] };

    // Act
    let caught: unknown;
    try {
      digest(value);
    } catch (error) {
      caught = error;
    }

    // Assert
    expect(caught).toBeInstanceOf(CanonicalizeError);
    const error = caught as CanonicalizeError;
    expect(error.code).toEqual('not-canonical');
    expect(error.path).toEqual(['a', '0']);
  });

  test('a digest is sha256: followed by 64 lowercase hex characters', () => {
    // Arrange
    const value = { port: 8000 };

    // Act
    const result = digest(value);

    // Assert
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('the digest of {} is the SHA-256 of the text {}', () => {
    // Arrange
    const value = {};

    // Act
    const result = digest(value);

    // Assert
    expect(result).toBe(
      'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
  });

  test('two key orders of one object give one digest', () => {
    // Arrange
    const first = { a: 1, b: { c: 2, d: 3 } };
    const second = { b: { d: 3, c: 2 }, a: 1 };

    // Act
    const results = [digest(first), digest(second)];

    // Assert
    expect(results[0]).toBe(results[1]);
  });

  test('one changed value gives a different digest', () => {
    // Arrange
    const first = { a: 1, b: 2 };
    const second = { a: 1, b: 3 };

    // Act
    const results = [digest(first), digest(second)];

    // Assert
    expect(results[0]).not.toBe(results[1]);
  });

  test('two functions with one name and different bodies give one digest', () => {
    // Arrange
    const first = { run: function step() { return 1; } };
    const second = { run: function step() { return 2; } };

    // Act
    const results = [digest(first), digest(second)];

    // Assert
    expect(first.run()).not.toBe(second.run());
    expect(results[0]).toBe(results[1]);
  });

  test('two functions with different names give different digests', () => {
    // Arrange
    const first = { run: function stepA() { return 1; } };
    const second = { run: function stepB() { return 1; } };

    // Act
    const results = [digest(first), digest(second)];

    // Assert
    expect(results[0]).not.toBe(results[1]);
  });
});
