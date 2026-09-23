import type { StepRegistry } from './types';

import { describe, expect, test } from 'bun:test';

import { pathToString } from '../diagnostics';

import { build, nodeKey } from './build';
import { flatten } from './flatten';
import { normalise } from './normalise';

const registry: StepRegistry = {
  build: { outcomes: ['success', 'fail'], required: true },
  test: { outcomes: ['success', 'fail'] },
  lint: { outcomes: ['success', 'fail'], pure: true },
  ask: { outcomes: ['yes', 'no'], interactive: true },
  report: { outcomes: [] },
};

/** Run the pipeline up to build, as `resolveGraph` will. */
function run(flows: Record<string, unknown>, steps: StepRegistry = registry): ReturnType<typeof build> {
  return build(flatten(normalise(flows).flows), steps);
}

/** The rendered path and code of each diagnostic, in order. */
function where(result: ReturnType<typeof build>): string[] {
  return result.diagnostics.map((diagnostic) => `${diagnostic.code} ${pathToString(diagnostic.path)}`);
}

describe('nodes and edges', () => {
  test('a step entry becomes a node carrying its registry flags, options and expect', () => {
    // Arrange
    const flows = { main: { build: { expect: 'success', target: 'dist', on: { success: 'test' } }, test: { step: 'test' } } };

    // Act
    const result = run(flows);

    // Assert
    expect(result.diagnostics).toEqual([]);
    expect(result.graph.nodes).toEqual({
      'main.build': {
        id: 'build',
        flow: 'main',
        step: 'build',
        outcomes: ['success', 'fail'],
        expect: 'success',
        options: { target: 'dist' },
        required: true,
        pure: false,
        interactive: false,
      },
      'main.test': {
        id: 'test',
        flow: 'main',
        step: 'test',
        outcomes: ['success', 'fail'],
        options: {},
        required: false,
        pure: false,
        interactive: false,
      },
    });
  });

  test('an entry whose step differs from its id runs that step', () => {
    const result = run({ main: { check: { step: 'ask' } } });
    expect(result.graph.nodes['main.check']).toMatchObject({ id: 'check', step: 'ask', outcomes: ['yes', 'no'], interactive: true });
  });

  test('edges carry from, outcome, to and repeat, in declaration order', () => {
    // Arrange
    const flows = {
      main: {
        build: { on: { success: 'test', fail: { to: 'build', repeat: true } } },
        test: { on: { fail: { to: 'build', repeat: 2 }, success: { to: 'lint' } } },
        lint: {},
      },
    };

    // Act
    const { graph, diagnostics } = run(flows);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(graph.edges).toEqual([
      { from: 'main.build', outcome: 'success', to: 'main.test', repeat: false },
      { from: 'main.build', outcome: 'fail', to: 'main.build', repeat: true },
      { from: 'main.test', outcome: 'fail', to: 'main.build', repeat: 2 },
      { from: 'main.test', outcome: 'success', to: 'main.lint', repeat: false },
    ]);
  });

  test('sugar handlers become edges on their outcome', () => {
    const { graph } = run({ main: { build: { onSuccess: 'test', onFail: 'report' }, test: {}, report: {} } });
    expect(graph.edges.map((edge) => `${edge.from} ${edge.outcome} ${edge.to}`)).toEqual([
      'main.build success main.test',
      'main.build fail main.report',
    ]);
  });

  test('each flow gets a summary; the start defaults to the first step entry', () => {
    // Arrange
    const flows = { main: { build: { on: { success: 'test' } }, test: {} }, ci: { $unattended: true, lint: {} } };

    // Act
    const { graph } = run(flows);

    // Assert
    expect(graph.flows).toEqual({
      main: { name: 'main', start: 'main.build', unattended: false, nodes: ['main.build', 'main.test'] },
      ci: { name: 'ci', start: 'ci.lint', unattended: true, nodes: ['ci.lint'] },
    });
  });

  test('$unattended counts only when it is true', () => {
    const { graph } = run({ main: { $unattended: 'yes', lint: {} } });
    expect(graph.flows.main?.unattended).toBe(false);
  });

  test('the same id in two flows gives two nodes', () => {
    const { graph } = run({ a: { lint: {} }, b: { lint: {} } });
    expect(Object.keys(graph.nodes)).toEqual(['a.lint', 'b.lint']);
  });

  test('sources name the path each entry was written at', () => {
    const { sources } = run({ main: { build: { on: { success: { step: 'test' } } } } });
    expect(sources).toEqual({
      'main.build': { path: ['flows', 'main', 'build'], implicit: false },
      'main["build.success"]': { path: ['flows', 'main', 'build', 'on', 'success'], implicit: false },
    });
  });
});

