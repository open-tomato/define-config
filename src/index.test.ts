import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, test } from 'bun:test';

const ROOT = resolve(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');

/** Longest a `bun run build` may take before the suite gives up on it. */
const BUILD_TIMEOUT_MS = 120_000;

/** The functions the package exports, and nothing else at runtime. */
const FUNCTIONS = [
  'createLoader',
  'defineConfig',
  'hooksOf',
  'merge',
  'next',
  'provenanceOf',
  'reachable',
  'resolveGraph',
  'validate',
  'validateSections',
  'walkOrder',
];

/** The types the package declares beside the functions. */
const TYPES = [
  'ConfigEntry',
  'Diagnostic',
  'DiagnosticCode',
  'FlowEntry',
  'FlowSummary',
  'Graph',
  'GraphEdge',
  'GraphHook',
  'GraphNode',
  'LayeredEntry',
  'LoadResult',
  'LoaderOptions',
  'MergeOptions',
  'MergeResult',
  'Provenance',
  'ProvenanceKind',
  'ProvenanceRecord',
  'StandardSchemaV1',
  'StepEntry',
  'StepRegistry',
];

/** One `export { … } from '…'` or `export type { … } from '…'` clause. */
interface ReExport {
  readonly isTypeOnly: boolean;
  readonly names: readonly string[];
  readonly from: string;
}

const RE_EXPORT = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** Read every re-export clause of a declaration file's text. */
function parseReExports(text: string): ReExport[] {
  return [...text.matchAll(RE_EXPORT)].map((match) => ({
    isTypeOnly: match[1] !== undefined,
    names: (match[2] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== ''),
    from: match[3] ?? '',
  }));
}

/** The declaration file a relative `from` specifier in `dist/` points at. */
function declarationFile(from: string): string {
  const base = join(DIST, from);
  return existsSync(`${base}.d.ts`)
    ? `${base}.d.ts`
    : join(base, 'index.d.ts');
}

/** The names of the value (not type-only) re-exports. */
function valueNames(clauses: readonly ReExport[]): string[] {
  return clauses.filter((clause) => !clause.isTypeOnly).flatMap((clause) => clause.names);
}

const sorted = (names: Iterable<string>): string[] => [...names].sort();

let runtime: Record<string, unknown> = {};
let declarations = '';

beforeAll(async () => {
  const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  if (build.exitCode !== 0) {
    throw new Error(`bun run build exited ${build.exitCode}:\n${build.stderr.toString()}`);
  }
  runtime = await import(pathToFileURL(join(DIST, 'index.js')).href);
  declarations = readFileSync(join(DIST, 'index.d.ts'), 'utf8');
}, BUILD_TIMEOUT_MS);

describe('dist/index.js', () => {
  test('exports exactly the seven functions', () => {
    expect(sorted(Object.keys(runtime))).toEqual(sorted(FUNCTIONS));
  });

  test('each export is a function', () => {
    for (const name of FUNCTIONS) {
      expect(typeof runtime[name]).toBe('function');
    }
  });

  test('the bundled defineConfig is the identity on its entries', () => {
    // Arrange
    const defineConfig = runtime['defineConfig'] as (entries: unknown[]) => unknown[];
    const entries = [{ a: 1 }];

    // Act / Assert
    expect(defineConfig(entries)).toBe(entries);
  });
});

describe('dist/index.d.ts', () => {
  test('declares the functions as value exports and every public type as a type export', () => {
    // Arrange
    const clauses = parseReExports(declarations);

    // Act
    const values = valueNames(clauses);
    const types = clauses.filter((clause) => clause.isTypeOnly).flatMap((clause) => clause.names);

    // Assert
    expect(sorted(values)).toEqual(sorted(FUNCTIONS));
    expect(sorted(types)).toEqual(sorted(TYPES));
  });

  test('every re-exported name is declared, not merely named, by the file it comes from', () => {
    for (const clause of parseReExports(declarations)) {
      const file = declarationFile(clause.from);
      const text = readFileSync(file, 'utf8');
      for (const name of clause.names) {
        const declaration = new RegExp(`^export (?:declare )?(?:interface|type|function|namespace) ${name}\\b`, 'm');
        expect({ file, name, declared: declaration.test(text) })
          .toEqual({ file, name, declared: true });
      }
    }
  });

  test('the clause reader would catch a missing or extra name (control)', () => {
    // Arrange
    const trimmed = declarations.replace('{ validate, validateSections }', '{ validate }');
    const widened = `${declarations}\nexport { load } from './loader';\n`;

    // Act
    const namesOf = (text: string): string[] => sorted(valueNames(parseReExports(text)));

    // Assert
    expect(namesOf(trimmed)).not.toEqual(sorted(FUNCTIONS));
    expect(namesOf(widened)).not.toEqual(sorted(FUNCTIONS));
  });
});
