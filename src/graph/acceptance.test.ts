/**
 * Acceptance: the graph examples the spec's definition of done names, run
 * through `resolveGraph` as a host would, under the spec's flow name `next`.
 */

import type { Diagnostic } from '../diagnostics';
import type { StepRegistry } from './types';

import { describe, expect, test } from 'bun:test';

import { pathToString } from '../diagnostics';

import { resolveGraph } from './index';

const registry: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
  lint: { outcomes: ['success', 'fail'], pure: true },
  ask: { outcomes: ['yes', 'no'], interactive: true },
};

/** Level, code and rendered path of each diagnostic, sorted for a stable comparison. */
function where(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics
    .map((diagnostic) => `${diagnostic.level} ${diagnostic.code} ${pathToString(diagnostic.path)}`)
    .sort();
}

describe('definition-of-done graph examples', () => {
  test('an unknown outcome is refused at flows.next.<id>.on.<outcome>', () => {
    // Arrange
    const flows = { next: { build: { on: { success: 'test', maybe: 'test' } }, test: {} } };

    // Act
    const { diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(where(diagnostics)).toEqual(['error unknown-outcome flows.next.build.on.maybe']);
    expect(diagnostics[0]?.path).toEqual(['flows', 'next', 'build', 'on', 'maybe']);
  });

  test('a when on a step that is not pure is refused at flows.next.<id>.when', () => {
    // Arrange
    const flows = { next: { build: {}, test: { when: 'after:build' } } };

    // Act
    const { diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(where(diagnostics)).toEqual(['error impure-when flows.next.test.when']);
  });

  test('a cycle without repeat is refused at the handler that closes it, naming the edge and ids', () => {
    // Arrange
    const flows = { next: { build: { onSuccess: 'test' }, test: { onFail: 'build' } } };

    // Act
    const { diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(where(diagnostics)).toEqual(['error cycle flows.next.test.on.fail']);
    expect(diagnostics[0]?.message).toContain('test → build');
    expect(diagnostics[0]?.message).toContain('build');
    expect(diagnostics[0]?.message).toContain('test');
  });

  test('the same cycle is accepted once the closing edge carries repeat: true', () => {
    // Arrange
    const flows = { next: { build: { onSuccess: 'test' }, test: { onFail: { to: 'build', repeat: true } } } };

    // Act
    const { graph, diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(graph.edges).toContainEqual({ from: 'next.test', outcome: 'fail', to: 'next.build', repeat: true });
  });
});

describe('two-flow fixture', () => {
  test('reports every refusal and the warning together, each at its own path', () => {
    // Arrange
    const flows = {
      next: {
        build: { on: { success: 'test', maybe: 'test' } },
        test: { on: { success: 'build' } },
        vet: { step: 'test', when: 'after:build' },
        gone: { step: 'build', onSuccess: 'deploy' },
        clash: { step: 'build', on: { success: 'test' }, onSuccess: 'test' },
      },
      ops: {
        $start: 'ask',
        $unattended: true,
        ask: { on: { yes: 'lint' } },
      },
    };
    const before = structuredClone(flows);

    // Act
    const { diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(where(diagnostics)).toEqual([
      'error cycle flows.next.test.on.success',
      'error handler-conflict flows.next.clash',
      'error impure-when flows.next.vet.when',
      'error interactive-unattended flows.ops.ask',
      'error unknown-outcome flows.next.build.on.maybe',
      'error unknown-step flows.next.gone.on.success',
      'warn unreachable flows.next.clash',
      'warn unreachable flows.next.gone',
    ].sort());
    expect(flows).toEqual(before);
  });
});
