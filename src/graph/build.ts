/**
 * `build`: the third step of `resolveGraph`. It reads the flows `flatten`
 * returns, where every handler under `on` is a step id or a
 * `{ to, repeat }` edge, and the host's step registry, and produces the
 * {@link Graph}: one node per step entry, one edge per handler, one
 * {@link GraphHook} per resolved `when:`, one {@link FlowSummary} per flow.
 *
 * Rules:
 * - every plain-object value at a step id is a step entry and becomes a
 *   node keyed by {@link nodeKey}. Its step is its `step` when that is a
 *   string, its own id when `step` is absent. The node's outcomes,
 *   `required`, `pure` and `interactive` come from the registry; its
 *   options are every key but `step`, `on`, `when` and `expect`.
 * - an entry whose step is not in the registry, or whose `step` is not a
 *   string, is `unknown-step` at the entry's path (at `step` when the
 *   entry names one). Its node is kept with no outcomes, and its handler
 *   keys, `expect` and `when` are not checked against a step it lacks.
 * - a handler target, a `when:` anchor or a `$start` resolves to the step
 *   entry with that id in the same flow; failing that, to an implicit node
 *   for the registered step of that name (id and step both that name, no
 *   options), made once per flow at its first reference; failing both, it
 *   is `unknown-step` at the path it was written at
 *   (`['flows', '<flow>', '<id>', 'on', '<outcome>']`, `…, 'when']`,
 *   `['flows', '<flow>', '$start']`).
 * - a handler key or a string `expect` naming an outcome the entry's
 *   registered step does not declare is `unknown-outcome` at the handler's
 *   path or at `expect`. The handler still builds its edge: the target is
 *   known, and the edge is what the host wrote.
 * - a `when:` on an entry whose registered step is not `pure` is
 *   `impure-when` at `['flows', '<flow>', '<id>', 'when']`. A `when:` of the
 *   form `before:<id>` or `after:<id>` becomes a {@link GraphHook}, not an
 *   edge; any other `when:` value is the host schema's to check.
 * - an edge carries `{ from, outcome, to, repeat }`; `repeat` is the edge
 *   object's `repeat` from `flatten`, `false` for a handler written as an id.
 * - a flow starts at the entry `$start` names, or at its first step entry
 *   when `$start` is absent or not a string; `start` is `''` when the flow
 *   has nothing to start at.
 * - a flow that is not a plain object, a handler value that is neither a
 *   string nor an edge object, and an `on` that is not a plain object build
 *   nothing; their shape is the host schema's to check.
 *
 * Paths come from `flatten`, so a problem in a lifted inline entry is
 * reported where the host wrote it (`['flows', 'next', 'a', 'on',
 * 'success', 'when']`), not at its generated id.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';
import type { FlattenResult } from './flatten';
import type { FlowSummary, Graph, GraphEdge, GraphHook, GraphNode, StepRegistry } from './types';

import { error, pathToString } from '../diagnostics';
import { isPlainObject } from '../merge/plain-object';

/** Where a node came from: the path it was written at, and whether it is implicit. */
export interface NodeSource {
  /**
   * The path of the step entry, or for an implicit node the path of the
   * first handler, `when:` or `$start` that named it.
   */
  readonly path: readonly string[];
  /** `true` for a node made for a registered step that has no entry in the flow. */
  readonly implicit: boolean;
}

