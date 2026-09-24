/**
 * Walk helpers: pure functions that read a resolved {@link Graph} as plain
 * data to answer what a runner asks while it steps through a flow.
 *
 * - {@link next}: the node an outcome of a node leads to;
 * - {@link hooksOf}: the nodes placed right before and after a node;
 * - {@link reachable}: every node a flow's walk reaches;
 * - {@link walkOrder}: the order a flow's nodes are placed in.
 *
 * Every node key is flow-qualified, as in {@link Graph.nodes}. Nothing is
 * cached between calls and nothing passed in is mutated. Every order below
 * comes from {@link Graph.edges} and {@link Graph.hooks}, which hold the
 * edges and `when:` placements in the order the flows declare them.
 *
 * @module
 */

import type { FlowSummary, Graph } from './types';

import { successors } from './successors';

/** The summary of `flow`, or a `RangeError` naming it when the graph has none. */
function flowOf(graph: Graph, flow: string, caller: string): FlowSummary {
  const summary = Object.hasOwn(graph.flows, flow)
    ? graph.flows[flow]
    : undefined;
  if (summary === undefined) {
    throw new RangeError(`${caller}: the graph has no flow ${JSON.stringify(flow)}`);
  }
  return summary;
}

/**
 * The node an outcome of a node leads to: the `to` of the edge leaving
 * `node` on `outcome`. A `repeat` edge is answered as written, whatever
 * its `repeat`.
 *
 * @example
 * ```ts
 * const { graph } = resolveGraph(
 *   { build: { compile: { onSuccess: 'test' }, test: {} } },
 *   { compile: { outcomes: ['success', 'fail'] }, test: { outcomes: ['success', 'fail'] } },
 * );
 * next(graph, 'build.compile', 'success'); // 'build.test'
 * next(graph, 'build.compile', 'fail'); // undefined
 * ```
 *
 * @param graph - The resolved graph; its `nodes` and `edges` are read.
 * @param node - The flow-qualified key of the node, such as `build.lint`.
 * @param outcome - One of the outcomes the node's step declares.
 * @returns The flow-qualified key of the node the edge goes to, or
 * `undefined` when the node declares `outcome` and has no handler for it.
 * When more than one edge leaves `node` on `outcome`, the first in
 * {@link Graph.edges} order is answered.
 * @throws RangeError - When `node` is not a key of `graph.nodes`, or when
 * its `outcomes` does not include `outcome`. The message names both `node`
 * and `outcome`.
 */
export function next(graph: Graph, node: string, outcome: string): string | undefined {
  const found = Object.hasOwn(graph.nodes, node)
    ? graph.nodes[node]
    : undefined;
  if (found === undefined) {
    throw new RangeError(`next: the graph has no node ${JSON.stringify(node)} to follow outcome ${JSON.stringify(outcome)} from`);
  }
  if (!found.outcomes.includes(outcome)) {
    throw new RangeError(`next: node ${JSON.stringify(node)} declares no outcome ${JSON.stringify(outcome)}`);
  }
  return graph.edges.find((edge) => edge.from === node && edge.outcome === outcome)?.to;
}

/**
 * The nodes placed right before and right after a node by `when:`: the
 * `node` of each hook whose `anchor` is `node`, split by its `position`.
 * Only the hooks anchored on `node` itself are listed, not the hooks on
 * those hooks.
 *
 * @param graph - The resolved graph; its `nodes` and `hooks` are read.
 * @param node - The flow-qualified key of the anchor, such as `build.compile`.
 * @returns A new object whose `before` and `after` each list the hooked
 * nodes' keys in {@link Graph.hooks} order, the order the flow declares
 * them in; both lists are empty for a node with no hook.
 * @throws RangeError - When `node` is not a key of `graph.nodes`; the
 * message names `node`.
 */
export function hooksOf(graph: Graph, node: string): { before: string[]; after: string[] } {
  if (!Object.hasOwn(graph.nodes, node)) {
    throw new RangeError(`hooksOf: the graph has no node ${JSON.stringify(node)}`);
  }
  const on = graph.hooks.filter((hook) => hook.anchor === node);
  return {
    before: on.filter((hook) => hook.position === 'before').map((hook) => hook.node),
    after: on.filter((hook) => hook.position === 'after').map((hook) => hook.node),
  };
}

