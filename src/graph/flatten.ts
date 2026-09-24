/**
 * `flatten`: the second step of `resolveGraph`. It reads the flows
 * `normalise` returns, where every handler sits under `on`, and lifts each
 * inline entry into a step entry of its own, so the later steps see a flat
 * map of step entries whose handlers only name ids.
 *
 * Rules:
 * - a handler whose value is a plain object carrying `step` is an inline
 *   entry. It becomes a step entry with id `<parent id>.<outcome>`, placed
 *   right after its parent's other inline entries, depth first, and the
 *   handler becomes that id (a string). An inline entry's own inline
 *   entries flatten the same way, so `a` → `success` → `fail` gives
 *   `a.success.fail`.
 * - a handler whose value is a plain object without `step` and with a
 *   string `to` is an edge object. It becomes `{ to, repeat }`: `repeat` is
 *   kept when it is a boolean or a number and is `false` otherwise, and any
 *   other key of the edge object is dropped.
 * - every other handler value (a string id, or a shape that is neither of
 *   the above) is kept as it is; its shape is the host schema's to check.
 * - a generated id that equals an id already in the flow is a
 *   `duplicate-key` error at the path of the handler that wrote the inline
 *   entry. The id written in the flow wins over a generated one, and the
 *   first generated one wins over a later one; the losing inline entry is
 *   dropped with its handler and everything nested in it.
 * - `$start`, `$unattended`, any value at a step id that is not a plain
 *   object, a flow that is not a plain object, and an `on` that is not a
 *   plain object all pass through as they are.
 *
 * Beside the flows, `flatten` returns the path each step entry was written
 * at, so a later step reports a problem in a lifted entry at the path the
 * host wrote it under (`['flows', 'next', 'a', 'on', 'success']`), not at
 * its generated id.
 *
 * Nothing is mutated: every entry that changes is a new object.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';

import { error } from '../diagnostics';

/** An edge object after flattening: the id it goes to and its `repeat`. */
export interface FlatEdge {
  /** The id of the step entry the edge goes to. */
  readonly to: string;
  /**
   * The edge object's `repeat` when it is a boolean or a number, `false`
   * when it is absent or anything else.
   */
  readonly repeat: boolean | number;
}

