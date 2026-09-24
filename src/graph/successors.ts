/**
 * `successors`: the nodes one step of a walk leads to from each node of a
 * {@link Graph}. Shared by `reachability` and the walk helpers.
 *
 * @module
 */

import type { Graph } from './types';

/**
 * Map each node key to the node keys one step of a walk leads to from it.
 *
 * A node's list holds, first, the `to` of each edge leaving it, in
 * {@link Graph.edges} order, whatever the edge's outcome and `repeat`
 * (a `repeat` edge is included); then the `node` of each hook anchored on
 * it, in {@link Graph.hooks} order. A target is listed once per edge or
 * hook naming it, so a duplicate is kept. A node with no edge leaving it
 * and no hook anchored on it has no key in the map.
 *
 * @param graph - The graph whose `edges` and `hooks` are read.
 * @returns A new map from node key to its successors, in the order above.
 */
export function successors(graph: Graph): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const list = out.get(from);
    if (list === undefined) {
      out.set(from, [to]);
    } else {
      list.push(to);
    }
  };
  for (const edge of graph.edges) {
    link(edge.from, edge.to);
  }
  for (const hook of graph.hooks) {
    link(hook.anchor, hook.node);
  }
  return out;
}
