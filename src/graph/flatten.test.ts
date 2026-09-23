import { describe, expect, test } from 'bun:test';

import { pathToString } from '../diagnostics';

import { flatten } from './flatten';
import { normalise } from './normalise';

describe('inline entries', () => {
  test('an inline entry becomes a node with id <parent id>.<outcome> and the handler names it', () => {
    // Arrange
    const flows = { next: { build: { step: 'build', on: { success: { step: 'deploy', region: 'eu' }, fail: 'stop' } }, stop: {} } };

    // Act
    const { flows: out, paths, diagnostics } = flatten(flows);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(out).toEqual({
      next: {
        build: { step: 'build', on: { success: 'build.success', fail: 'stop' } },
        'build.success': { step: 'deploy', region: 'eu' },
        stop: {},
      },
    });
    expect(paths).toEqual({
      next: {
        build: ['flows', 'next', 'build'],
        'build.success': ['flows', 'next', 'build', 'on', 'success'],
        stop: ['flows', 'next', 'stop'],
      },
    });
  });

  test('nested inline entries flatten recursively, depth first after their parent', () => {
    // Arrange
    const flows = {
      next: {
        a: {
          on: {
            success: { step: 's1', on: { fail: { step: 's2', on: { true: 'z' } }, success: 'z' } },
            fail: { step: 's3' },
          },
        },
        z: {},
      },
    };

    // Act
    const { flows: out, paths, diagnostics } = flatten(flows);

    // Assert
    expect(diagnostics).toEqual([]);
    const flow = out.next as Record<string, unknown>;
    expect(Object.keys(flow)).toEqual(['a', 'a.success', 'a.success.fail', 'a.fail', 'z']);
    expect(flow).toEqual({
      a: { on: { success: 'a.success', fail: 'a.fail' } },
      'a.success': { step: 's1', on: { fail: 'a.success.fail', success: 'z' } },
      'a.success.fail': { step: 's2', on: { true: 'z' } },
      'a.fail': { step: 's3' },
      z: {},
    });
    expect(pathToString(paths.next?.['a.success.fail'] ?? [])).toBe('flows.next.a.on.success.on.fail');
  });

  test('an inline entry with step undefined is not lifted (control)', () => {
    const { flows } = flatten({ next: { a: { on: { success: { step: undefined, note: 1 } } } } });
    expect(flows).toEqual({ next: { a: { on: { success: { step: undefined, note: 1 } } } } });
  });
});

describe('edge objects', () => {
  test('an edge object becomes { to, repeat } and repeat defaults to false', () => {
    const { flows, diagnostics } = flatten({ next: { a: { on: { success: { to: 'b' }, fail: { to: 'a', repeat: true } } }, b: {} } });
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual({ next: { a: { on: { success: { to: 'b', repeat: false }, fail: { to: 'a', repeat: true } } }, b: {} } });
  });

  test('a numeric repeat is kept, any other repeat and any extra key are dropped', () => {
    const { flows } = flatten({ next: { a: { on: { x: { to: 'a', repeat: 3 }, y: { to: 'a', repeat: 'yes', onTrue: 'odd' } } } } });
    expect(flows).toEqual({ next: { a: { on: { x: { to: 'a', repeat: 3 }, y: { to: 'a', repeat: false } } } } });
  });

  test('edge objects inside inline entries are rewritten too', () => {
    const { flows } = flatten({ next: { a: { on: { success: { step: 's', on: { fail: { to: 'a', repeat: true } } } } } } });
    expect(flows).toEqual({
      next: { a: { on: { success: 'a.success' } }, 'a.success': { step: 's', on: { fail: { to: 'a', repeat: true } } } },
    });
  });

  test('an object with neither step nor a string to passes through unchanged', () => {
    const odd = { to: 5, repeat: true };
    const { flows } = flatten({ next: { a: { on: { success: odd, fail: 7 } } } });
    expect(flows).toEqual({ next: { a: { on: { success: { to: 5, repeat: true }, fail: 7 } } } });
  });
});