/** What {@link flatten} returns. */
export interface FlattenResult {
  /**
   * Every flow, keyed by flow name, with inline entries lifted into step
   * entries and edge objects rewritten as {@link FlatEdge}. A flow that is
   * not a plain object is passed through as it was.
   */
  readonly flows: Readonly<Record<string, unknown>>;
  /**
   * For each flow that is a plain object, the path each of its plain-object
   * step entries was written at, keyed by step id.
   */
  readonly paths: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** One `duplicate-key` error per dropped inline entry, in declaration order. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The reserved keys of a flow; every other key is a step id. */
const FLOW_RESERVED: ReadonlySet<string> = new Set(['$start', '$unattended']);

/** One step entry lifted out of a flow, with the path it was written at. */
interface Lifted {
  readonly id: string;
  readonly entry: unknown;
  readonly path: readonly string[];
}

/** The state one flow's flattening shares across its entries. */
interface FlowState {
  /** Every id taken so far: the flow's own ids and each generated id kept. */
  readonly taken: Set<string>;
  readonly diagnostics: Diagnostic[];
}

/** `true` for an object whose prototype is `Object.prototype` or `null`. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** `true` for a handler value that is an inline entry. */
function isInlineEntry(value: unknown): value is Readonly<Record<string, unknown>> {
  return isPlainObject(value) && Object.hasOwn(value, 'step') && value.step !== undefined;
}

/** The {@link FlatEdge} an edge object becomes, or `undefined` when `value` is not one. */
function toFlatEdge(value: unknown): FlatEdge | undefined {
  if (!isPlainObject(value) || typeof value.to !== 'string') {
    return undefined;
  }
  const repeat = typeof value.repeat === 'boolean' || typeof value.repeat === 'number'
    ? value.repeat
    : false;
  return { to: value.to, repeat };
}

/** One handler after flattening: the kept `on` pair, if any, and the entries it lifted. */
interface FlatHandler {
  readonly pair: readonly [string, unknown] | undefined;
  readonly lifted: readonly Lifted[];
}

/** Flatten the handler `value` written on outcome `outcome` of entry `parentId`. */
function flattenHandler(
  parentId: string,
  parentPath: readonly string[],
  outcome: string,
  value: unknown,
  state: FlowState,
): FlatHandler {
  const path = [...parentPath, 'on', outcome];
  if (!isInlineEntry(value)) {
    return { pair: [outcome, toFlatEdge(value) ?? value], lifted: [] };
  }
  const id = `${parentId}.${outcome}`;
  if (state.taken.has(id)) {
    state.diagnostics.push(
      error(
        'duplicate-key',
        path,
        `the inline entry here would take id ${JSON.stringify(id)}, which the flow already has; the inline entry and this handler are dropped`,
      ),
    );
    return { pair: undefined, lifted: [] };
  }
  state.taken.add(id);
  return { pair: [outcome, id], lifted: flattenEntry(id, value, path, state) };
}

/**
 * Flatten the step entry `entry` written at `path` under id `id`: the entry
 * itself first, then every entry lifted out of its handlers, depth first.
 */
function flattenEntry(
  id: string,
  entry: Readonly<Record<string, unknown>>,
  path: readonly string[],
  state: FlowState,
): Lifted[] {
  if (!isPlainObject(entry.on)) {
    return [{ id, entry, path }];
  }
  const handlers = Object.entries(entry.on).map(([outcome, value]) => flattenHandler(id, path, outcome, value, state));
  const on = Object.fromEntries(handlers.flatMap((handler) => (handler.pair === undefined
    ? []
    : [handler.pair])));
  return [{ id, entry: { ...entry, on }, path }, ...handlers.flatMap((handler) => handler.lifted)];
}

/** Flatten one flow, returning it with the path of each of its entries. */
function flattenFlow(
  flow: Readonly<Record<string, unknown>>,
  name: string,
  diagnostics: Diagnostic[],
): { readonly flow: Readonly<Record<string, unknown>>; readonly paths: Readonly<Record<string, readonly string[]>> } {
  const state: FlowState = { taken: new Set(Object.keys(flow)), diagnostics };
  const lifted = Object.entries(flow).flatMap(([id, value]): Lifted[] => {
    if (FLOW_RESERVED.has(id) || !isPlainObject(value)) {
      return [{ id, entry: value, path: [] }];
    }
    return flattenEntry(id, value, ['flows', name, id], state);
  });
  return {
    flow: Object.fromEntries(lifted.map((item) => [item.id, item.entry])),
    paths: Object.fromEntries(lifted.filter((item) => item.path.length > 0).map((item) => [item.id, item.path])),
  };
}

/**
 * Lift every inline entry into a step entry of its own and rewrite every
 * edge object as `{ to, repeat }`, recursively.
 *
 * @param flows - The flows `normalise` returned: flows keyed by flow name,
 * each entry's handlers under `on`.
 * @returns The flattened flows, the path each step entry was written at,
 * and one `duplicate-key` error per inline entry whose generated id was
 * already taken, at the path of the handler that wrote it
 * (`['flows', '<flow>', '<id>', 'on', '<outcome>']`).
 */
export function flatten(flows: Readonly<Record<string, unknown>>): FlattenResult {
  const diagnostics: Diagnostic[] = [];
  const results = Object.entries(flows).map(([name, flow]) => {
    if (!isPlainObject(flow)) {
      return { name, flow, paths: undefined };
    }
    return { name, ...flattenFlow(flow, name, diagnostics) };
  });
  return {
    flows: Object.fromEntries(results.map((result) => [result.name, result.flow])),
    paths: Object.fromEntries(results.flatMap((result) => (result.paths === undefined
      ? []
      : [[result.name, result.paths]]))),
    diagnostics,
  };
}
