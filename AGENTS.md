# @open-tomato/define-config — Agent Instructions

This is a **single-package library** for typed config arrays with id-keyed merge, Standard Schema validation, and outcome-typed step graphs. Dependency-free, fully typed, published to npmjs.

**Language:** TypeScript · **Runtime:** Bun

## Package Layout

```text
src/
├── index.ts                   # Entry point (re-exports all public symbols)
├── define-config.ts           # Root config entry type
├── diagnostics.ts             # Diagnostic codes (with tests)
├── provenance.ts              # Entry provenance tracking (with tests)
├── standard-schema.ts         # Standard Schema plugin (with tests)
├── types.ts                   # Shared type definitions (with tests)
├── validate.ts                # Input validation helpers (with tests)
├── merge/
│   ├── index.ts               # Public merge() export
│   ├── apply.ts               # Apply entry to accumulator
│   ├── duplicates.ts          # Duplicate key detection
│   ├── plain-object.ts        # Plain object identification
│   ├── required.ts            # Required field checks
│   └── <module>.test.ts       # Colocated unit tests
├── graph/
│   ├── index.ts               # Public resolveGraph() export
│   ├── build.ts               # Build step graph
│   ├── cycles.ts              # Cycle detection
│   ├── flatten.ts             # Flatten nested steps
│   ├── normalise.ts           # Normalize flow/step names
│   ├── reachability.ts        # Reachability analysis
│   ├── runner.ts              # Graph execution (unattended)
│   ├── successors.ts          # Find successor nodes
│   ├── types.ts               # Graph-specific types
│   ├── walk.ts                # Graph traversal
│   └── <module>.test.ts       # Colocated unit tests
├── loader/
│   ├── index.ts               # Public createLoader() export
│   ├── lookup.ts              # Lookup library entries
│   ├── read.ts                # Read and parse YAML/JSON
│   ├── reload.ts              # Dynamic reload capability
│   ├── fixtures/acceptance/   # Acceptance test data
│   └── <module>.test.ts       # Colocated unit tests
└── digest/
    ├── canonicalize.ts        # Canonicalize config structure
    ├── digest.ts              # Generate content digests
    └── <module>.test.ts       # Colocated unit tests

scripts/
├── gates.ts                   # Run all linting/test gates
├── pack-check.ts              # Verify npm pack contents
├── reload-node.mjs            # Node.js reload verification
└── <script>.test.ts           # Colocated unit tests

context/
└── packaging.md               # Pack validation reference

dist/                          # Built output (generated, not tracked)
├── index.js                   # ESM bundle
└── index.d.ts                 # TypeScript declarations
```

Files stay under 800 lines; split before a file nears the cap. All exported symbols carry TSDoc (function signatures, interface fields, type descriptions).

## Gates

Run `bun run gates` before reporting done. This command removes `dist/`, runs each gate in
sequence (lint, check-types, test, build, check-pack, check-node), and stops at the first
non-zero exit with that exit code. CI runs exactly this command. For a fast inner loop
during development, `bun run <gate>` stays available to run a single gate.

| Gate | Purpose |
|------|---------|
| lint | ESLint style enforcement (single quotes, semicolons, 2-space indent, trailing commas, import type first, alphabetized import groups). Runs over `src/`, `scripts/`, and root-level files; ignores `dist/`, `node_modules/`, `.claude/`, `.rafa/`. `.md` files get `markdown/recommended` over their Markdown structure, and the `markdown/markdown` processor (wrapped in `eslint.config.mjs` so the file itself is still linted as Markdown) turns each fence into a virtual child such as `README.md/0.ts`: `ts` and `js` fences get the TypeScript rule set, and a fence in any other language is not linted. Inside a fence `@open-tomato/define-config` is exempt from `import/no-unresolved` and sorts as an internal import, so the result does not depend on whether `dist/` exists. Lint parses and style-checks README examples but does not type-check them; for that, extract each block and run `tsc` against `src/index.ts` (use a non-dot temp dir; `tsc` include globs skip dot-directories). |
| check-types | TypeScript strict mode (includes `*.test.ts` files for assertion type precision). Every `@ts-expect-error` in a test is a real type assertion. |
| test | Bun test runner (AAA pattern: Arrange, Act, Assert). Discovers and runs `**/*.test.ts` files in parallel. |
| build | ESM bundle + declarations (outputs to `dist/`). Removes `dist/`, bundles to ESM, and emits TypeScript declarations. `tsconfig.build.json` excludes `src/**/*.test.ts` and `src/**/fixtures/**`, so neither test files nor `.ts` files under `src/loader/fixtures/` get declarations in `dist/`; tests still compile under `tsconfig.json`. |
| check-pack | Asserts the required files are in the pack, that the pack holds nothing outside the allow-list (`package.json`, `README.md`, `LICENSE`, `NOTICE`, `dist/index.js`, and each `dist/**/*.d.ts` whose `src/**/*.ts` module is neither a `*.test.ts` file nor under a `fixtures/` directory), and that the manifest has no `dependencies`. It names each path outside the allow-list. Before testing it with a planted file, read [context/packaging.md](context/packaging.md). Runs `bun pm pack --dry-run`, which executes `prepack` (i.e., `bun run build`) itself, so it checks a fresh build. |
| check-node | Runs `scripts/reload-node.mjs` under `node` against an already built `dist/`; it does not build. It loads a `rafa.config.mjs` in a `mkdtemp` directory with `reload: true`, rewrites it from `{ port: 8000 }` to `{ port: 9000 }` and loads again, then repeats with `reload` off in a second directory as the control. It exits 0 only when the reloading second load reads `9000` and the control's reads `8000`, and 1 naming each mismatch otherwise. The script loads `dist/index.js` with `import()` at run time, not a static import, because lint runs over source before any build; run without a built `dist/` it exits 1 saying so. It needs a real Node on `PATH`, not bun's stand-in: with no Node installed, `bun run` puts a `node` that is bun on `PATH`, so the script exits 1 when it finds itself under bun, and `bun run gates` asks the `node` it finds whether it is bun before counting it. When `node` is not on `PATH`, it prints `check-node: skipped (no node on PATH)` and carries on, except under `CI=true`, where it fails the run instead. |