describe('nodeKey', () => {
  test('dot-joins a plain flow and id, and brackets an id holding a dot', () => {
    expect(nodeKey('main', 'build')).toBe('main.build');
    expect(nodeKey('main', 'a.b')).toBe('main["a.b"]');
  });

  test('two pairs that dot-join alike get different keys', () => {
    expect(nodeKey('a.b', 'c')).not.toBe(nodeKey('a', 'b.c'));
  });
});

describe('$start', () => {
  test('names the step entry the flow starts at', () => {
    const { graph, diagnostics } = run({ main: { $start: 'test', build: {}, test: {} } });
    expect(diagnostics).toEqual([]);
    expect(graph.flows.main?.start).toBe('main.test');
  });

  test('naming a registered step with no entry makes an implicit node', () => {
    const { graph, sources, diagnostics } = run({ main: { $start: 'lint' } });
    expect(diagnostics).toEqual([]);
    expect(graph.flows.main).toEqual({ name: 'main', start: 'main.lint', unattended: false, nodes: ['main.lint'] });
    expect(sources['main.lint']).toEqual({ path: ['flows', 'main', '$start'], implicit: true });
  });

  test('naming nothing is unknown-step at $start, and the start is empty', () => {
    const result = run({ main: { $start: 'nope', build: {} } });
    expect(where(result)).toEqual(['unknown-step flows.main.$start']);
    expect(result.diagnostics[0]?.level).toBe('error');
    expect(result.graph.flows.main?.start).toBe('');
  });

  test('a flow with no entries and no $start starts nowhere', () => {
    const { graph, diagnostics } = run({ main: {} });
    expect(diagnostics).toEqual([]);
    expect(graph.flows.main).toEqual({ name: 'main', start: '', unattended: false, nodes: [] });
  });
});

describe('implicit nodes', () => {
  test('a handler target that is registered but has no entry becomes one node, made once', () => {
    // Arrange
    const flows = { main: { build: { on: { success: 'lint', fail: 'lint' } }, test: { on: { success: 'lint' } } } };

    // Act
    const { graph, sources, diagnostics } = run(flows);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(graph.flows.main?.nodes).toEqual(['main.build', 'main.test', 'main.lint']);
    expect(graph.nodes['main.lint']).toEqual({
      id: 'lint',
      flow: 'main',
      step: 'lint',
      outcomes: ['success', 'fail'],
      options: {},
      required: false,
      pure: true,
      interactive: false,
    });
    expect(sources['main.lint']).toEqual({ path: ['flows', 'main', 'build', 'on', 'success'], implicit: true });
    expect(graph.edges.filter((edge) => edge.to === 'main.lint')).toHaveLength(3);
  });

  test('an entry with the target id wins over the registry step of that name', () => {
    const { graph, sources } = run({ main: { build: { on: { success: 'lint' } }, lint: { step: 'test' } } });
    expect(graph.nodes['main.lint']?.step).toBe('test');
    expect(sources['main.lint']?.implicit).toBe(false);
  });
});

