import type { BuildResult } from './build';
import type { StepRegistry } from './types';

import { describe, expect, test } from 'bun:test';

import { pathToString } from '../diagnostics';

import { build } from './build';
import { cycles } from './cycles';
import { flatten } from './flatten';
import { normalise } from './normalise';

const registry: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
  lint: { outcomes: ['success', 'fail'], pure: true },
  fix: { outcomes: ['success', 'fail'] },
  report: { outcomes: [] },
};

/** Run the pipeline up to build, as `resolveGraph` will. */
function built(flows: Record<string, unknown>): BuildResult {
  return build(flatten(normalise(flows).flows), registry);
}

/** The code and rendered path of each diagnostic, in order. */
function where(diagnostics: readonly { code: string; path: readonly string[] }[]): string[] {
  return diagnostics.map((diagnostic) => `${diagnostic.code} ${pathToString(diagnostic.path)}`);
}

describe('back edges', () => {
  test('a two-step loop is one cycle error at the handler that closes it', () => {
    // Arrange
    const result = built({ next: { build: { on: { success: 'test' } }, test: { on: { fail: 'build' } } } });

    // Act
    const diagnostics = cycles(result);

    // Assert
    expect(result.diagnostics).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'error', code: 'cycle', path: ['flows', 'next', 'test', 'on', 'fail'] });
  });

  test('the message names the closing edge and every id on the cycle', () => {
    // Arrange
    const result = built({
      next: {
        build: { on: { success: 'test' } },
        test: { on: { success: 'lint' } },
        lint: { on: { fail: 'build' } },
      },
    });

    // Act
    const [diagnostic] = cycles(result);

    // Assert
    expect(diagnostic?.message).toContain('lint → build');
    expect(diagnostic?.message).toContain('build → test → lint → build');
    expect(diagnostic?.message).toContain('repeat: true');
  });

  test('an edge from a step to itself is a cycle of one id', () => {
    const [diagnostic] = cycles(built({ next: { build: { on: { fail: 'build' } } } }));
    expect(diagnostic?.path).toEqual(['flows', 'next', 'build', 'on', 'fail']);
    expect(diagnostic?.message).toContain('the cycle is build → build.');
  });

  test('a chain and a diamond without a loop report nothing', () => {
    // Arrange
    const result = built({
      next: {
        build: { on: { success: 'test', fail: 'lint' } },
        test: { on: { success: 'report' } },
        lint: { on: { success: 'report' } },
        report: {},
      },
    });

    // Act / Assert
    expect(cycles(result)).toEqual([]);
  });

  test('three loops closing on different edges are three errors, in walk order', () => {
    // Arrange
    const result = built({
      next: {
        build: { on: { success: 'test', fail: 'build' } },
        test: { on: { fail: 'build', success: 'lint' } },
        lint: { on: { fail: 'test' } },
      },
    });

    // Act / Assert: `build` follows `success` before `fail`, so its self-loop is found last.
    expect(where(cycles(result))).toEqual([
      'cycle flows.next.test.on.fail',
      'cycle flows.next.lint.on.fail',
      'cycle flows.next.build.on.fail',
    ]);
  });

  test('the walk reaches a loop that no earlier node leads to', () => {
    // Arrange: `report` comes first and leads nowhere; the loop starts later.
    const result = built({ next: { report: {}, build: { on: { success: 'test' } }, test: { on: { fail: 'build' } } } });

    // Act / Assert
    expect(where(cycles(result))).toEqual(['cycle flows.next.test.on.fail']);
  });

  test('loops in two flows are each reported under their own flow', () => {
    const result = built({
      next: { build: { on: { fail: 'build' } } },
      main: { test: { on: { success: 'lint' } }, lint: { on: { fail: 'test' } } },
    });
    expect(where(cycles(result))).toEqual(['cycle flows.next.build.on.fail', 'cycle flows.main.lint.on.fail']);
  });
});

describe('the repeat exemption', () => {
  test('the same loop with repeat: true on the closing edge is accepted', () => {
    const result = built({ next: { build: { on: { success: 'test' } }, test: { on: { fail: { to: 'build', repeat: true } } } } });
    expect(result.diagnostics).toEqual([]);
    expect(cycles(result)).toEqual([]);
  });

  test('repeat: true on an edge that does not close the loop exempts nothing', () => {
    const result = built({ next: { build: { on: { success: { to: 'test', repeat: true } } }, test: { on: { fail: 'build' } } } });
    expect(where(cycles(result))).toEqual(['cycle flows.next.test.on.fail']);
  });

  test.each([
    ['a number', 3],
    ['false', false],
  ])('repeat as %s does not exempt the closing edge', (_label, repeat) => {
    const result = built({ next: { build: { on: { success: 'test' } }, test: { on: { fail: { to: 'build', repeat } } } } });
    expect(where(cycles(result))).toEqual(['cycle flows.next.test.on.fail']);
  });

  test('an edge object without repeat is not exempt', () => {
    const result = built({ next: { build: { on: { fail: { to: 'build' } } } } });
    expect(where(cycles(result))).toEqual(['cycle flows.next.build.on.fail']);
  });

  test('an exempt self-loop beside an unexempt one reports only the unexempt one', () => {
    const result = built({
      next: {
        build: { on: { fail: { to: 'build', repeat: true }, success: 'test' } },
        test: { on: { fail: 'test' } },
      },
    });
    expect(where(cycles(result))).toEqual(['cycle flows.next.test.on.fail']);
  });
});

describe('paths and hooks', () => {
  test('a loop closed inside an inline entry is reported where the host wrote it', () => {
    // Arrange
    const result = built({ next: { build: { on: { fail: { step: 'fix', on: { success: 'build' } } } } } });

    // Act
    const [diagnostic] = cycles(result);

    // Assert
    expect(result.diagnostics).toEqual([]);
    expect(pathToString(diagnostic?.path ?? [])).toBe('flows.next.build.on.fail.on.success');
    expect(diagnostic?.message).toContain('build.fail → build');
  });

  test('an edge to a registry-only step closes no loop through its implicit node', () => {
    const result = built({ next: { build: { on: { success: 'report' } } } });
    expect(result.sources['next.report']?.implicit).toBe(true);
    expect(cycles(result)).toEqual([]);
  });

  test('a when: hook adds no edge, so a hook pointing back closes no cycle', () => {
    // Arrange: `lint` is placed before `test`, and `test` leads to `lint`; only the hook points back.
    const result = built({ next: { test: { on: { success: 'lint' } }, lint: { when: 'before:test' } } });

    // Act / Assert
    expect(result.hooks).toHaveLength(1);
    expect(cycles(result)).toEqual([]);
  });

  test('an empty graph reports nothing', () => {
    expect(cycles(built({}))).toEqual([]);
  });

  test('a long chain closing on itself is walked without recursion', () => {
    // Arrange: 5000 entries in a line, the last one handing back to the first.
    const size = 5000;
    const flow = Object.fromEntries(
      Array.from({ length: size }, (_unused, index) => [
        `s${index}`,
        { step: 'build', on: { success: `s${(index + 1) % size}` } },
      ]),
    );

    // Act
    const diagnostics = cycles(built({ next: flow }));

    // Assert
    expect(where(diagnostics)).toEqual([`cycle flows.next.s${size - 1}.on.success`]);
  });
});