/** What {@link build} returns. */
export interface BuildResult {
  /**
   * The graph: nodes, edges and `when:` placements in declaration order,
   * and a summary per flow.
   */
  readonly graph: Graph;
  /** Where each node came from, keyed like {@link Graph.nodes}. */
  readonly sources: Readonly<Record<string, NodeSource>>;
  /** Every `unknown-step`, `unknown-outcome` and `impure-when` error, in declaration order. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The reserved keys of a flow; every other key is a step id. */
const FLOW_RESERVED: ReadonlySet<string> = new Set(['$start', '$unattended']);

/** The keys of a step entry that are not the step's own options. */
const ENTRY_KEYS: ReadonlySet<string> = new Set(['step', 'on', 'when', 'expect']);

/** A `when:` value: its position and the id it names. */
const WHEN_PATTERN = /^(before|after):(.+)$/su;

/** One registered step, as the registry describes it. */
type RegisteredStep = StepRegistry[string];

/** One step entry of a flow, with the path it was written at. */
interface Entry {
  readonly id: string;
  readonly entry: Readonly<Record<string, unknown>>;
  readonly path: readonly string[];
}

/** The state one flow's build shares across its entries. */
interface FlowState {
  readonly flow: string;
  readonly registry: StepRegistry;
  readonly entries: ReadonlyMap<string, Entry>;
  /** The registered step of each entry's node; absent for an unknown step. */
  readonly specs: Map<string, RegisteredStep>;
  readonly nodes: Map<string, GraphNode>;
  readonly sources: Map<string, NodeSource>;
  readonly edges: GraphEdge[];
  readonly hooks: GraphHook[];
  readonly diagnostics: Diagnostic[];
}

/**
 * The key a node has in {@link Graph.nodes}: the flow name and the step id
 * rendered by `pathToString`, so `main.build`, or `next["a.success"]` for
 * an id holding a dot. Two different pairs never share a key.
 *
 * @param flow - The flow's name.
 * @param id - The step id in that flow.
 * @returns The node key.
 */
export function nodeKey(flow: string, id: string): string {
  return pathToString([flow, id]);
}

/** The registered step called `name`, or `undefined`; never an inherited property. */
function registered(registry: StepRegistry, name: string): RegisteredStep | undefined {
  return Object.hasOwn(registry, name)
    ? registry[name]
    : undefined;
}

/** The node for a registered step, or for an unknown one when `spec` is `undefined`. */
function makeNode(
  flow: string,
  id: string,
  step: string,
  spec: RegisteredStep | undefined,
  options: Record<string, unknown>,
): GraphNode {
  return {
    id,
    flow,
    step,
    outcomes: [...(spec?.outcomes ?? [])],
    options,
    required: spec?.required === true,
    pure: spec?.pure === true,
    interactive: spec?.interactive === true,
  };
}

/**
 * The node for a step entry, and its registered step when there is one;
 * reports `unknown-step` when there is not.
 */
function entryNode(
  state: FlowState,
  { id, entry, path }: Entry,
): { readonly node: GraphNode; readonly spec: RegisteredStep | undefined } {
  const options = Object.fromEntries(Object.entries(entry).filter(([key]) => !ENTRY_KEYS.has(key)));
  const written = entry.step;
  const step = typeof written === 'string'
    ? written
    : id;
  const spec = typeof written === 'string' || written === undefined
    ? registered(state.registry, step)
    : undefined;
  if (spec === undefined) {
    const at = written === undefined
      ? path
      : [...path, 'step'];
    const named = written === undefined
      ? `step entry ${JSON.stringify(id)} runs step ${JSON.stringify(step)}, which is not a registered step`
      : `\`step\` is ${JSON.stringify(written) ?? String(written)}, which is not a registered step`;
    state.diagnostics.push(error('unknown-step', at, named));
  }
  const node = makeNode(state.flow, id, step, spec, options);
  if (typeof entry.expect !== 'string') {
    return { node, spec };
  }
  return { node: { ...node, expect: entry.expect }, spec };
}

/**
 * The node key `id` resolves to in the flow: its step entry, else an
 * implicit node for the registered step of that name. `undefined` after
 * reporting `unknown-step` at `path` when it is neither.
 */
function resolve(state: FlowState, id: string, path: readonly string[], what: string): string | undefined {
  const key = nodeKey(state.flow, id);
  if (state.entries.has(id) || state.nodes.has(key)) {
    return key;
  }
  const spec = registered(state.registry, id);
  if (spec === undefined) {
    state.diagnostics.push(
      error(
        'unknown-step',
        path,
        `${what} names ${JSON.stringify(id)}, which is neither a step entry of flow ${JSON.stringify(state.flow)} nor a registered step`,
      ),
    );
    return undefined;
  }
  state.nodes.set(key, makeNode(state.flow, id, id, spec, {}));
  state.sources.set(key, { path, implicit: true });
  return key;
}

/** Report `unknown-outcome` at `path` when `spec` does not declare `outcome`. */
function checkOutcome(
  state: FlowState,
  spec: RegisteredStep | undefined,
  node: GraphNode,
  outcome: string,
  path: readonly string[],
): void {
  if (spec === undefined || spec.outcomes.includes(outcome)) {
    return;
  }
  const declared = spec.outcomes.map((name) => JSON.stringify(name)).join(', ');
  state.diagnostics.push(
    error(
      'unknown-outcome',
      path,
      `step ${JSON.stringify(node.step)} declares no outcome ${JSON.stringify(outcome)}; it declares ${declared || 'none'}`,
    ),
  );
}

/** The `{ to, repeat }` a flattened handler value names, or `undefined` for any other shape. */
function targetOf(value: unknown): { readonly to: string; readonly repeat: boolean | number } | undefined {
  if (typeof value === 'string') {
    return { to: value, repeat: false };
  }
  if (!isPlainObject(value) || typeof value.to !== 'string') {
    return undefined;
  }
  const repeat = typeof value.repeat === 'boolean' || typeof value.repeat === 'number'
    ? value.repeat
    : false;
  return { to: value.to, repeat };
}

/** Check an entry's `when:`, and record its hook when the anchor resolves. */
function buildWhen(state: FlowState, { entry, path }: Entry, key: string, spec: RegisteredStep | undefined): void {
  if (entry.when === undefined) {
    return;
  }
  const at = [...path, 'when'];
  if (spec !== undefined && spec.pure !== true) {
    state.diagnostics.push(
      error('impure-when', at, `\`when\` sits on step ${JSON.stringify(state.nodes.get(key)?.step)}, which is not registered as pure`),
    );
  }
  const match = typeof entry.when === 'string'
    ? WHEN_PATTERN.exec(entry.when)
    : null;
  const position = match?.[1];
  const anchorId = match?.[2];
  if ((position !== 'before' && position !== 'after') || anchorId === undefined) {
    return;
  }
  const anchor = resolve(state, anchorId, at, '`when`');
  if (anchor !== undefined) {
    state.hooks.push({ flow: state.flow, node: key, anchor, position });
  }
}

/** Check an entry's `expect`, `when:` and handlers, and build its hook and edges. */
function buildEntry(state: FlowState, item: Entry): void {
  const key = nodeKey(state.flow, item.id);
  const node = state.nodes.get(key);
  if (node === undefined) {
    return;
  }
  const known = state.specs.get(key);
  buildWhen(state, item, key, known);
  if (node.expect !== undefined) {
    checkOutcome(state, known, node, node.expect, [...item.path, 'expect']);
  }
  if (!isPlainObject(item.entry.on)) {
    return;
  }
  for (const [outcome, value] of Object.entries(item.entry.on)) {
    const target = targetOf(value);
    if (target === undefined) {
      continue;
    }
    const at = [...item.path, 'on', outcome];
    checkOutcome(state, known, node, outcome, at);
    const to = resolve(state, target.to, at, `the handler on ${JSON.stringify(outcome)}`);
    if (to !== undefined) {
      state.edges.push({ from: key, outcome, to, repeat: target.repeat });
    }
  }
}

/** The node key the flow starts at, or `''` when it has nothing to start at. */
function startOf(state: FlowState, flow: Readonly<Record<string, unknown>>): string {
  if (typeof flow.$start === 'string') {
    return resolve(state, flow.$start, ['flows', state.flow, '$start'], '`$start`') ?? '';
  }
  const [first] = state.entries.keys();
  return first === undefined
    ? ''
    : nodeKey(state.flow, first);
}

/** The step entries of a flow, in declaration order, with their paths. */
function entriesOf(
  name: string,
  flow: Readonly<Record<string, unknown>>,
  paths: Readonly<Record<string, readonly string[]>> | undefined,
): Map<string, Entry> {
  const items = Object.entries(flow).flatMap(([id, entry]): [string, Entry][] => {
    if (FLOW_RESERVED.has(id) || !isPlainObject(entry)) {
      return [];
    }
    return [[id, { id, entry, path: paths?.[id] ?? ['flows', name, id] }]];
  });
  return new Map(items);
}

/** Build one flow into the shared node, source, edge, hook and diagnostic lists. */
function buildFlow(
  name: string,
  flow: Readonly<Record<string, unknown>>,
  paths: Readonly<Record<string, readonly string[]>> | undefined,
  registry: StepRegistry,
  diagnostics: Diagnostic[],
): { readonly state: FlowState; readonly summary: FlowSummary } {
  const entries = entriesOf(name, flow, paths);
  const state: FlowState = {
    flow: name,
    registry,
    entries,
    specs: new Map(),
    nodes: new Map(),
    sources: new Map(),
    edges: [],
    hooks: [],
    diagnostics,
  };
  for (const item of entries.values()) {
    const key = nodeKey(name, item.id);
    const { node, spec } = entryNode(state, item);
    state.nodes.set(key, node);
    if (spec !== undefined) {
      state.specs.set(key, spec);
    }
    state.sources.set(key, { path: item.path, implicit: false });
  }
  const start = startOf(state, flow);
  for (const item of entries.values()) {
    buildEntry(state, item);
  }
  const summary: FlowSummary = {
    name,
    start,
    unattended: flow.$unattended === true,
    nodes: [...state.nodes.keys()],
  };
  return { state, summary };
}

/**
 * Build the step graph of every flow and report every handler, `when:`,
 * `expect` or `$start` that names a step or an outcome nothing declares,
 * and every `when:` on a step that is not pure.
 *
 * @param flattened - What `flatten` returned: the flows, each handler a
 * step id or a `{ to, repeat }` edge, and the path each entry was written at.
 * @param registry - The host's steps, keyed by step name.
 * @returns The graph with every `when:` placement in `graph.hooks`, where
 * each node came from, and the `unknown-step`, `unknown-outcome` and `impure-when` errors, each
 * at a path rooted at `flows`.
 */
export function build(
  flattened: Pick<FlattenResult, 'flows' | 'paths'>,
  registry: StepRegistry,
): BuildResult {
  const diagnostics: Diagnostic[] = [];
  const built = Object.entries(flattened.flows).flatMap(([name, flow]) => (isPlainObject(flow)
    ? [buildFlow(name, flow, flattened.paths[name], registry, diagnostics)]
    : []));
  const states = built.map((item) => item.state);
  return {
    graph: {
      nodes: Object.fromEntries(states.flatMap((state) => [...state.nodes])),
      edges: states.flatMap((state) => state.edges),
      hooks: states.flatMap((state) => state.hooks),
      flows: Object.fromEntries(built.map((item) => [item.summary.name, item.summary])),
    },
    sources: Object.fromEntries(states.flatMap((state) => [...state.sources])),
    diagnostics,
  };
}
