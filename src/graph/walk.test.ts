import type { Flows, StepRegistry } from './types';

import { describe, expect, test } from 'bun:test';

import { build } from './build';
import { flatten } from './flatten';
import { normalise } from './normalise';
import { reachability } from './reachability';
import { hooksOf, next, reachable, walkOrder } from './walk';

import { resolveGraph } from './index';

const registry: StepRegistry = {
  compile: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
  lint: { outcomes: ['success', 'fail'], pure: true },
  format: { outcomes: ['success', 'fail'], pure: true },
  stamp: { outcomes: ['success'], pure: true },
  report: { outcomes: [] },
};

/**
 * One resolved fixture, one flow per case:
 * - `build`: two `before` and two `after` hooks on `compile`, an unhandled
 *   declared outcome on `lint` and a `repeat: true` loop from `test`;
 * - `retry`: `prepare` is reached through the `repeat: true` edge from the
 *   start, and by the walk only later, as an `after` hook of `report`;
 * - `hooks`: hooks on a hook, and an edge leaving a hook node;
 * - `share`: `lint` is reached by an edge first and as a hook later;
 * - `idle`: no entry, so its `start` is `''`.
 */
const flows: Flows = {
  build: {
    compile: { onSuccess: 'test', onFail: 'report' },
    lint: { when: 'before:compile', onFail: 'report' },
    format: { when: 'before:compile' },
    stamp: { when: 'after:compile' },
    audit: { step: 'stamp', when: 'after:compile' },
    test: { on: { fail: { to: 'compile', repeat: true }, success: 'report' } },
    report: {},
  },
  retry: {
    $start: 'test',
    prepare: { step: 'format', when: 'after:report', onSuccess: 'test' },
    test: { on: { fail: { to: 'prepare', repeat: true }, success: 'report' } },
    report: {},
  },
  hooks: {
    compile: { onSuccess: 'test' },
    lint: { when: 'before:compile' },
    format: { when: 'before:lint', onFail: 'report' },
    stamp: { when: 'after:lint' },
    sign: { step: 'stamp', when: 'after:compile' },
    test: {},
    report: {},
  },
  share: {
    compile: { onSuccess: 'lint', onFail: 'test' },
    lint: { when: 'after:test' },
    test: {},
  },
  idle: {},
};

const resolved = resolveGraph(flows, registry);
const { graph } = resolved;

describe('the fixture', () => {
  test('resolves with no error diagnostics', () => {
    expect(resolved.diagnostics.filter((diagnostic) => diagnostic.level === 'error')).toEqual([]);
  });

  test('control: the same registry reports an error for a $start naming nothing', () => {
    const { diagnostics } = resolveGraph({ broken: { $start: 'missing' } }, registry);
    expect(diagnostics.map((diagnostic) => `${diagnostic.level} ${diagnostic.code}`)).toEqual(['error unknown-step']);
  });
});

describe('next', () => {
  test('an unknown node is a RangeError naming the node and the outcome', () => {
    expect(() => next(graph, 'build.missing', 'success')).toThrow(RangeError);
    expect(() => next(graph, 'build.missing', 'success')).toThrow('build.missing');
    expect(() => next(graph, 'build.missing', 'success')).toThrow('success');
  });

  test('an outcome the node does not declare is a RangeError naming the node and the outcome', () => {
    expect(() => next(graph, 'build.lint', 'nope')).toThrow(RangeError);
    expect(() => next(graph, 'build.lint', 'nope')).toThrow('build.lint');
    expect(() => next(graph, 'build.lint', 'nope')).toThrow('nope');
  });

  test('a declared outcome with no handler answers undefined', () => {
    // Arrange: `lint` declares `success` and handles only `fail`.
    const outcomes = graph.nodes['build.lint']?.outcomes;

    // Act
    const target = next(graph, 'build.lint', 'success');

    // Assert
    expect(outcomes).toContain('success');
    expect(target).toBeUndefined();
  });

  test('every declared outcome of a node answers its edge target', () => {
    // Arrange
    const outcomes = graph.nodes['build.compile']?.outcomes ?? [];

    // Act
    const targets = outcomes.map((outcome) => next(graph, 'build.compile', outcome));

    // Assert
    expect(outcomes).toEqual(['success', 'fail']);
    expect(targets).toEqual(['build.test', 'build.report']);
  });

  test('a repeat: true edge is answered as written', () => {
    // Arrange
    const edge = graph.edges.find((item) => item.from === 'build.test' && item.outcome === 'fail');

    // Act
    const target = next(graph, 'build.test', 'fail');

    // Assert
    expect(edge?.repeat).toBe(true);
    expect(target).toBe('build.compile');
  });
});

