/**
 * `reachability`: the fifth and last step of `resolveGraph`. It walks each
 * flow from its start along the edges and `when:` placements `build`
 * produced, warns about every step entry the walk never reaches, and
 * refuses every interactive step an `$unattended` flow reaches.
 *
 * Rules:
 * - a flow's walk starts at its {@link FlowSummary.start}: the entry
 *   `$start` names, or the flow's first step entry when `$start` is absent.
 *   It follows every edge leaving a reached node, whatever its outcome or
 *   `repeat`, and reaches a hook's node when the hook's anchor is reached.
 * - every step entry the walk does not reach is one `unreachable` warning
 *   at the path it was written at, a lifted inline entry included. An
 *   implicit node (a registered step with no entry) is not an entry and is
 *   never reported as unreachable.
 * - a flow whose `$start` names nothing (`start` is `''`) is not walked and
 *   reports no `unreachable`: `build` has already refused the `$start` with
 *   `unknown-step`, and warning about every entry of the flow on top of it
 *   would bury that error.
 * - every reached node whose registered step is `interactive`, in a flow
 *   with `$unattended: true`, is one `interactive-unattended` error at the
 *   node's path: the entry's path, or for an implicit node the path of the
 *   first handler, `when:` or `$start` that named it.
 *
 * Diagnostics come flow by flow, and within a flow in the order of
 * {@link FlowSummary.nodes}.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { BuildResult } from './build';
import type { FlowSummary, GraphNode } from './types';

import { error, warn } from '../diagnostics';

/** The nodes one step of the walk leads to from each node: edge targets and hooked nodes. */
function successors(built: Pick<BuildResult, 'graph' | 'hooks'>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const list = out.get(from);
    if (list === undefined) {
      out.set(from, [to]);
    } else {
      list.push(to);
    }
  };
  for (const edge of built.graph.edges) {
    link(edge.from, edge.to);
  }
  for (const hook of built.hooks) {
    link(hook.anchor, hook.node);
  }
  return out;
}

/** Every node key the walk from `start` reaches, `start` included. */
function walk(start: string, next: ReadonlyMap<string, readonly string[]>): Set<string> {
  const reached = new Set<string>([start]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    for (const to of next.get(queue[index] ?? '') ?? []) {
      if (!reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }
  return reached;
}

/** The diagnostic one node of a walked flow earns, or `undefined` for none. */
function check(
  built: Pick<BuildResult, 'graph' | 'sources'>,
  flow: FlowSummary,
  key: string,
  reached: ReadonlySet<string>,
): Diagnostic | undefined {
  const source = Object.hasOwn(built.sources, key)
    ? built.sources[key]
    : undefined;
  const node: GraphNode | undefined = Object.hasOwn(built.graph.nodes, key)
    ? built.graph.nodes[key]
    : undefined;
  const id = node?.id ?? key;
  const path = source?.path ?? ['flows', flow.name, id];
  if (!reached.has(key)) {
    return source?.implicit === true
      ? undefined
      : warn(
        'unreachable',
        path,
        `step entry ${JSON.stringify(id)} is never reached from ${JSON.stringify(built.graph.nodes[flow.start]?.id ?? flow.start)}, the start of flow ${JSON.stringify(flow.name)}`,
      );
  }
  if (flow.unattended && node?.interactive === true) {
    return error(
      'interactive-unattended',
      path,
      `step ${JSON.stringify(node.step)} is interactive, but flow ${JSON.stringify(flow.name)} is \`$unattended\` and reaches it at ${JSON.stringify(id)}`,
    );
  }
  return undefined;
}

/**
 * Report every step entry no flow start reaches, and every interactive step
 * an `$unattended` flow reaches.
 *
 * @param built - What `build` returned; its `graph`, `sources` and `hooks`
 * are read.
 * @returns The `unreachable` warnings and `interactive-unattended` errors,
 * flow by flow in node order, each at a path rooted at `flows`.
 */
export function reachability(built: Pick<BuildResult, 'graph' | 'sources' | 'hooks'>): readonly Diagnostic[] {
  const next = successors(built);
  return Object.values(built.graph.flows).flatMap((flow) => {
    if (flow.start === '') {
      return [];
    }
    const reached = walk(flow.start, next);
    return flow.nodes.flatMap((key) => check(built, flow, key, reached) ?? []);
  });
}
