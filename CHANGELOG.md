# Changelog

One section per released version, newest first, headed `## <version> — <date>, <release title>`. All additions to the public surface carry a change note.

## 0.5.2 — 2026-09-24, repository health for a public npm package

- **documentation**: `README.md` carries CI status, npm version and npm provenance badges under its heading, and states the Node 22 floor under `## Install`.
- **package**: the published manifest declares `engines.node` `>=22`; releases are published from CI by pushing a `v<version>` tag, which `.github/workflows/publish.yml` publishes with npm trusted publishing and `--provenance`, with no npm token.

## 0.5.1 — 2026-09-24, one `bun run gates` command that CI and agents both run

- **tooling**: `bun run gates` removes `dist/` and runs `lint`, `check-types`, `test`, `build`, `check-pack` and `check-node` in that order, one line per gate, stopping at the first non-zero exit with that code; `check-node` no longer builds on its own and is skipped with a printed line when no real `node` is on `PATH`, except under `CI=true`, where that fails the run; CI runs only `bun run gates`, and `AGENTS.md` names it as the one command to run before reporting done.

## 0.5.0 — 2026-09-24, reload a changed config file within one process

- **createLoader**: `LoaderOptions.reload` (default `false`) makes `load` read a `.ts`, `.mts`, `.mjs` or `.js` config file's bytes and import it again only when they changed, so a host that keeps one process across edits sees the edit on its next `load` and an unchanged file keeps its cached module; modules the config file imports stay cached, each distinct content stays in the runtime's module registry for the process's life, a file that cannot be read is `load-failed`, and a non-boolean `reload` is a `TypeError`.
- Documentation: README's `## Module Cache` section is rewritten around `reload`, naming its two limits and showing a `load` before and after an edit, and the `## createLoader` options paragraph links to it.

## 0.4.0 — 2026-09-24, canonicalize and digest — a byte-stable text of a config or graph, and its hash

- **digest**: `canonicalize`, `digest` and `CanonicalizeError` are exported from the package entry: `canonicalize` writes any value as byte-stable JSON text (keys sorted by UTF-16 code unit, `-0` as `0`, `Date`, `Map`, `Set` and functions as `$date`, `$map`, `$set` and `$function` tags, a function by name and never by body, a shared reference written twice), `digest` returns `sha256:` and the hex SHA-256 of that text, synchronously from `node:crypto`, and both throw a `CanonicalizeError` with `code: 'cyclic-value' | 'not-canonical'` and the `path` to the offending value; README's new `## canonicalize and digest` section digests `result.value`, `result.config` or `result.graph`, never a whole result.

## 0.3.0 — 2026-09-24, Graph helpers a runner drives a resolved graph with

- **graph**: `next`, `hooksOf`, `reachable` and `walkOrder` are exported from the package entry, pure functions a runner steps through a resolved `Graph` with: `next` answers the node an outcome leads to (`undefined` for a declared outcome with no handler, a `RangeError` for an unknown node or an undeclared outcome), `hooksOf` the `before` and `after` hooks of a node in declaration order, `reachable` every node a flow reaches from its `start` (`repeat: true` edges and hooks included), and `walkOrder` the depth-first order a flow's nodes are placed in, which never follows a `repeat: true` edge; README's new `### Driving a graph` section drives a flow with them.

## 0.2.1 — 2026-09-24, resolveGraph returns its `when:` placements as `graph.hooks`

- **resolveGraph**: returns every resolved `when:` placement as `graph.hooks`, a `GraphHook[]` in declaration order (and so does `load`); a hook is not an edge, and a host that deep-equals a whole `Graph` sees a new `hooks` key.
- **types**: `GraphHook` and `FlowSummary` are exported as types from the package entry.

## 0.2.0 — 2026-09-24, define-config 0.2.0 — expose provenance, type root-level `$replace`

- **merge**: returns `provenance`, a frozen map from each dot-joined key path to the records of the entries that set, removed or replaced it, in entry order; a record carries the entry's index and, when the entry has one, its `$layer`.
- **provenanceOf**: reads one key path's records out of a `merge` or `load` result, taking the path dot-joined or as a key array and returning `[]` for a path no entry touched; the `Provenance`, `ProvenanceKind` and `ProvenanceRecord` types are exported beside it.
- **createLoader**: `load` returns the merge's `provenance`, and each of its `sources` names `entries: [from, to]`, the range of merged entries its file contributed (empty for a file that failed to read), so a record traces back to its config file.
- **LayeredEntry**: accepts `$replace: true` at the root beside `$layer`, over both named-key and keyed-map roots (#18).

## 0.1.1 — 2026-09-24, define-config 0.1.1 — spec-true types, clean tarball, linted README

- **resolveGraph** types: `EdgeTarget.repeat` accepts only `true`, so `repeat: false`, a number or a string is a type error instead of silently leaving the loop unmarked; `StepEntry.onChoice` is typed as a map of choice to step id or edge object; `FlowEntry` accepts `$start` and `$unattended` beside step entries, types step ids as strings starting with a printable ASCII character other than `$` (so a misspelt `$strat` is caught), and refuses a step id set to a string or a boolean.
- **LayeredEntry**: accepts `$layer` on a config whose root is a keyed map; root ids there must start with a printable ASCII character other than `$`.
- Packaging: the published package no longer ships type declarations for internal test fixtures.
- Documentation: README code examples follow the project's lint style (import order, trailing commas, split chained calls, printed loader results), and the README opening and the `package.json` description describe the package in three sentences.

## 0.1.0 — 2026-09-23, Initial release

- **defineConfig**: types config file entries at authoring time; exists for its parameter type to let an editor flag a wrong key or a `$replace` on a scalar while entries are written.
- **merge**: folds config entries left to right with full merge semantics (scalars replace, arrays replace whole, maps merge recursively, `false` removes, `$replace` discards earlier entries). Checks for duplicates at the same layer and missing required paths.
- **validate** and **validateSections**: run Standard Schema V1 schemas over a config value and report every validation issue as a diagnostic.
- **resolveGraph**: resolve the merged `flows` section into a step graph, validating step and outcome references, detecting handler conflicts and unattended-flow violations, and flagging cycles unless they are marked `repeat: true`.
- **createLoader**: finds, reads, merges, validates and resolves the config files of each layer; reads `.ts`, `.mts`, `.mjs` and `.js` through `import()` and `.json` through `JSON.parse`, hands the text of any other extension to the host's `loaders` reader for it, then runs `merge`, `validate` and, when a step registry is given, `resolveGraph`.
- Diagnostic codes: `duplicate-key` (same layer sets same key path, or an inline step entry's generated id is taken), `required-dropped` (required path absent), `handler-conflict` (step has conflicting handlers), `unknown-step` (step, handler target, `when:` anchor or `$start` names no known step), `unknown-outcome` (handler names undeclared outcome), `impure-when` (when: on a non-pure step), `cycle` (edge closes loop without repeat: true), `interactive-unattended` (unattended flow reaches interactive step), `unreachable` (step never reached from $start), `schema` (Standard Schema validation issue), `load-failed` (a found config file could not be read).
- Zero runtime dependencies.
