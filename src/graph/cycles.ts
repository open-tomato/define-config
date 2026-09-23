/**
 * `cycles`: the fourth step of `resolveGraph`. It walks the edges `build`
 * produced depth-first and reports every back edge, the handler that closes
 * a loop, as `cycle`, unless that edge is marked as a wanted loop.
 *
 * Rules:
 * - the walk starts from every node in the order of {@link Graph.nodes}
 *   that an earlier walk has not visited, and follows each node's edges in
 *   declaration order. An edge to a node still on the walk's stack is a
 *   back edge; every other edge is not.
 * - a back edge whose `repeat` is `true` is exempt: `repeat: true` is the
 *   only way to mark a wanted loop. A `repeat` that is a number, `false`,
 *   or absent does not exempt the edge.
 * - every other back edge is one `cycle` error at the path of the handler
 *   that closes it, `['flows', '<flow>', '<id>', 'on', '<outcome>']`, with
 *   a message naming the edge `a → b` and the ids on the cycle in walk
 *   order, `b → … → a → b`. An edge from a node to itself is a cycle of
 *   one id.
 * - a `when:` placement is a {@link GraphHook}, not an edge, so it closes
 *   no cycle.
 *
 * Which edge a loop is reported on follows from the walk: in
 * `a → b → a` walked from `a`, the edge `b → a` closes it. Two loops
 * sharing one closing edge are one diagnostic.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { BuildResult } from './build';
import type { GraphEdge, GraphNode } from './types';

import { error } from '../diagnostics';

/** Where a node is in the walk: on the stack, or finished. */
type Mark = 'open' | 'done';

/** One node on the walk's stack, with the index of the next edge to follow. */
interface Frame {
  readonly key: string;
  next: number;
}

/** The edges leaving each node, in declaration order. */
function adjacency(edges: readonly GraphEdge[]): Map<string, GraphEdge[]> {
  const out = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = out.get(edge.from);
    if (list === undefined) {
      out.set(edge.from, [edge]);
    } else {
      list.push(edge);
    }
  }
  return out;
}

/** The step id of a node key, for a message; the key itself for an unknown node. */
function idOf(nodes: Readonly<Record<string, GraphNode>>, key: string): string {
  return Object.hasOwn(nodes, key)
    ? nodes[key]?.id ?? key
    : key;
}

/** The `cycle` error for a back edge, given the stack from its target up to its source. */
function cycleError(
  built: Pick<BuildResult, 'graph' | 'sources'>,
  edge: GraphEdge,
  loop: readonly string[],
): Diagnostic {
  const { nodes } = built.graph;
  const source = Object.hasOwn(built.sources, edge.from)
    ? built.sources[edge.from]
    : undefined;
  const node = Object.hasOwn(nodes, edge.from)
    ? nodes[edge.from]
    : undefined;
  const base = source?.path ?? ['flows', node?.flow ?? '', idOf(nodes, edge.from)];
  const from = idOf(nodes, edge.from);
  const to = idOf(nodes, edge.to);
  const ids = [...loop, edge.to].map((key) => idOf(nodes, key)).join(' → ');
  return error(
    'cycle',
    [...base, 'on', edge.outcome],
    `the handler on ${JSON.stringify(edge.outcome)} closes a cycle with the edge ${from} → ${to}; `
    + `the cycle is ${ids}. Mark the edge \`{ to: ${JSON.stringify(to)}, repeat: true }\` if the loop is wanted`,
  );
}

/**
 * Report every back edge of the graph that is not marked `repeat: true`.
 *
 * @param built - What `build` returned; only its `graph` and `sources` are read.
 * @returns One `cycle` error per unexempt back edge, in walk order, each at
 * the path of the handler that closes the cycle.
 */
export function cycles(built: Pick<BuildResult, 'graph' | 'sources'>): readonly Diagnostic[] {
  const out = adjacency(built.graph.edges);
  const marks = new Map<string, Mark>();
  const diagnostics: Diagnostic[] = [];
  for (const root of Object.keys(built.graph.nodes)) {
    if (marks.has(root)) {
      continue;
    }
    const stack: Frame[] = [{ key: root, next: 0 }];
    marks.set(root, 'open');
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const edge = frame === undefined
        ? undefined
        : out.get(frame.key)?.[frame.next];
      if (frame === undefined || edge === undefined) {
        if (frame !== undefined) {
          marks.set(frame.key, 'done');
        }
        stack.pop();
        continue;
      }
      frame.next += 1;
      const mark = marks.get(edge.to);
      if (mark === undefined) {
        marks.set(edge.to, 'open');
        stack.push({ key: edge.to, next: 0 });
      } else if (mark === 'open' && edge.repeat !== true) {
        const start = stack.findIndex((item) => item.key === edge.to);
        diagnostics.push(cycleError(built, edge, stack.slice(start).map((item) => item.key)));
      }
    }
  }
  return diagnostics;
}