describe('hooksOf', () => {
  test('an unknown node is a RangeError naming the node', () => {
    expect(() => hooksOf(graph, 'build.missing')).toThrow(RangeError);
    expect(() => hooksOf(graph, 'build.missing')).toThrow('build.missing');
  });

  test('before and after hooks come in declaration order, not sorted', () => {
    expect(hooksOf(graph, 'build.compile')).toEqual({
      before: ['build.lint', 'build.format'],
      after: ['build.stamp', 'build.audit'],
    });
  });

  test('only the hooks anchored on the node itself are listed', () => {
    expect(hooksOf(graph, 'hooks.compile')).toEqual({ before: ['hooks.lint'], after: ['hooks.sign'] });
    expect(hooksOf(graph, 'hooks.lint')).toEqual({ before: ['hooks.format'], after: ['hooks.stamp'] });
  });

  test('a node with no hook answers two empty lists', () => {
    expect(hooksOf(graph, 'build.report')).toEqual({ before: [], after: [] });
  });
});

describe('reachable', () => {
  test('an unknown flow is a RangeError naming the flow', () => {
    expect(() => reachable(graph, 'missing')).toThrow(RangeError);
    expect(() => reachable(graph, 'missing')).toThrow('missing');
  });

  test('a flow whose start is empty reaches nothing', () => {
    expect(graph.flows.idle?.start).toBe('');
    expect(reachable(graph, 'idle')).toEqual([]);
  });

  test('the start comes first, then each node as the walk first reaches it', () => {
    expect(reachable(graph, 'hooks')).toEqual([
      'hooks.compile',
      'hooks.test',
      'hooks.lint',
      'hooks.sign',
      'hooks.format',
      'hooks.stamp',
      'hooks.report',
    ]);
  });

  test('a repeat: true edge is followed', () => {
    // `prepare` right after the start: reached through the repeat edge,
    // before `report`, whose hook would reach it next.
    expect(reachable(graph, 'retry')).toEqual(['retry.test', 'retry.prepare', 'retry.report']);
  });

  test('a node reached by both an edge and a hook is listed once', () => {
    expect(reachable(graph, 'share')).toEqual(['share.compile', 'share.lint', 'share.test']);
  });
});

describe('walkOrder', () => {
  test('an unknown flow is a RangeError naming the flow', () => {
    expect(() => walkOrder(graph, 'missing')).toThrow(RangeError);
    expect(() => walkOrder(graph, 'missing')).toThrow('missing');
  });

  test('a flow whose start is empty places nothing', () => {
    expect(graph.flows.idle?.start).toBe('');
    expect(walkOrder(graph, 'idle')).toEqual([]);
  });

  test('a hook on a hook is placed recursively, and a hook node\'s edges are followed after its anchor\'s', () => {
    expect(walkOrder(graph, 'hooks')).toEqual([
      'hooks.format',
      'hooks.lint',
      'hooks.stamp',
      'hooks.compile',
      'hooks.sign',
      'hooks.test',
      'hooks.report',
    ]);
  });

  test('a repeat: true loop is not followed, though reachable follows it', () => {
    // Arrange: the edge `test` → `prepare` is the repeat: true one.
    const edge = graph.edges.find((item) => item.from === 'retry.test' && item.to === 'retry.prepare');

    // Act
    const order = walkOrder(graph, 'retry');

    // Assert: `prepare` is placed only as the after hook of `report`.
    expect(edge?.repeat).toBe(true);
    expect(order).toEqual(['retry.test', 'retry.report', 'retry.prepare']);
    expect(reachable(graph, 'retry').indexOf('retry.prepare')).toBe(1);
  });

  test('a repeat that is a number is not true, so its edge is followed', () => {
    // Arrange: `repeat: 2` is refused by the `Flows` type, so the flows are untyped.
    const untyped: Record<string, unknown> = { loose: { compile: { on: { success: { to: 'test', repeat: 2 } } }, test: {} } };
    const loose = resolveGraph(untyped, registry);

    // Act
    const order = walkOrder(loose.graph, 'loose');

    // Assert
    expect(loose.diagnostics).toEqual([]);
    expect(loose.graph.edges[0]?.repeat).toBe(2);
    expect(order).toEqual(['loose.compile', 'loose.test']);
  });

  test('a node reached by both an edge and a hook is placed once, at its first position', () => {
    // `lint` is reached by the success edge of `compile` before it is
    // placed as the after hook of `test`.
    expect(hooksOf(graph, 'share.test')).toEqual({ before: [], after: ['share.lint'] });
    expect(walkOrder(graph, 'share')).toEqual(['share.compile', 'share.lint', 'share.test']);
  });

  test('two calls answer deep-equal arrays, equal to the pinned order', () => {
    // Act
    const first = walkOrder(graph, 'build');
    const second = walkOrder(graph, 'build');

    // Assert
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).toEqual([
      'build.lint',
      'build.format',
      'build.compile',
      'build.stamp',
      'build.audit',
      'build.test',
      'build.report',
    ]);
  });
});

