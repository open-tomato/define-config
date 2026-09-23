/**
 * `@open-tomato/define-config`: typed config arrays with an id-keyed merge,
 * `$replace`, Standard Schema validation and outcome-typed step graphs.
 *
 * The public surface is these functions and the types they take and
 * return:
 *
 * - {@link defineConfig} types a config file's entries;
 * - {@link merge} folds entries into one value;
 * - {@link validate} and {@link validateSections} run Standard Schema V1
 *   schemas over it;
 * - {@link resolveGraph} turns its `flows` section into a step graph;
 * - {@link createLoader} finds, reads, merges, validates and resolves the
 *   config files of each layer.
 *
 * @packageDocumentation
 */

export type { Diagnostic, DiagnosticCode } from './diagnostics';
export type {
  FlowEntry,
  Graph,
  GraphEdge,
  GraphNode,
  StepEntry,
  StepRegistry,
} from './graph/types';
export type { LoaderOptions, LoadResult } from './loader';
export type { MergeOptions, MergeResult } from './merge';
export type { StandardSchemaV1 } from './standard-schema';
export type { ConfigEntry, LayeredEntry } from './types';

export { defineConfig } from './define-config';
export { resolveGraph } from './graph';
export { createLoader } from './loader';
export { merge } from './merge';
export { validate, validateSections } from './validate';
