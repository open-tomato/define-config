import { describe, expect, test } from 'bun:test';

import { pathToString } from '../diagnostics';

import { normalise } from './normalise';

describe('sugar folds into on', () => {
  test('onTrue and onFalse become outcomes true and false', () => {
    // Arrange
    const flows = { next: { check: { step: 'gate', onTrue: 'ship', onFalse: 'fix', retries: 2 } } };

    // Act
    const { flows: out, diagnostics } = normalise(flows);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(out).toEqual({ next: { check: { step: 'gate', retries: 2, on: { true: 'ship', false: 'fix' } } } });
  });

  test('onSuccess and onFail become outcomes success and fail', () => {
    const { flows, diagnostics } = normalise({ next: { build: { onSuccess: 'test', onFail: { to: 'build', repeat: 2 } } } });
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual({ next: { build: { on: { success: 'test', fail: { to: 'build', repeat: 2 } } } } });
  });

  test('onChoice spreads each of its keys into on', () => {
    const { flows, diagnostics } = normalise({ next: { ask: { onChoice: { yes: 'go', no: 'stop' }, onFail: 'abort' } } });
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual({ next: { ask: { on: { yes: 'go', no: 'stop', fail: 'abort' } } } });
  });

  test('an entry with only on is kept with its handlers', () => {
    const { flows, diagnostics } = normalise({ next: { a: { step: 's', on: { success: 'b' } }, b: {} } });
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual({ next: { a: { step: 's', on: { success: 'b' } }, b: {} } });
  });

  test('a sugar key set to undefined counts as absent', () => {
    const { flows, diagnostics } = normalise({ next: { a: { on: { success: 'b' }, onTrue: undefined } } });
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual({ next: { a: { on: { success: 'b' } } } });
  });

  test('reserved flow keys and non-object values pass through', () => {
    const flows = { next: { $start: 'a', $unattended: true, a: { onTrue: 'b' }, b: 'odd' }, broken: 'not a flow' };
    const { flows: out, diagnostics } = normalise(flows);
    expect(diagnostics).toEqual([]);
    expect(out).toEqual({
      next: { $start: 'a', $unattended: true, a: { on: { true: 'b' } }, b: 'odd' },
      broken: 'not a flow',
    });
  });

  test('an empty flows map normalises to an empty map', () => {
    expect(normalise({})).toEqual({ flows: {}, diagnostics: [] });
  });
});

describe('handler-conflict', () => {
  test('on beside a sugar key is an error at the entry path and drops every handler', () => {
    // Arrange
    const flows = { next: { check: { step: 'gate', on: { true: 'a' }, onFalse: 'b', note: 'x' } } };

    // Act
    const { flows: out, diagnostics } = normalise(flows);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'error', code: 'handler-conflict', path: ['flows', 'next', 'check'] });
    expect(diagnostics[0]?.message).toContain('`onFalse`');
    expect(pathToString(diagnostics[0]?.path ?? [])).toBe('flows.next.check');
    expect(out).toEqual({ next: { check: { step: 'gate', note: 'x' } } });
  });

  test('on beside sugar conflicts even when they name different outcomes', () => {
    const { diagnostics } = normalise({ next: { a: { on: { fail: 'x' }, onSuccess: 'y' } } });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['handler-conflict']);
  });

  test('on beside an empty onChoice still conflicts', () => {
    const { diagnostics } = normalise({ next: { a: { on: { yes: 'x' }, onChoice: {} } } });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['handler-conflict']);
  });

  test('two sugar keys naming one outcome conflict and name both keys', () => {
    // Arrange
    const flows = { next: { ask: { onTrue: 'a', onChoice: { true: 'b', other: 'c' } } } };

    // Act
    const { flows: out, diagnostics } = normalise(flows);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'handler-conflict', path: ['flows', 'next', 'ask'] });
    expect(diagnostics[0]?.message).toContain('`onTrue` and `onChoice.true` both name outcome "true"');
    expect(out).toEqual({ next: { ask: {} } });
  });

  test('distinct sugar outcomes do not conflict (control)', () => {
    const { diagnostics } = normalise({ next: { ask: { onTrue: 'a', onChoice: { maybe: 'b' } } } });
    expect(diagnostics).toEqual([]);
  });

  test('one diagnostic per conflicting entry, in declaration order, other entries untouched', () => {
    const { flows, diagnostics } = normalise({
      one: { a: { on: {}, onFail: 'x' }, b: { onFail: 'c' } },
      two: { z: { onSuccess: 'x', onChoice: { success: 'y', fail: 'w' }, onFail: 'v' } },
    });
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([['flows', 'one', 'a'], ['flows', 'two', 'z']]);
    expect(diagnostics[1]?.message).toContain('"success"');
    expect(diagnostics[1]?.message).toContain('"fail"');
    expect(flows).toEqual({ one: { a: {}, b: { on: { fail: 'c' } } }, two: { z: {} } });
  });
});

describe('inline entries', () => {
  test('an inline entry under sugar is normalised too', () => {
    const { flows, diagnostics } = normalise({ next: { a: { onSuccess: { step: 'deploy', onFail: 'rollback' } } } });
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual({ next: { a: { on: { success: { step: 'deploy', on: { fail: 'rollback' } } } } } });
  });

  test('an inline entry under on is normalised too', () => {
    const { flows } = normalise({ next: { a: { on: { success: { step: 'deploy', onTrue: 'b' } } } } });
    expect(flows).toEqual({ next: { a: { on: { success: { step: 'deploy', on: { true: 'b' } } } } } });
  });

  test('a conflict in an inline entry is reported at the key it was written under', () => {
    const { flows, diagnostics } = normalise({
      next: {
        a: { onChoice: { go: { step: 'deploy', on: { fail: 'x' }, onFail: 'y' } } },
        b: { on: { success: { step: 's', onTrue: 'p', onChoice: { true: 'q' } } } },
      },
    });
    expect(diagnostics.map((diagnostic) => pathToString(diagnostic.path))).toEqual([
      'flows.next.a.onChoice.go',
      'flows.next.b.on.success',
    ]);
    expect(flows).toEqual({
      next: { a: { on: { go: { step: 'deploy' } } }, b: { on: { success: { step: 's' } } } },
    });
  });

  test('an edge object without step is not treated as an inline entry', () => {
    const edge = { to: 'a', repeat: 1, onTrue: 'odd' };
    const { flows, diagnostics } = normalise({ next: { a: { onFail: edge } } });
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual({ next: { a: { on: { fail: { to: 'a', repeat: 1, onTrue: 'odd' } } } } });
  });
});

describe('immutability and safety', () => {
  test('the input is not mutated', () => {
    // Arrange
    const flows = { next: { a: { onTrue: 'b', on: undefined }, c: { on: { x: { step: 's', onFail: 'd' } } } } };
    const before = structuredClone(flows);

    // Act
    normalise(flows);

    // Assert
    expect(flows).toEqual(before);
  });

  test('an onChoice key named __proto__ becomes an own outcome, not a prototype', () => {
    const choice: Record<string, unknown> = JSON.parse('{"__proto__": "x"}');
    const { flows } = normalise({ next: { a: { onChoice: choice } } });
    const on = (flows.next as { a: { on: object } }).a.on;
    expect(Object.getPrototypeOf(on)).toBe(Object.prototype);
    expect(Object.keys(on)).toEqual(['__proto__']);
  });

  test('a non-map onChoice contributes no outcome and passes through', () => {
    const { flows, diagnostics } = normalise({ next: { a: { onChoice: 'b' } } });
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual({ next: { a: { onChoice: 'b' } } });
  });
});
