/**
 * `normalise`: the first step of `resolveGraph`. It folds each step entry's
 * sugar handlers into `on`, so the later steps read handlers from `on` only.
 *
 * Rules:
 * - `onTrue`/`onFalse` become outcomes `true`/`false`, `onSuccess`/`onFail`
 *   become `success`/`fail`, and every key of `onChoice` (a map of outcome
 *   name to handler) becomes an outcome of the same name.
 * - an entry carrying `on` beside any sugar key, or two sugar keys naming
 *   one outcome (for example `onTrue` and `onChoice.true`), is a
 *   `handler-conflict` error at the entry's path. The entry keeps its
 *   options and loses every handler: it leaves normalise with no `on` and no
 *   sugar key, so no later step builds an edge from it.
 * - a key counts as present when its value is not `undefined`.
 * - a handler whose value is a plain object carrying `step` is an inline
 *   entry and is normalised the same way, at the path of the key it was
 *   written under (`on.<outcome>`, `onTrue`, `onChoice.<name>`).
 * - `$start`, `$unattended`, any value at a step id that is not a plain
 *   object, a flow that is not a plain object, an `on` or `onChoice` that is
 *   not a plain object: all pass through as they are. Their shape is the
 *   host schema's to check; a non-map `onChoice` contributes no outcome.
 *
 * Nothing is mutated: every entry that changes is a new object.
 *
 * @module
 */

import type { Diagnostic } from '../diagnostics';

import { error } from '../diagnostics';
import { isPlainObject } from '../merge/plain-object';

/** The sugar keys naming a fixed outcome, and the outcome each names. */
const FIXED_SUGAR: Readonly<Record<string, string>> = {
  onTrue: 'true',
  onFalse: 'false',
  onSuccess: 'success',
  onFail: 'fail',
};

/** The sugar key spreading a map of outcome name to handler into `on`. */
const CHOICE_SUGAR = 'onChoice';

/** The reserved keys of a flow; every other key is a step id. */
const FLOW_RESERVED: ReadonlySet<string> = new Set(['$start', '$unattended']);

/** What {@link normalise} returns. */
export interface NormaliseResult {
  /**
   * Every flow, keyed by flow name, with sugar folded into `on`. A flow that
   * is not a plain object is passed through as it was.
   */
  readonly flows: Readonly<Record<string, unknown>>;
  /** One `handler-conflict` error per conflicting entry, in declaration order. */
  readonly diagnostics: readonly Diagnostic[];
}

/** One handler read off an entry: its outcome, value, and the path it was written at. */
interface SourcedHandler {
  readonly outcome: string;
  readonly value: unknown;
  readonly source: readonly string[];
}

/** `true` when `key` is present on `entry` with a value that is not `undefined`. */
function has(entry: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.hasOwn(entry, key) && entry[key] !== undefined;
}

/** `true` for a key `normalise` reads as a handler key: `on` or any sugar key. */
function isHandlerKey(key: string): boolean {
  return key === 'on' || key === CHOICE_SUGAR || Object.hasOwn(FIXED_SUGAR, key);
}

/** The handlers written under a plain-object map, one per key. */
function fromMap(map: unknown, key: string): SourcedHandler[] {
  if (!isPlainObject(map)) {
    return [];
  }
  return Object.entries(map)
    .filter(([, value]) => value !== undefined)
    .map(([outcome, value]) => ({ outcome, value, source: [key, outcome] }));
}

/** The handlers written as sugar on `entry`, in the entry's key order. */
function sugarHandlers(entry: Readonly<Record<string, unknown>>): SourcedHandler[] {
  return Object.keys(entry)
    .filter((key) => has(entry, key))
    .flatMap((key): SourcedHandler[] => {
      if (key === CHOICE_SUGAR) {
        return fromMap(entry[key], key);
      }
      if (!Object.hasOwn(FIXED_SUGAR, key)) {
        return [];
      }
      const outcome = FIXED_SUGAR[key];
      if (outcome === undefined) {
        return [];
      }
      return [{ outcome, value: entry[key], source: [key] }];
    });
}

/** Render a handler's source path for a message: `onTrue`, `onChoice.true`. */
function sourceName(source: readonly string[]): string {
  return source.join('.');
}

