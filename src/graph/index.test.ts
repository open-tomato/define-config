import type { Flows, StepRegistry } from './types';

import { describe, expect, test } from 'bun:test';

import { pathToString } from '../diagnostics';

import { build } from './build';
import { flatten } from './flatten';
import { normalise } from './normalise';

import { resolveGraph } from './index';

const registry: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
  lint: { outcomes: ['success', 'fail'], pure: true },
  ask: { outcomes: ['yes', 'no'], interactive: true },
};

/** The level, code and rendered path of each diagnostic, in order. */
function where(diagnostics: readonly { level: string; code: string; path: readonly string[] }[]): string[] {
  return diagnostics.map((diagnostic) => `${diagnostic.level} ${diagnostic.code} ${pathToString(diagnostic.path)}`);
}

describe('resolveGraph over an empty flows map', () => {
  test('gives an empty graph and no diagnostics', () => {
    // Arrange
    const flows = {};

    // Act
    const result = resolveGraph(flows, registry);

    // Assert
    expect(result).toEqual({ graph: { nodes: {}, edges: [], hooks: [], flows: {} }, diagnostics: [] });
  });

  test('gives an empty graph with an empty registry too', () => {
    expect(resolveGraph({}, {})).toEqual({ graph: { nodes: {}, edges: [], hooks: [], flows: {} }, diagnostics: [] });
  });
});

describe('resolveGraph over a flow with only $start', () => {
  test('a $start naming a registered step starts the flow at an implicit node for it', () => {
    // Arrange
    const flows = { next: { $start: 'build' } };

    // Act
    const { graph, diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(graph.flows).toEqual({ next: { name: 'next', start: 'next.build', unattended: false, nodes: ['next.build'] } });
    expect(graph.nodes['next.build']).toMatchObject({ id: 'build', flow: 'next', step: 'build', options: {} });
    expect(graph.edges).toEqual([]);
  });

  test('a $start naming nothing is one unknown-step at $start and no unreachable warnings', () => {
    // Arrange
    const flows = { next: { $start: 'missing' } };

    // Act
    const { graph, diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(where(diagnostics)).toEqual(['error unknown-step flows.next.$start']);
    expect(graph.flows.next).toEqual({ name: 'next', start: '', unattended: false, nodes: [] });
  });

  test('an $unattended flow starting at a registered interactive step is interactive-unattended', () => {
    const { diagnostics } = resolveGraph({ next: { $start: 'ask', $unattended: true } }, registry);
    expect(where(diagnostics)).toEqual(['error interactive-unattended flows.next.$start']);
  });
});

describe('resolveGraph over a registry-only target', () => {
  test('a handler naming a registered step with no entry builds an edge to an implicit node', () => {
    // Arrange
    const flows = { next: { build: { onSuccess: 'lint' } } };

    // Act
    const { graph, diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(graph.edges).toEqual([{ from: 'next.build', outcome: 'success', to: 'next.lint', repeat: false }]);
    expect(graph.nodes['next.lint']).toMatchObject({ id: 'lint', step: 'lint', pure: true, options: {} });
    expect(graph.flows.next?.nodes).toEqual(['next.build', 'next.lint']);
  });

  test('an implicit node is never an unreachable entry, even hanging off one', () => {
    const { diagnostics } = resolveGraph({ next: { build: {}, test: { onFail: 'lint' } } }, registry);
    expect(where(diagnostics)).toEqual(['warn unreachable flows.next.test']);
  });

  test('a handler naming a step neither an entry nor the registry has is unknown-step at the handler', () => {
    // Control: the same flow as above with the target renamed, so the check could fail.
    const { graph, diagnostics } = resolveGraph({ next: { build: { onSuccess: 'deploy' } } }, registry);
    expect(where(diagnostics)).toEqual(['error unknown-step flows.next.build.on.success']);
    expect(graph.edges).toEqual([]);
  });
});

describe('resolveGraph wiring', () => {
  test('runs every step and reports in pipeline order', () => {
    // Arrange: one problem for each of normalise, build, cycles and reachability.
    const flows = {
      next: {
        build: { on: { success: 'test' } },
        test: { on: { success: 'lint', maybe: 'lint' } },
        lint: { on: { success: 'test' } },
        ask: { on: { yes: 'lint' }, onTrue: 'lint' },
      },
    };

    // Act
    const { diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(where(diagnostics)).toEqual([
      'error handler-conflict flows.next.ask',
      'error unknown-outcome flows.next.test.on.maybe',
      'error cycle flows.next.lint.on.success',
      'warn unreachable flows.next.ask',
    ]);
  });

  test('reports a flatten duplicate-key between normalise and build', () => {
    // The dropped inline entry takes its handler with it, so `a.success` is left unreached.
    const flows = { next: { a: { step: 'build', onSuccess: { step: 'test' } }, 'a.success': { step: 'test' } } };
    expect(where(resolveGraph(flows, registry).diagnostics)).toEqual([
      'error duplicate-key flows.next.a.on.success',
      'warn unreachable flows.next["a.success"]',
    ]);
  });

  test('a flows value typed as Flows is accepted and not mutated', () => {
    // Arrange
    const flows: Flows = { next: { build: { onSuccess: { to: 'test', repeat: true } }, test: {} } };
    const before = structuredClone(flows);

    // Act
    const { diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(flows).toEqual(before);
  });
});

describe('resolveGraph hooks', () => {
  test('an anchor that resolves to nothing is one unknown-step and makes no hook', () => {
    // Arrange
    const flows = { next: { $start: 'build', build: {}, lint: { when: 'before:missing' } } };

    // Act
    const { graph, diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'unknown-step')).toHaveLength(1);
    expect(graph.hooks).toEqual([]);
  });

  test('a pure step placed before an anchor gives one hook and no diagnostics', () => {
    // Arrange
    const flows = { next: { $start: 'build', build: { onSuccess: 'test' }, test: {}, lint: { when: 'before:test' } } };

    // Act
    const { graph, diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(graph.hooks).toEqual([{ flow: 'next', node: 'next.lint', anchor: 'next.test', position: 'before' }]);
  });

  test('a before: then an after: placement come back in declaration order with flow-qualified keys', () => {
    // Arrange
    const flows = {
      next: {
        $start: 'build',
        build: { onSuccess: 'test' },
        test: {},
        lint: { when: 'before:test' },
        ask: { when: 'after:build' },
      },
    };

    // Act
    const { graph } = resolveGraph(flows, { ...registry, ask: { outcomes: ['yes', 'no'], pure: true } });

    // Assert
    expect(graph.hooks).toEqual([
      { flow: 'next', node: 'next.lint', anchor: 'next.test', position: 'before' },
      { flow: 'next', node: 'next.ask', anchor: 'next.build', position: 'after' },
    ]);
  });

  test('graph.hooks equals the hooks of build over the same normalised and flattened flows', () => {
    // Arrange
    const flows = { next: { $start: 'build', build: { onSuccess: 'test' }, test: {}, lint: { when: 'before:test' } } };

    // Act
    const resolved = resolveGraph(flows, registry).graph.hooks;
    const built = build(flatten(normalise(flows).flows), registry).graph.hooks;

    // Assert
    expect(resolved).toEqual(built);
    expect(resolved).toHaveLength(1);
  });
});
