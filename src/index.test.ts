import { describe, expect, test } from 'bun:test';

describe('package entry', () => {
  test('evaluates without throwing and yields a module namespace', async () => {
    const entry = await import('./index');

    expect(typeof entry).toBe('object');
  });
});