describe('unknown-step', () => {
  test('a handler target in neither the flow nor the registry is refused at the handler, with no edge', () => {
    // Arrange
    const flows = { next: { build: { on: { success: 'deploy' } } } };

    // Act
    const result = run(flows);

    // Assert
    expect(where(result)).toEqual(['unknown-step flows.next.build.on.success']);
    expect(result.diagnostics[0]?.message).toContain('"deploy"');
    expect(result.graph.edges).toEqual([]);
    expect(Object.keys(result.graph.nodes)).toEqual(['next.build']);
  });

  test('an id of another flow does not resolve', () => {
    const result = run({ a: { build: { on: { success: 'only' } } }, b: { only: { step: 'lint' } } });
    expect(where(result)).toEqual(['unknown-step flows.a.build.on.success']);
  });

  test('a target naming an inherited property of the registry is unknown', () => {
    const result = run({ main: { build: { on: { success: 'toString' } } } });
    expect(where(result)).toEqual(['unknown-step flows.main.build.on.success']);
  });

  test('a registered step is known (control)', () => {
    expect(run({ main: { build: { on: { success: 'test' } } } }).diagnostics).toEqual([]);
  });

  test('an entry running an unregistered step is refused at the entry, or at step when it names one', () => {
    const result = run({ main: { deploy: {}, ship: { step: 'deploy' }, odd: { step: 42 } } });
    expect(where(result)).toEqual([
      'unknown-step flows.main.deploy',
      'unknown-step flows.main.ship.step',
      'unknown-step flows.main.odd.step',
    ]);
    expect(result.graph.nodes['main.ship']).toMatchObject({ step: 'deploy', outcomes: [] });
  });

  test('an entry on an unknown step is not also checked for outcomes, expect or when', () => {
    // Arrange
    const flows = { main: { deploy: { expect: 'done', when: 'after:build', on: { done: 'build' } }, build: {} } };

    // Act
    const result = run(flows);

    // Assert
    expect(where(result)).toEqual(['unknown-step flows.main.deploy']);
    expect(result.graph.edges).toEqual([{ from: 'main.deploy', outcome: 'done', to: 'main.build', repeat: false }]);
    expect(result.hooks).toEqual([{ flow: 'main', node: 'main.deploy', anchor: 'main.build', position: 'after' }]);
  });

  test('a non-string step is unknown even when the entry id is a registered step', () => {
    const result = run({ main: { build: { step: 42, expect: 'nope', when: 'after:test' }, test: {} } });
    expect(where(result)).toEqual(['unknown-step flows.main.build.step']);
    expect(result.graph.nodes['main.build']?.outcomes).toEqual([]);
  });
});

describe('unknown-outcome', () => {
  test('a handler on an outcome the step does not declare is refused at flows.<flow>.<id>.on.<outcome>', () => {
    // Arrange
    const flows = { next: { build: { on: { passed: 'test' } }, test: {} } };

    // Act
    const result = run(flows);

    // Assert
    expect(where(result)).toEqual(['unknown-outcome flows.next.build.on.passed']);
    expect(result.diagnostics[0]).toMatchObject({ level: 'error', path: ['flows', 'next', 'build', 'on', 'passed'] });
    expect(result.diagnostics[0]?.message).toContain('"success", "fail"');
    expect(result.graph.edges).toEqual([{ from: 'next.build', outcome: 'passed', to: 'next.test', repeat: false }]);
  });

  test('sugar naming an undeclared outcome is refused at on.<outcome>', () => {
    const result = run({ next: { check: { step: 'ask', onTrue: 'check' } } });
    expect(where(result)).toEqual(['unknown-outcome flows.next.check.on.true']);
  });

  test('a declared outcome is accepted (control)', () => {
    expect(run({ next: { check: { step: 'ask', onChoice: { yes: 'check', no: 'check' } } } }).diagnostics).toEqual([]);
  });

  test('an expect naming an undeclared outcome is refused at expect', () => {
    const result = run({ next: { build: { expect: 'passed' }, test: { expect: 'fail' } } });
    expect(where(result)).toEqual(['unknown-outcome flows.next.build.expect']);
  });

  test('a step declaring no outcomes refuses every handler', () => {
    const result = run({ next: { report: { on: { success: 'report' } } } });
    expect(where(result)).toEqual(['unknown-outcome flows.next.report.on.success']);
    expect(result.diagnostics[0]?.message).toContain('declares none');
  });

  test('an outcome inside an inline entry is reported where the host wrote it', () => {
    const result = run({ next: { build: { on: { success: { step: 'test', on: { passed: 'build' } } } } } });
    expect(where(result)).toEqual(['unknown-outcome flows.next.build.on.success.on.passed']);
  });
});