describe('generated id already taken', () => {
  test('a generated id equal to an id written in the flow is duplicate-key at the handler path', () => {
    // Arrange
    const flows = { next: { a: { on: { success: { step: 'x', on: { fail: { step: 'y' } } }, fail: 'b' } }, 'a.success': { step: 'z' }, b: {} } };

    // Act
    const { flows: out, paths, diagnostics } = flatten(flows);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'error', code: 'duplicate-key', path: ['flows', 'next', 'a', 'on', 'success'] });
    expect(diagnostics[0]?.message).toContain('"a.success"');
    expect(out).toEqual({ next: { a: { on: { fail: 'b' } }, 'a.success': { step: 'z' }, b: {} } });
    expect(paths.next?.['a.success']).toEqual(['flows', 'next', 'a.success']);
  });

  test('of two generated ids that collide, the first kept wins', () => {
    const { flows, diagnostics } = flatten({
      next: { a: { on: { 'b.c': { step: 'first' } } }, 'a.b': { on: { c: { step: 'second' } } } },
    });
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([['flows', 'next', 'a.b', 'on', 'c']]);
    expect(flows).toEqual({ next: { a: { on: { 'b.c': 'a.b.c' } }, 'a.b.c': { step: 'first' }, 'a.b': { on: {} } } });
  });

  test('the same outcome name under different parents does not collide (control)', () => {
    const { diagnostics } = flatten({ next: { a: { on: { success: { step: 's' } } }, b: { on: { success: { step: 's' } } } } });
    expect(diagnostics).toEqual([]);
  });

  test('ids are checked per flow', () => {
    const { diagnostics } = flatten({ one: { 'a.success': {} }, two: { a: { on: { success: { step: 's' } } } } });
    expect(diagnostics).toEqual([]);
  });
});

describe('pass-through', () => {
  test('reserved keys, non-object entries, non-map on and non-object flows pass through', () => {
    const flows = { next: { $start: 'a', $unattended: true, a: { on: 'odd' }, b: 'odd', c: { step: 's' } }, broken: 3 };
    const { flows: out, paths, diagnostics } = flatten(flows);
    expect(diagnostics).toEqual([]);
    expect(out).toEqual(flows);
    expect(paths).toEqual({ next: { a: ['flows', 'next', 'a'], c: ['flows', 'next', 'c'] } });
  });

  test('an empty flows map flattens to empty maps', () => {
    expect(flatten({})).toEqual({ flows: {}, paths: {}, diagnostics: [] });
  });

  test('the input is not mutated', () => {
    // Arrange
    const flows = { next: { a: { on: { success: { step: 's', on: { fail: { to: 'a' } } } } } } };
    const before = structuredClone(flows);

    // Act
    flatten(flows);

    // Assert
    expect(flows).toEqual(before);
  });

  test('an outcome named __proto__ stays an own key of on', () => {
    const on: Record<string, unknown> = JSON.parse('{"__proto__": {"step": "s"}}');
    const { flows } = flatten({ next: { a: { on } } });
    const flow = flows.next as Record<string, { on?: object }>;
    expect(Object.keys(flow.a?.on ?? {})).toEqual(['__proto__']);
    expect(Object.keys(flow)).toEqual(['a', 'a.__proto__']);
  });
});

describe('after normalise', () => {
  test('sugar inline entries reach flatten under on and keep the path of on.<outcome>', () => {
    // Arrange
    const normalised = normalise({ next: { a: { onSuccess: { step: 'deploy', onFail: { to: 'a', repeat: true } } } } });

    // Act
    const { flows, paths } = flatten(normalised.flows);

    // Assert
    expect(flows).toEqual({
      next: { a: { on: { success: 'a.success' } }, 'a.success': { step: 'deploy', on: { fail: { to: 'a', repeat: true } } } },
    });
    expect(paths.next?.['a.success']).toEqual(['flows', 'next', 'a', 'on', 'success']);
  });
});
