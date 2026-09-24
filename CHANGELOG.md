# Changelog

One section per released version, newest first, headed `## <version> — <date>, <release title>`. All additions to the public surface carry a change note.

## 0.1.0 — 2026-09-23, Initial release

- **defineConfig**: types config file entries at authoring time; exists for its parameter type to let an editor flag a wrong key or a `$replace` on a scalar while entries are written.
- **merge**: folds config entries left to right with full merge semantics (scalars replace, arrays replace whole, maps merge recursively, `false` removes, `$replace` discards earlier entries). Checks for duplicates at the same layer and missing required paths.
- **validate** and **validateSections**: run Standard Schema V1 schemas over a config value and report every validation issue as a diagnostic.
- **resolveGraph**: resolve the merged `flows` section into a step graph, validating step and outcome references, detecting handler conflicts and unattended-flow violations, and flagging cycles unless they are marked `repeat: true`.
- **createLoader**: finds, reads, merges, validates and resolves the config files of each layer; reads `.ts`, `.mts`, `.mjs` and `.js` through `import()` and `.json` through `JSON.parse`, hands the text of any other extension to the host's `loaders` reader for it, then runs `merge`, `validate` and, when a step registry is given, `resolveGraph`.
- Diagnostic codes: `duplicate-key` (same layer sets same key path, or an inline step entry's generated id is taken), `required-dropped` (required path absent), `handler-conflict` (step has conflicting handlers), `unknown-step` (step, handler target, `when:` anchor or `$start` names no known step), `unknown-outcome` (handler names undeclared outcome), `impure-when` (when: on a non-pure step), `cycle` (edge closes loop without repeat: true), `interactive-unattended` (unattended flow reaches interactive step), `unreachable` (step never reached from $start), `schema` (Standard Schema validation issue), `load-failed` (a found config file could not be read).
- Zero runtime dependencies.
