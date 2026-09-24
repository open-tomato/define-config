import type { Graph } from '../index';

import { describe, expect, test } from 'bun:test';

import { hooksOf, next, reachable, resolveGraph } from '../index';

/**
 * Drives a flow the way a host would: only `next` and `hooksOf`, running each
 * `before` hook, the node, then each `after` hook. Stops when `next` answers
 * `undefined` or after `maxAttempts` node runs.
 */
function drive(
  graph: Graph,
  start: string,
  script: (node: string, attempt: number) => string,
  maxAttempts: number,
): string[] {
  const log: string[] = [];
  const attempts = new Map<string, number>();
  let current: string | undefined = start;
  while (current !== undefined && log.length < maxAttempts) {
    const { before, after } = hooksOf(graph, current);
    const count = (attempts.get(current) ?? 0) + 1;
    attempts.set(current, count);
    log.push(...before, current, ...after);
    current = next(graph, current, script(current, count));
  }
  return log;
}

describe('runner over the resolved graph', () => {
  const resolved = resolveGraph(
    {
      build: {
        $start: 'lint',
        lint: { onSuccess: 'test' },
        format: { when: 'before:test' },
        test: {},
      },
    },
    {
      lint: { outcomes: ['success', 'fail'] },
      format: { outcomes: ['success'] },
      test: { outcomes: ['success', 'fail'] },
    },
  );
  const graph = resolved.graph;

  test('next answers each declared outcome', () => {
    // Arrange / Act / Assert
    expect(next(graph, 'build.lint', 'success')).toBe('build.test');
    expect(next(graph, 'build.lint', 'fail')).toBeUndefined();
    expect(next(graph, 'build.test', 'success')).toBeUndefined();
    expect(next(graph, 'build.test', 'fail')).toBeUndefined();
  });

  test('reachable and hooksOf describe the flow', () => {
    expect(reachable(graph, 'build')).toEqual(['build.lint', 'build.test', 'build.format']);
    expect(hooksOf(graph, 'build.test')).toEqual({ before: ['build.format'], after: [] });
  });

  test('a scripted run ends when next answers undefined', () => {
    // Arrange
    const outcomes: Record<string, string> = {
      'build.lint': 'success',
      'build.format': 'success',
      'build.test': 'success',
    };

    // Act
    const log = drive(graph, graph.flows.build!.start, (node) => outcomes[node]!, 10);

    // Assert
    expect(log).toEqual(['build.lint', 'build.format', 'build.test']);
  });
});

describe('runner over a repeat flow', () => {
  const { graph } = resolveGraph(
    {
      retry: {
        $start: 'prepare',
        prepare: { onSuccess: 'attempt' },
        attempt: { on: { fail: { to: 'prepare', repeat: true } } },
      },
    },
    {
      prepare: { outcomes: ['success'] },
      attempt: { outcomes: ['success', 'fail'] },
    },
  );

  test('fail then success ends the loop within the attempt bound', () => {
    // Arrange
    const sequence = ['fail', 'fail', 'success'];
    let call = 0;
    const script = (node: string): string => {
      if (node === 'retry.prepare') {
        return 'success';
      }
      return sequence[call++]!;
    };

    // Act
    const log = drive(graph, graph.flows.retry!.start, script, 50);

    // Assert
    expect(log).toEqual([
      'retry.prepare', 'retry.attempt',
      'retry.prepare', 'retry.attempt',
      'retry.prepare', 'retry.attempt',
    ]);
    expect(call).toBe(3);
  });

  test('a never-succeeding script is stopped by the runner-side bound', () => {
    const log = drive(graph, graph.flows.retry!.start, (node) => (node === 'retry.prepare'
      ? 'success'
      : 'fail'), 6);

    expect(log).toHaveLength(6);
  });
});
