/**
 * `resolveGraph`: the graph stage of the library. It runs the merged
 * `flows` section through five steps, each described in its own module:
 *
 * 1. `./normalise` folds the sugar handlers into `on` (`handler-conflict`);
 * 2. `./flatten` lifts inline entries into step entries of their own and
 *    rewrites edge objects as `{ to, repeat }` (`duplicate-key`);
 * 3. `./build` makes the nodes, edges and hooks against the host's step registry
 *    (`unknown-step`, `unknown-outcome`, `impure-when`);
 * 4. `./cycles` reports every back edge not marked `repeat: true`
 *    (`cycle`);
 * 5. `./reachability` walks each flow from its start (`unreachable`,
 *    `interactive-unattended`).
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { Graph, StepRegistry } from './types';

import { build } from './build';
import { cycles } from './cycles';
import { flatten } from './flatten';
import { normalise } from './normalise';
import { reachability } from './reachability';

/** What {@link resolveGraph} returns. */
export interface ResolveGraphResult {
  /**
   * The step graph of every flow that is a plain object. It is built even
   * when there are errors: a node or an edge an error refers to is kept
   * where it could be built, and dropped where it could not.
   */
  readonly graph: Graph;
  /**
   * Every problem found, each at a path rooted at `flows`, in the order of
   * the steps that found them: normalise, flatten, build, cycles, then
   * reachability.
   */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Resolve the merged `flows` section into a step graph and report every
 * problem in it. Nothing is refused by throwing: each problem is a
 * diagnostic, and nothing passed in is mutated.
 *
 * @example
 * ```ts
 * resolveGraph(
 *   { next: { build: { onSuccess: 'test' }, test: {} } },
 *   { build: { outcomes: ['success', 'fail'] }, test: { outcomes: ['success', 'fail'] } },
 * );
 * // { graph: { nodes: { 'next.build': …, 'next.test': … },
 * //            edges: [{ from: 'next.build', outcome: 'success', to: 'next.test', repeat: false }],
 * //            hooks: [],
 * //            flows: { next: { name: 'next', start: 'next.build', unattended: false, nodes: […] } } },
 * //   diagnostics: [] }
 * ```
 *
 * @param flows - The merged `flows` section: flows keyed by flow name, each
 * a keyed map of step entries beside the reserved `$start` and
 * `$unattended`.
 * @param steps - The host's step registry, keyed by step name.
 * @returns The graph, and the `handler-conflict`, `duplicate-key`,
 * `unknown-step`, `unknown-outcome`, `impure-when`, `cycle` and
 * `interactive-unattended` errors and `unreachable` warnings found.
 */
export function resolveGraph(flows: Readonly<Record<string, unknown>>, steps: StepRegistry): ResolveGraphResult {
  const normalised = normalise(flows);
  const flattened = flatten(normalised.flows);
  const built = build(flattened, steps);
  const diagnostics = [
    ...normalised.diagnostics,
    ...flattened.diagnostics,
    ...built.diagnostics,
    ...cycles(built),
    ...reachability(built),
  ];
  return { graph: built.graph, diagnostics };
}