## ESLint Style Law for Agent Sessions

**Style is enforced by ESLint.** Write code, run `bun run lint`, and take the ordering and fixes from the message. The config is in `eslint.config.mjs` and `sharedRules.mjs` (copied from open-tomato/rafa, trimmed to library scope).

### Style Rules Summary

| Rule | Value | Purpose |
|------|-------|---------|
| Quotes | single | String literals use single quotes |
| Semicolons | always | Every statement ends with `;` |
| Indent | 2 spaces | 1 indent level = 2 spaces; switch cases +1 |
| Trailing commas | always-multiline | Multiline objects/arrays end with `,` |
| Line breaks | 1 max between statements | No blank line runs; 1 blank at EOF |
| Import order | type, builtin, external, internal, parent, sibling, index | Groups alphabetized, newlines between groups |
| Arrow functions | beside | Implicit returns on same line as `=>` |
| Chained calls | newline per call (depth ≥ 3) | Long chains split; 2-deep chains stay on one line |
| Tabs | never | Spaces only |
| `var` | never | Use `let` or `const` |

**No `console.log` in production code.** Tests may use it; linting does not block it there.

## Reserved Keys in Config Objects

The library recognizes these keys with special semantics. See [README.md#merge](README.md#merge) for the full rules.

### Merge-time keys
- **`$replace: true`** — Inside a keyed map, replaces that entire subtree with the new value. On the entry itself,
  replaces the whole value merged so far. Only the form `{ $replace: true }` replaces; any other value for the key
  is a type error (caught at compile time by `defineConfig`). Source: `src/merge/apply.ts`
- **`<key>: false`** — Removes the key from the merged result. A map entry set to `false` yields a `remove` provenance
  record. Removing a key the host lists in `required` yields a `required-dropped` error. Source: `src/merge/apply.ts`
- **`$layer`** — On a top-level entry only, labels its layer for duplicate detection and provenance tracking. Must be
  a string; any other type throws `TypeError`. The value is recorded on each `ProvenanceRecord.layer` but never in
  the merged value. Each entry's `$layer` is set per source by the loader, overriding any `$layer` the file wrote.
  Source: `src/merge/apply.ts`

### Flow-time keys (in step graphs)
- **`$start`** — Names the entry step (the first step a flow executes); every flow has exactly one.
- **`$unattended: true`** — On a flow root, marks it as unattended (can run without user input; default is attended).
- **All other keys** — Define step entries and their wiring (target step names, data payloads, etc.).

## Test Coverage & TDD

Minimum coverage: **80%**. Use Bun's test runner with the AAA (Arrange-Act-Assert) pattern:

```ts
import { test, expect } from 'bun:test';

import { merge } from '@open-tomato/define-config';

test('a later entry replaces a scalar set by an earlier one', () => {
  // Arrange
  const entries = [{ port: 8000 }, { port: 9000 }];

  // Act
  const result = merge(entries);

  // Assert
  expect(result.value).toEqual({ port: 9000 });
});
```

Write tests first (RED), implement to pass (GREEN), refactor (IMPROVE), verify coverage. Use `fast-check` for property-based testing where appropriate.

## Publishing

- **Registry:** npmjs (https://registry.npmjs.org/)
- **Scope:** `@open-tomato`
- **Access:** public
- **Sideeffects:** `["./src/index.ts"]` — every published `dist/` file is
  side-effect-free (pure module, tree-shaking safe). The one listed path is
  the build entry, and it is not published: with `"sideEffects": false`,
  `bun build` 1.3.14 treats the entry as dead and emits a `dist/index.js`
  that exports names it never defines. `src/index.test.ts` catches this.
- **Package entrypoint:** `./dist/index.js`
- **Types:** `./dist/index.d.ts`
- **Files included:** `dist/` and `NOTICE`
- **No runtime dependencies** — ever. Only dev dependencies allowed.

## Agent Integration

**Agents to use proactively:**
- **tdd-guide** — New features or bug fixes (write tests first)
- **code-reviewer** — After writing code (check quality, security, patterns)
- **security-reviewer** — Before commits (validate no hardcoded secrets, input validation)
- **build-error-resolver** — When `bun run build` or `bun run check-types` fails

**Agent-harness prose** — `.claude/agents/` and `.claude/skills/` are not lint targets; they are vendored from the umbrella and named here for reference.
