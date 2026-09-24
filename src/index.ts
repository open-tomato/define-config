/**
 * `@open-tomato/define-config`: typed config arrays with an id-keyed merge,
 * `$replace`, Standard Schema validation and outcome-typed step graphs.
 *
 * The public surface is these functions and the types they take and
 * return:
 *
 * - {@link defineConfig} types a config file's entries;
 * - {@link merge} folds entries into one value;
 * - {@link provenanceOf} reads which entries touched one key path of a
 *   merge result;
 * - {@link validate} and {@link validateSections} run Standard Schema V1
 *   schemas over it;
 * - {@link resolveGraph} turns its `flows` section into a step graph;
 * - {@link next}, {@link hooksOf}, {@link reachable} and {@link walkOrder}
 *   read a resolved graph: an outcome's target, a node's hooks, the nodes
 *   reached from a flow's start, and the order a flow's nodes are placed in;
 * - {@link createLoader} finds, reads, merges, validates and resolves the
 *   config files of each layer;
 * - {@link canonicalize} and {@link digest} write a value as canonical JSON
 *   text and as the `sha256:` digest of that text.
 *
 * @packageDocumentation
 */

export type { Diagnostic, DiagnosticCode } from './diagnostics';
export type {
  FlowEntry,
  FlowSummary,
  Graph,
  GraphEdge,
  GraphHook,
  GraphNode,
  StepEntry,
  StepRegistry,
} from './graph/types';
export type { LoaderOptions, LoadResult } from './loader';
export type { MergeOptions, MergeResult } from './merge';
export type { Provenance, ProvenanceKind, ProvenanceRecord } from './merge/apply';
export type { StandardSchemaV1 } from './standard-schema';
export type { ConfigEntry, LayeredEntry } from './types';

export { canonicalize, CanonicalizeError } from './digest/canonicalize';
export { digest } from './digest/digest';
export { defineConfig } from './define-config';
export { resolveGraph } from './graph';
export { hooksOf, next, reachable, walkOrder } from './graph/walk';
export { createLoader } from './loader';
export { merge } from './merge';
export { provenanceOf } from './provenance';
export { validate, validateSections } from './validate';