/** The registry of `reachability.test.ts`, whose flows the agreement test also covers. */
const reachabilityRegistry: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
  lint: { outcomes: ['success', 'fail'], pure: true },
  ask: { outcomes: ['yes', 'no'], interactive: true },
  report: { outcomes: [] },
};

/** The `reachability.test.ts` flow maps, each with the flows it defines. */
const reachabilityFlows: Record<string, unknown>[] = [
  { next: { build: { on: { success: 'test' } }, test: { on: { fail: 'report' } }, report: {} } },
  { next: { build: { on: { success: 'test' } }, test: {}, lint: {} } },
  { next: { build: { on: { success: 'test' } }, test: {}, $start: 'test' } },
  { next: { build: {}, test: { on: { success: 'lint' } }, lint: {} } },
  {
    next: {
      build: { on: { success: 'test', fail: 'lint' } },
      test: { on: { fail: { to: 'build', repeat: true }, success: 'report' } },
      lint: {},
      report: {},
    },
  },
  { next: { build: {}, test: { on: { fail: { step: 'lint' } } } } },
  { next: { build: {}, test: { on: { success: 'report' } } } },
  { next: { build: { on: { success: 'test' } }, test: {} }, main: { build: {}, test: {} } },
  { next: { build: {}, test: {}, $start: 'missing' } },
  { next: {} },
  { next: { build: { on: { success: 'test' } }, test: {}, lint: { when: 'before:test' } } },
  { next: { build: {}, lint: { when: 'after:build', on: { fail: 'report' } }, report: {} } },
  { next: { build: {}, test: {}, lint: { when: 'after:test' } } },
  { next: { build: { on: { success: 'lint' } }, lint: { when: 'before:test' }, test: {} } },
  { next: { $unattended: true, build: { on: { fail: 'ask' } }, ask: {} } },
  { next: { $unattended: true, ask: { on: { yes: 'build' } }, build: {} } },
  { next: { $unattended: true, build: { on: { fail: 'ask' } } } },
  {
    next: {
      $unattended: true,
      build: { on: { fail: { step: 'ask' } } },
      prompt: { step: 'ask', when: 'before:build' },
    },
  },
];

describe('reachable, walkOrder and reachability agree', () => {
  const cases: { flows: Record<string, unknown>; registry: StepRegistry }[] = [
    { flows, registry },
    ...reachabilityFlows.map((item) => ({ flows: item, registry: reachabilityRegistry })),
  ];

  test('the cases are not vacuous: some flow has a non-empty start and some node is unreached', () => {
    const starts = cases.flatMap((item) => Object.values(resolveGraph(item.flows, item.registry).graph.flows))
      .filter((flow) => flow.start !== '');
    expect(starts.length).toBeGreaterThan(10);
  });

  test('for every flow with a start: reachable and the unreachable warnings are disjoint, together the nodes minus unreached implicit nodes, and walkOrder covers reachable', () => {
    let checked = 0;
    let warned = 0;
    for (const item of cases) {
      // Arrange
      const result = build(flatten(normalise(item.flows).flows), item.registry);
      const resolvedGraph = resolveGraph(item.flows, item.registry).graph;
      const warnings = reachability(result).filter((diagnostic) => diagnostic.code === 'unreachable');

      for (const flow of Object.values(resolvedGraph.flows)) {
        if (flow.start === '') {
          continue;
        }
        // Act
        const reached = reachable(resolvedGraph, flow.name);
        const reachedSet = new Set(reached);
        const warnedKeys = flow.nodes.filter((key) => warnings.some(
          (warning) => warning.path.join('\u0000') === (result.sources[key]?.path ?? []).join('\u0000'),
        ) && !reachedSet.has(key));
        const unreachedImplicit = flow.nodes.filter((key) => result.sources[key]?.implicit === true && !reachedSet.has(key));
        const expected = flow.nodes.filter((key) => !unreachedImplicit.includes(key));

        // Assert
        expect(warnedKeys.filter((key) => reachedSet.has(key))).toEqual([]);
        expect(new Set([...reached, ...warnedKeys])).toEqual(new Set(expected));
        expect(reached.length + warnedKeys.length).toBe(expected.length);
        expect(new Set(walkOrder(resolvedGraph, flow.name))).toEqual(reachedSet);
        checked += 1;
        warned += warnedKeys.length;
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(warned).toBeGreaterThan(0);
  });
});
