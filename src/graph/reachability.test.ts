import type { BuildResult } from './build';
import type { StepRegistry } from './types';

import { describe, expect, test } from 'bun:test';

import { pathToString } from '../diagnostics';

import { build } from './build';
import { flatten } from './flatten';
import { normalise } from './normalise';
import { reachability } from './reachability';

const registry: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
  lint: { outcomes: ['success', 'fail'], pure: true },
  ask: { outcomes: ['yes', 'no'], interactive: true },
  report: { outcomes: [] },
};

/** Run the pipeline up to build, as `resolveGraph` will. */
function built(flows: Record<string, unknown>): BuildResult {
  return build(flatten(normalise(flows).flows), registry);
}

/** The level, code and rendered path of each diagnostic, in order. */
function where(diagnostics: readonly { level: string; code: string; path: readonly string[] }[]): string[] {
  return diagnostics.map((diagnostic) => `${diagnostic.level} ${diagnostic.code} ${pathToString(diagnostic.path)}`);
}

describe('unreachable', () => {
  test('a chain walked from its first entry reports nothing', () => {
    // Arrange
    const result = built({ next: { build: { on: { success: 'test' } }, test: { on: { fail: 'report' } }, report: {} } });

    // Act
    const diagnostics = reachability(result);

    // Assert
    expect(result.diagnostics).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  test('an entry no edge leads to is one warning at the entry, naming the flow start', () => {
    // Arrange
    const result = built({ next: { build: { on: { success: 'test' } }, test: {}, lint: {} } });

    // Act
    const diagnostics = reachability(result);

    // Assert
    expect(where(diagnostics)).toEqual(['warn unreachable flows.next.lint']);
    expect(diagnostics[0]?.message).toContain('"lint"');
    expect(diagnostics[0]?.message).toContain('"build", the start of flow "next"');
  });

  test('$start moves the walk, so entries before it are unreachable', () => {
    const result = built({ next: { build: { on: { success: 'test' } }, test: {}, $start: 'test' } });
    expect(where(reachability(result))).toEqual(['warn unreachable flows.next.build']);
  });

  test('an entry reached only from an unreachable entry is unreachable too', () => {
    const result = built({ next: { build: {}, test: { on: { success: 'lint' } }, lint: {} } });
    expect(where(reachability(result))).toEqual(['warn unreachable flows.next.test', 'warn unreachable flows.next.lint']);
  });

  test('every outcome and a repeat edge are followed', () => {
    const result = built({
      next: {
        build: { on: { success: 'test', fail: 'lint' } },
        test: { on: { fail: { to: 'build', repeat: true }, success: 'report' } },
        lint: {},
        report: {},
      },
    });
    expect(reachability(result)).toEqual([]);
  });

  test('a lifted inline entry off an unreachable entry is reported where the host wrote it', () => {
    // Arrange
    const result = built({ next: { build: {}, test: { on: { fail: { step: 'lint' } } } } });

    // Act / Assert
    expect(result.diagnostics).toEqual([]);
    expect(where(reachability(result))).toEqual([
      'warn unreachable flows.next.test',
      'warn unreachable flows.next.test.on.fail',
    ]);
  });

  test('an implicit node off an unreachable entry is not an entry and is not reported', () => {
    // Arrange: `report` has no entry, so build makes it an implicit node.
    const result = built({ next: { build: {}, test: { on: { success: 'report' } } } });

    // Act / Assert
    expect(result.sources['next.report']?.implicit).toBe(true);
    expect(where(reachability(result))).toEqual(['warn unreachable flows.next.test']);
  });

  test('flows are walked apart: a step id reached in one flow is not reached in another', () => {
    const result = built({
      next: { build: { on: { success: 'test' } }, test: {} },
      main: { build: {}, test: {} },
    });
    expect(where(reachability(result))).toEqual(['warn unreachable flows.main.test']);
  });

  test('a flow whose $start names nothing is not walked, beside the unknown-step build reports', () => {
    // Arrange
    const result = built({ next: { build: {}, test: {}, $start: 'missing' } });

    // Act / Assert
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unknown-step']);
    expect(reachability(result)).toEqual([]);
  });

  test('an empty flows map and an empty flow report nothing', () => {
    expect(reachability(built({}))).toEqual([]);
    expect(reachability(built({ next: {} }))).toEqual([]);
  });
});

describe('when: hooks', () => {
  test('a hook is reachable when its anchor is', () => {
    const result = built({ next: { build: { on: { success: 'test' } }, test: {}, lint: { when: 'before:test' } } });
    expect(result.graph.hooks).toHaveLength(1);
    expect(reachability(result)).toEqual([]);
  });

  test('the walk goes on from a reached hook along its own edges', () => {
    const result = built({
      next: { build: {}, lint: { when: 'after:build', on: { fail: 'report' } }, report: {} },
    });
    expect(reachability(result)).toEqual([]);
  });

  test('a hook on an unreachable anchor is unreachable', () => {
    const result = built({ next: { build: {}, test: {}, lint: { when: 'after:test' } } });
    expect(where(reachability(result))).toEqual(['warn unreachable flows.next.test', 'warn unreachable flows.next.lint']);
  });

  test('a hook does not make its anchor reachable', () => {
    // Arrange: `lint` is reached by an edge and anchors on `test`; nothing leads to `test`.
    const result = built({ next: { build: { on: { success: 'lint' } }, lint: { when: 'before:test' }, test: {} } });

    // Act / Assert
    expect(where(reachability(result))).toEqual(['warn unreachable flows.next.test']);
  });
});

describe('interactive-unattended', () => {
  test('an interactive step reached in an $unattended flow is one error at the entry', () => {
    // Arrange
    const result = built({ next: { $unattended: true, build: { on: { fail: 'ask' } }, ask: {} } });

    // Act
    const diagnostics = reachability(result);

    // Assert
    expect(where(diagnostics)).toEqual(['error interactive-unattended flows.next.ask']);
    expect(diagnostics[0]?.message).toContain('step "ask" is interactive');
    expect(diagnostics[0]?.message).toContain('`$unattended`');
  });

  test('the same flow without $unattended accepts the interactive step', () => {
    const result = built({ next: { build: { on: { fail: 'ask' } }, ask: {} } });
    expect(reachability(result)).toEqual([]);
  });

  test('$unattended: false and a non-boolean $unattended do not mark the flow', () => {
    expect(reachability(built({ next: { $unattended: false, ask: {} } }))).toEqual([]);
    expect(reachability(built({ next: { $unattended: 'yes', ask: {} } }))).toEqual([]);
  });

  test('an unreachable interactive step in an $unattended flow is only a warning', () => {
    const result = built({ next: { $unattended: true, build: {}, ask: {} } });
    expect(where(reachability(result))).toEqual(['warn unreachable flows.next.ask']);
  });

  test('an interactive start step is reached', () => {
    const result = built({ next: { $unattended: true, ask: { on: { yes: 'build' } }, build: {} } });
    expect(where(reachability(result))).toEqual(['error interactive-unattended flows.next.ask']);
  });

  test('an interactive implicit node is reported at the handler that named it', () => {
    // Arrange: `ask` has no entry, so build makes it an implicit node at its first reference.
    const result = built({ next: { $unattended: true, build: { on: { fail: 'ask' } } } });

    // Act / Assert
    expect(result.sources['next.ask']?.implicit).toBe(true);
    expect(where(reachability(result))).toEqual(['error interactive-unattended flows.next.build.on.fail']);
  });

  test('an interactive inline entry and an interactive hook are reported where the host wrote them', () => {
    const result = built({
      next: {
        $unattended: true,
        build: { on: { fail: { step: 'ask' } } },
        prompt: { step: 'ask', when: 'before:build' },
      },
    });
    expect(where(reachability(result)).sort()).toEqual([
      'error interactive-unattended flows.next.build.on.fail',
      'error interactive-unattended flows.next.prompt',
    ]);
  });

  test('two flows each report their own warning and error in flow order', () => {
    const result = built({
      next: { $unattended: true, build: { on: { success: 'ask' } }, ask: {}, lint: {} },
      main: { ask: {}, report: {} },
    });
    expect(where(reachability(result))).toEqual([
      'error interactive-unattended flows.next.ask',
      'warn unreachable flows.next.lint',
      'warn unreachable flows.main.report',
    ]);
  });
});

describe('walk shape', () => {
  test('a long chain is walked without recursion', () => {
    // Arrange: 5000 entries in a line, then one entry nothing leads to.
    const size = 5000;
    const flow = Object.fromEntries(
      Array.from({ length: size }, (_unused, index) => [
        `s${index}`,
        { step: 'build', on: { success: index + 1 < size
          ? `s${index + 1}`
          : 'report' } },
      ]),
    );

    // Act
    const diagnostics = reachability(built({ next: { ...flow, report: {}, stray: { step: 'lint' } } }));

    // Assert
    expect(where(diagnostics)).toEqual(['warn unreachable flows.next.stray']);
  });
});