describe('impure-when and hooks', () => {
  test('a when on a step that is not pure is refused at when', () => {
    // Arrange
    const flows = { next: { build: {}, test: { when: 'after:build' } } };

    // Act
    const result = run(flows);

    // Assert
    expect(where(result)).toEqual(['impure-when flows.next.test.when']);
    expect(result.diagnostics[0]).toMatchObject({ level: 'error', path: ['flows', 'next', 'test', 'when'] });
  });

  test('a when on a pure step is accepted and becomes a hook, not an edge (control)', () => {
    const result = run({ next: { build: {}, lint: { when: 'before:build' } } });
    expect(result.diagnostics).toEqual([]);
    expect(result.hooks).toEqual([{ flow: 'next', node: 'next.lint', anchor: 'next.build', position: 'before' }]);
    expect(result.graph.edges).toEqual([]);
  });

  test('a when anchor that exists nowhere is unknown-step at when', () => {
    const result = run({ next: { lint: { when: 'after:deploy' } } });
    expect(where(result)).toEqual(['unknown-step flows.next.lint.when']);
    expect(result.hooks).toEqual([]);
  });

  test('a when anchor naming a registered step with no entry makes an implicit node', () => {
    const { hooks, sources, diagnostics } = run({ next: { lint: { when: 'after:build' } } });
    expect(diagnostics).toEqual([]);
    expect(hooks).toEqual([{ flow: 'next', node: 'next.lint', anchor: 'next.build', position: 'after' }]);
    expect(sources['next.build']).toEqual({ path: ['flows', 'next', 'lint', 'when'], implicit: true });
  });

  test('an impure step with an unknown anchor gets both errors', () => {
    const result = run({ next: { test: { when: 'after:deploy' } } });
    expect(where(result)).toEqual(['impure-when flows.next.test.when', 'unknown-step flows.next.test.when']);
  });

  test('a when of another shape is still impure-when but builds no hook', () => {
    const result = run({ next: { build: {}, test: { when: 'during:build' }, lint: { when: 7 } } });
    expect(where(result)).toEqual(['impure-when flows.next.test.when']);
    expect(result.hooks).toEqual([]);
  });

  test('a when inside an inline entry is reported where the host wrote it', () => {
    const result = run({ next: { build: { on: { success: { step: 'test', when: 'after:build' } } } } });
    expect(where(result)).toEqual(['impure-when flows.next.build.on.success.when']);
  });
});

describe('shapes left to the host schema', () => {
  test('a flow that is not a plain object, a non-map on and a non-target handler build nothing', () => {
    // Arrange
    const flows = { broken: 'nope', main: { build: { on: 'test' }, test: { on: { success: 42, fail: ['x'] } }, note: 'text' } };

    // Act
    const { graph, diagnostics } = run(flows);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(Object.keys(graph.flows)).toEqual(['main']);
    expect(Object.keys(graph.nodes)).toEqual(['main.build', 'main.test']);
    expect(graph.edges).toEqual([]);
  });
});

describe('purity', () => {
  test('build leaves its input and the registry as they were', () => {
    // Arrange
    const flows = { main: { build: { on: { success: 'lint', fail: { to: 'build', repeat: true } } }, lint: { when: 'after:build' } } };
    const flat = flatten(normalise(flows).flows);
    const before = structuredClone(flat);
    const steps = structuredClone(registry);

    // Act
    const { graph } = build(flat, steps);

    // Assert
    expect(flat).toEqual(before);
    expect(steps).toEqual(registry);
    expect(graph.nodes['main.build']?.outcomes).not.toBe(steps.build?.outcomes);
  });
});
