# @open-tomato/define-config — Agent Instructions

This is a **single-package library** for typed config arrays with id-keyed merge, Standard Schema validation, and outcome-typed step graphs. Dependency-free, fully typed, published to npmjs.

**Version:** 0.1.0 · **Language:** TypeScript · **Runtime:** Bun

## Package Layout

```text
src/
├── <area>/
│   ├── <module>.ts          # Exported module with TSDoc
│   └── <module>.test.ts     # Colocated unit tests (bun test)
index.ts                      # Main entry point (re-exports all public symbols)

dist/
├── index.js                  # ESM output (built)
├── index.d.ts                # TypeScript declarations

test outputs:
├── .bun/                     # Bun runtime cache
└── node_modules/             # Gitignored dev dependencies
```

Files stay under 800 lines; split before a file nears the cap. All exported symbols carry TSDoc (function signatures, interface fields, type descriptions).

## Four Gates (Verification)

All gates must pass before reporting done. Run each explicitly and read its exit code and summary line; never grep a capture for "fail":

```sh
# 1. Lint: ESLint style enforcement (single quotes, semicolons, 2-space indent,
#    trailing commas, import type first, alphabetized import groups)
bun run lint

# 2. Check Types: TypeScript strict mode (includes *.test.ts files for assertion
#    type precision)
bun run check-types

# 3. Test: Bun test runner (AAA pattern: Arrange, Act, Assert)
bun test

# 4. Build: ESM bundle + declarations (outputs to dist/)
bun run build
```

**Gate behavior notes:**
- `bun run lint` runs ESLint over `src/`, `scripts/`, and root-level files. Ignores `dist/`, `node_modules/`, `.claude/`, `.rafa/`. `.md` files get `markdown/recommended` with no code-block processor, so fenced `ts` blocks in `README.md` are never parsed: no gate checks README examples. Verify them by extracting each block and running `tsc` against `src/index.ts` (use a non-dot temp dir; `tsc` include globs skip dot-directories).
- `bun run check-types` includes test files; `@ts-expect-error` in a test is a real type assertion.
- `bun test` discovers and runs `**/*.test.ts` files in parallel.
- `bun run build` removes `dist/`, bundles to ESM, and emits TypeScript declarations. `tsconfig.build.json` excludes only `src/**/*.test.ts`, so `.ts` files under `src/loader/fixtures/` also get declarations in `dist/` and ship in the tarball.
- `bun run check-pack` asserts the required files are in the pack and the manifest has no `dependencies`; it does not refuse unexpected files, so it passes with the fixture declarations above.

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

The library recognizes these keys with special semantics:

### Merge-time keys
- **`$replace: true`** — Inside a keyed map, replaces that entire subtree with the new value, ignoring defaults beneath it.
- **`<key>: false`** — At a map entry, marks that key for removal (deletes it from the merged result).
- **`$layer`** — On a top-level entry, labels its layer (metadata, not processed by the merge engine; visible in diagnostics).

### Flow-time keys (in step graphs)
- **`$start`** — Names the entry step (the first step a flow executes); every flow has exactly one.
- **`$unattended: true`** — On a flow root, marks it as unattended (can run without user input; default is attended).
- **All other keys** — Define step entries and their wiring (target step names, data payloads, etc.).

## Test Coverage & TDD

Minimum coverage: **80%**. Use Bun's test runner with the AAA (Arrange-Act-Assert) pattern:

```ts
import { test, expect } from 'bun:test';

test('descriptive test name', () => {
  // Arrange
  const input = { /* setup */ };

  // Act
  const result = myFunction(input);

  // Assert
  expect(result).toEqual(expected);
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
