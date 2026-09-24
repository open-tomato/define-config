/**
 * Diagnostics: the one shape every stage of the library (merge, validate,
 * resolveGraph, the loader) reports its problems in.
 *
 * @module
 */

/**
 * Every code the library emits, as a readonly tuple. Codes are stable
 * strings: a host may match on them, print them, or surface them as lint
 * squiggles.
 */
export const DIAGNOSTIC_CODES = [
  'duplicate-key',
  'required-dropped',
  'handler-conflict',
  'unknown-step',
  'unknown-outcome',
  'impure-when',
  'cycle',
  'interactive-unattended',
  'unreachable',
  'schema',
  'load-failed',
] as const;

/** Union of every stable diagnostic code in {@link DIAGNOSTIC_CODES}. */
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

/** Severity of a diagnostic: `error` blocks, `warn` informs. */
export type DiagnosticLevel = 'error' | 'warn';

/** One problem found while merging, validating, resolving or loading. */
export interface Diagnostic {
  /** Severity: `error` or `warn`. */
  readonly level: DiagnosticLevel;
  /** Stable machine-readable code. */
  readonly code: DiagnosticCode;
  /** Key path to the offending value, outermost key first. */
  readonly path: readonly string[];
  /** Human-readable description of the problem. */
  readonly message: string;
  /** Zero-based index of the entry at fault, where one entry is at fault. */
  readonly entry?: number;
}

/** Optional fields accepted by the {@link error} and {@link warn} constructors. */
export interface DiagnosticOptions {
  /** Zero-based index of the entry at fault. */
  readonly entry?: number;
}

const ROOT_PATH = '(root)';
const PLAIN_SEGMENT = /^[^.[\]"]+$/;

/**
 * Render a key path for humans: plain segments are dot-joined (`a.x`);
 * a segment that is empty or contains `.`, `[`, `]` or `"` is written as a
 * JSON-quoted bracket (`a["b.c"]`) so the rendering stays unambiguous. The
 * empty path renders as `(root)`.
 *
 * @param path - Key path, outermost key first.
 * @returns The rendered path.
 */
export function pathToString(path: readonly string[]): string {
  if (path.length === 0) {
    return ROOT_PATH;
  }
  return path
    .map((segment, index) => {
      if (!PLAIN_SEGMENT.test(segment)) {
        return `[${JSON.stringify(segment)}]`;
      }
      if (index === 0) {
        return segment;
      }
      return `.${segment}`;
    })
    .join('');
}

function make(
  level: DiagnosticLevel,
  code: DiagnosticCode,
  path: readonly string[],
  message: string,
  options: DiagnosticOptions,
): Diagnostic {
  const base = { level, code, path: [...path], message };
  if (options.entry === undefined) {
    return base;
  }
  return { ...base, entry: options.entry };
}

/**
 * Build an `error`-level diagnostic. The path is copied, so later changes to
 * the caller's array do not reach the diagnostic.
 *
 * @param code - Stable diagnostic code.
 * @param path - Key path to the offending value.
 * @param message - Human-readable description.
 * @param options - Optional `entry` index of the entry at fault.
 * @returns A new diagnostic; `entry` is present only when given.
 */
export function error(
  code: DiagnosticCode,
  path: readonly string[],
  message: string,
  options: DiagnosticOptions = {},
): Diagnostic {
  return make('error', code, path, message, options);
}

/**
 * Build a `warn`-level diagnostic. The path is copied, so later changes to
 * the caller's array do not reach the diagnostic.
 *
 * @param code - Stable diagnostic code.
 * @param path - Key path to the offending value.
 * @param message - Human-readable description.
 * @param options - Optional `entry` index of the entry at fault.
 * @returns A new diagnostic; `entry` is present only when given.
 */
export function warn(
  code: DiagnosticCode,
  path: readonly string[],
  message: string,
  options: DiagnosticOptions = {},
): Diagnostic {
  return make('warn', code, path, message, options);
}
