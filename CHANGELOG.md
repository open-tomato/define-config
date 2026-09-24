# Changelog

One section per released version, newest first, headed `## <version> — <date>, <release title>`. All additions to the public surface carry a change note.

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