/**
 * Every node a flow's walk reaches from its start: the walk `resolveGraph`
 * checks for `unreachable`, which follows every edge, whatever its outcome
 * and `repeat` (a `repeat: true` edge included), and leads from an anchor
 * to each node hooked on it.
 *
 * The walk is breadth-first: `start` comes first, then each node in the
 * order it is first reached, and a node's successors are taken edges
 * first, in {@link Graph.edges} order, then hooks, in {@link Graph.hooks}
 * order. Each node is listed once.
 *
 * @param graph - The resolved graph; its `flows`, `edges` and `hooks` are read.
 * @param flow - The name of the flow, a key of `graph.flows`.
 * @returns A new array of flow-qualified node keys in the order above, or
 * `[]` for a flow whose `start` is `''` (a flow with no entry, or whose
 * `$start` names nothing).
 * @throws RangeError - When `flow` is not a key of `graph.flows`; the
 * message names `flow`.
 */
export function reachable(graph: Graph, flow: string): string[] {
  const { start } = flowOf(graph, flow, 'reachable');
  if (start === '') {
    return [];
  }
  const leads = successors(graph);
  const seen = new Set<string>([start]);
  const out = [start];
  for (let index = 0; index < out.length; index += 1) {
    for (const to of leads.get(out[index] ?? '') ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        out.push(to);
      }
    }
  }
  return out;
}

/** The state one {@link walkOrder} call builds up. */
interface Walk {
  readonly graph: Graph;
  /** Every node claimed so far, for membership only. */
  readonly seen: Set<string>;
  /** The nodes placed so far, in placement order. */
  readonly order: string[];
}

/**
 * Place `key` with its hooks: its `before` hooks, each placed recursively,
 * then `key`, then its `after` hooks, each placed recursively. A node
 * already claimed is skipped; a node is claimed before its hooks are
 * placed, so hooks that name each other cannot loop.
 */
function place(walk: Walk, key: string): void {
  if (walk.seen.has(key)) {
    return;
  }
  walk.seen.add(key);
  const hooks = walk.graph.hooks.filter((hook) => hook.anchor === key);
  for (const hook of hooks.filter((item) => item.position === 'before')) {
    place(walk, hook.node);
  }
  walk.order.push(key);
  for (const hook of hooks.filter((item) => item.position === 'after')) {
    place(walk, hook.node);
  }
}

/**
 * Place the block of `key`, then follow, depth-first, the non-`repeat`
 * edges of `key` and then of each hook node placed in that block.
 */
function visit(walk: Walk, key: string): void {
  if (walk.seen.has(key)) {
    return;
  }
  const from = walk.order.length;
  place(walk, key);
  const block = walk.order.slice(from);
  const leaders = [key, ...block.filter((item) => item !== key)];
  for (const leader of leaders) {
    for (const edge of walk.graph.edges) {
      if (edge.from === leader && edge.repeat !== true) {
        visit(walk, edge.to);
      }
    }
  }
}

/**
 * The order a flow's nodes are placed in: depth-first from the flow's
 * `start`, each node placed once, at the first position the walk reaches
 * it (a node reached both by an edge and as a hook stays where it was
 * first placed).
 *
 * Placing a node places, in order, its `before` hooks, the node, then its
 * `after` hooks, each hook in {@link Graph.hooks} order and each placed
 * the same way, so a hook on a hook is placed around its own anchor. Once
 * that block is placed, the walk follows the node's edges in
 * {@link Graph.edges} order, then the edges of each hook node placed in
 * the block, in placement order, and walks each target the same way
 * before the next edge.
 *
 * A `repeat: true` edge is never followed; a `repeat` that is a number is
 * not `true` and is followed. So a node reached only through a
 * `repeat: true` edge is in {@link reachable} but not here.
 *
 * @param graph - The resolved graph; its `flows`, `edges` and `hooks` are read.
 * @param flow - The name of the flow, a key of `graph.flows`.
 * @returns A new array of flow-qualified node keys in placement order, or
 * `[]` for a flow whose `start` is `''` (a flow with no entry, or whose
 * `$start` names nothing).
 * @throws RangeError - When `flow` is not a key of `graph.flows`; the
 * message names `flow`.
 */
export function walkOrder(graph: Graph, flow: string): string[] {
  const { start } = flowOf(graph, flow, 'walkOrder');
  if (start === '') {
    return [];
  }
  const walk: Walk = { graph, seen: new Set(), order: [] };
  visit(walk, start);
  return walk.order;
}