/** Why `entry`'s handlers conflict, or `undefined` when they do not. */
function conflictOf(
  entry: Readonly<Record<string, unknown>>,
  sugar: readonly SourcedHandler[],
): string | undefined {
  const sugarKeys = Object.keys(entry).filter((key) => key !== 'on' && isHandlerKey(key) && has(entry, key));
  if (has(entry, 'on') && sugarKeys.length > 0) {
    return `\`on\` sits beside sugar ${sugarKeys.map((key) => `\`${key}\``).join(', ')}`;
  }
  const clashes = sugar.flatMap((handler, index) => {
    const earlier = sugar.slice(0, index).find((other) => other.outcome === handler.outcome);
    if (earlier === undefined) {
      return [];
    }
    return [
      `\`${sourceName(earlier.source)}\` and \`${sourceName(handler.source)}\` both name outcome ${JSON.stringify(handler.outcome)}`,
    ];
  });
  if (clashes.length === 0) {
    return undefined;
  }
  return clashes.join('; ');
}

/** Normalise a handler value: an inline entry is normalised, anything else is kept. */
function normaliseHandler(
  handler: SourcedHandler,
  path: readonly string[],
  diagnostics: Diagnostic[],
): readonly [string, unknown] {
  if (isPlainObject(handler.value) && has(handler.value, 'step')) {
    return [handler.outcome, normaliseEntry(handler.value, [...path, ...handler.source], diagnostics)];
  }
  return [handler.outcome, handler.value];
}

/** The entry's options with `handlers`, each normalised, under `on`. */
function withOn(
  options: readonly (readonly [string, unknown])[],
  handlers: readonly SourcedHandler[],
  path: readonly string[],
  diagnostics: Diagnostic[],
): Readonly<Record<string, unknown>> {
  const on = Object.fromEntries(handlers.map((handler) => normaliseHandler(handler, path, diagnostics)));
  return { ...Object.fromEntries(options), on };
}

/**
 * Normalise one step entry at `path`, pushing any conflict found in it or in
 * its inline entries onto `diagnostics`.
 */
function normaliseEntry(
  entry: Readonly<Record<string, unknown>>,
  path: readonly string[],
  diagnostics: Diagnostic[],
): Readonly<Record<string, unknown>> {
  const options = Object.entries(entry).filter(([key]) => !isHandlerKey(key));
  const sugar = sugarHandlers(entry);
  const conflict = conflictOf(entry, sugar);
  if (conflict !== undefined) {
    diagnostics.push(
      error('handler-conflict', path, `${conflict}; this entry's handlers are dropped`),
    );
    return Object.fromEntries(options);
  }
  if (sugar.length === 0) {
    if (!isPlainObject(entry.on)) {
      return entry;
    }
    return withOn(options, fromMap(entry.on, 'on'), path, diagnostics);
  }
  return withOn(options, sugar, path, diagnostics);
}

/** Normalise every step entry of one flow. */
function normaliseFlow(flow: Readonly<Record<string, unknown>>, name: string, diagnostics: Diagnostic[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(flow).map(([id, value]): [string, unknown] => {
      if (FLOW_RESERVED.has(id) || !isPlainObject(value)) {
        return [id, value];
      }
      return [id, normaliseEntry(value, ['flows', name, id], diagnostics)];
    }),
  );
}

/**
 * Fold every step entry's sugar handlers into `on` and report each entry
 * whose handlers conflict.
 *
 * @param flows - The merged `flows` section: flows keyed by flow name.
 * @returns The normalised flows, and one `handler-conflict` error per
 * conflicting entry, at a path rooted at `flows`
 * (`['flows', '<flow>', '<id>']` for a top-level entry).
 */
export function normalise(flows: Readonly<Record<string, unknown>>): NormaliseResult {
  const diagnostics: Diagnostic[] = [];
  const normalised = Object.fromEntries(
    Object.entries(flows).map(([name, flow]): [string, unknown] => {
      if (!isPlainObject(flow)) {
        return [name, flow];
      }
      return [name, normaliseFlow(flow, name, diagnostics)];
    }),
  );
  return { flows: normalised, diagnostics };
}
