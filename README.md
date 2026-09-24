# define-config

[![CI status](https://github.com/open-tomato/define-config/actions/workflows/ci.yml/badge.svg)](https://github.com/open-tomato/define-config/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@open-tomato/define-config)](https://www.npmjs.com/package/@open-tomato/define-config)
[![npm provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/@open-tomato/define-config#provenance)

Typed config arrays with id-keyed merge and outcome-typed step graphs.
Merges entries recursively with `$replace` and `$layer` support, and resolves flows.
Validates with Standard Schema and is dependency-free.

## Install

```bash
npm install @open-tomato/define-config
```

The package requires Node.js 22 or later (`engines.node` is `>=22`).

## defineConfig

Declare a list of config entries for a config of type `T`. At runtime this is the identity: it
returns the array unchanged. It exists for its parameter type, so an editor flags a wrong key or a
`$replace` on a scalar while entries are written, before anything merges them.

```ts
import { defineConfig } from '@open-tomato/define-config';

interface Config {
  name: string;
  steps: Record<string, { run: string }>;
}

export default defineConfig<Config, 'name'>([
  {
    name: 'app',
    steps: { lint: { run: 'bun run lint' } },
  },
  {
    steps: { build: { run: 'bun run build' } },
  },
]);
```

## merge

Merge config entries left to right and check the result. Each entry is applied with its position
in the `entries` array as its index, so every diagnostic points back into `entries`.

| Type | Behavior |
|------|----------|
| **Scalar** | A scalar (string, number, boolean, null), function or non-plain object replaces the value at that key. |
| **Array** | Arrays replace whole, never merged element-wise. Every value inside an array is copied as data; `false` and `$replace` are not interpreted. |
| **Keyed map** | A plain object merges into any map already at that key, key by key and recursively, or starts a new map when none is there. |
| **`false`** | Removes the key. A required key with `false` yields a `required-dropped` error. |
| **`$replace: true`** | Replaces the whole subtree at the key, discarding what earlier entries put there. Only the form `{ $replace: true }` replaces; other values for `$replace` are treated as data. |
| **`$layer`** | On the entry itself (not below), labels its layer for duplicate detection. Entries of different layers override each other silently. |
| **Duplicates** | Two entries of the same `$layer` setting the same key path yields a `duplicate-key` diagnostic at the level you choose: `error`, `warn` (the default) or `allow`. |
| **Required** | Dot-joined key paths (e.g. `'steps.lint'`) that must be present in the merged value. Each absent path yields a `required-dropped` error. |

```ts
import { merge } from '@open-tomato/define-config';

const result = merge([
  { a: { x: 1, y: 2 } },
  { a: { y: 3, z: 4 } },
]);

console.log(result.value);
// { a: { x: 1, y: 3, z: 4 } }

const withRequired = merge(
  [
    { $layer: 'defaults', a: { x: 1 } },
    { $layer: 'project', a: { $replace: true, z: 4 } },
  ],
  { required: ['a.x'] },
);

console.log(withRequired.value);
// { a: { z: 4 } }

console.log(withRequired.diagnostics);
// [{ level: 'error', code: 'required-dropped', path: ['a', 'x'],
//    message: 'a.x is required but was dropped: entry 1 replaced a with $replace', entry: 1 }]
```

The two entries sit in different layers. Without the `$layer` labels they would share the implicit
layer, and entry 1 setting `a` again would also produce a `duplicate-key` warning at `a`.

An entry typed as `LayeredEntry<T>` takes `$layer` as a string and `$replace` as the literal
`true` whether the root of `T` has named keys or is a keyed map; a root `$replace: true` replaces
the whole value merged so far, and any other `$replace` value is a type error. When the root is a
keyed map, its ids are typed as strings that start with a printable ASCII character other than
`$`, so a misspelt `$lyer` is a type error, and a root id set to `true` is a type error as it is
in a `ConfigEntry`.

The merged value never shares a plain object or an array with an entry, and no entry is changed.
Functions and class instances (a `Date`, a `Map`) are values: they are kept by reference.

`result.provenance` records which entries touched which key path. It maps each dot-joined path
(`''` for a `$replace: true` on an entry itself) to that path's records in entry order, each
`{ entry, kind }` plus `layer` when the entry has a `$layer`. The last record names the entry that
last touched the path. `kind` is `set`, `remove` (a `false` there; when last, the path is absent)
or `replace` (a `$replace: true` there). Paths below a replaced key keep their earlier records, so
a path can end on `set` and still be absent because an ancestor was replaced. The map, its record
arrays and its records are frozen copies.

```ts
import { merge } from '@open-tomato/define-config';

const result = merge([
  { a: { x: 1 } },
  { $layer: 'project', a: { x: 2 } },
]);

console.log(result.provenance.get('a.x'));
// [{ entry: 0, kind: 'set' }, { entry: 1, layer: 'project', kind: 'set' }]
```

`provenanceOf(result, path)` reads one path's records out of any `{ provenance }`, taking the path
dot-joined (`'a.x'`) or as an array (`['a', 'x']`), with `''` for the root; a path no entry touched
yields `[]`.

## validate

Run a Standard Schema V1 schema over a value and report every issue it raises as a `schema`
diagnostic.

```ts
import { z } from 'zod';

import { validate } from '@open-tomato/define-config';

const schema = z
  .object({
    name: z.string(),
    port: z
      .number()
      .int()
      .positive(),
  })
  .strict();

const value = { name: 'app', port: '8000' };
const diagnostics = validate(value, schema);

console.log(diagnostics[0]);
// { level: 'error', code: 'schema', path: ['port'],
//   message: 'Invalid input: expected number, received string' }
```

Validation is synchronous: a schema whose `validate` returns a Promise makes `validate` throw a
`TypeError`. `validateSections(value, [[path, schema], …])` validates the subtree at each path
with its own schema and prefixes each diagnostic's path with that section's path.

## resolveGraph

Resolve the merged `flows` section into a step graph and report every problem in it. The merge
produces a `flows` section where flows are keyed by flow name, each containing step entries keyed
by step id.

A flow typed as `Flows` takes a step entry object at each step id: a step id set to a string or a
boolean is a type error. `$start` and `$unattended` are the flow's only `$`-prefixed keys; step ids
are typed as strings that start with a printable ASCII character other than `$`, so a misspelt
`$strat` is a type error too.

| Sugar | Equivalent |
|-------|------------|
| `onTrue: id` | `on: { true: id }` |
| `onFalse: id` | `on: { false: id }` |
| `onSuccess: id` | `on: { success: id }` |
| `onFail: id` | `on: { fail: id }` |
| `onChoice: { <name>: id, … }` | `on: { <name>: id, … }`: each key is an outcome (for interactive steps) |

```ts
import { resolveGraph } from '@open-tomato/define-config';

const result = resolveGraph(
  {
    build: {
      $start: 'lint',
      lint: { onSuccess: 'test' },
      test: {},
    },
  },
  {
    lint: { outcomes: ['success', 'fail'] },
    test: { outcomes: ['success', 'fail'] },
  },
);

console.log(result.graph.nodes['build.lint']);
// { id: 'lint', flow: 'build', step: 'lint', outcomes: ['success', 'fail'], … }

console.log(result.graph.edges);
// [{ from: 'build.lint', outcome: 'success', to: 'build.test', repeat: false }]
```

A `repeat: true` edge marks a loop as intentional; without it, a back edge yields a `cycle` error.
`repeat` is typed as the literal `true`: `repeat: false`, `repeat: 2` or `repeat: 'twice'` is a
type error. A config that bypasses the types can still carry another value; it is kept on the edge
for the host, but only `true` marks the loop, so the back edge is still a `cycle`.

```ts
import { resolveGraph } from '@open-tomato/define-config';

const flows = {
  retry: {
    $start: 'attempt',
    attempt: { onFail: { to: 'attempt', repeat: true } },
  },
};

const looped = resolveGraph(flows, {
  attempt: { outcomes: ['success', 'fail'] },
});

console.log(looped.diagnostics);
// [] (the loop is marked, so no cycle)

console.log(looped.graph.edges);
// [{ from: 'retry.attempt', outcome: 'fail', to: 'retry.attempt', repeat: true }]
```

A `when:` placement creates a hook in `result.graph.hooks`: it positions one step before or
after another without an edge. The hook's node runs before or after its anchor, then the flow
continues from the anchor; a hook is not followed by outcome.

```ts
import { resolveGraph } from '@open-tomato/define-config';

const result = resolveGraph(
  {
    next: {
      $start: 'build',
      build: { onSuccess: 'test' },
      lint: { when: 'before:test' },
      test: {},
    },
  },
  {
    build: { outcomes: ['success', 'fail'] },
    lint: { outcomes: ['success'], pure: true },
    test: { outcomes: ['success', 'fail'] },
  },
);

console.log(result.graph.hooks);
// [{ flow: 'next', node: 'next.lint', anchor: 'next.test', position: 'before' }]
```

### Driving a graph

Four helper functions read a resolved graph to answer what a runner asks as it
steps through a flow.

- `next(graph, node, outcome)` finds the node an outcome leads to, throwing a
  `RangeError` when the node is unknown or the outcome is undeclared.
- `hooksOf(graph, node)` lists the nodes placed before and after a node via
  `when:` placements.
- `reachable(graph, flow)` returns all nodes reached from a flow's start,
  following every edge (including `repeat: true` and hooks).
- `walkOrder(graph, flow)` returns the depth-first order nodes are placed in,
  following non-`repeat: true` edges only; bounding a loop is the runner's job.

```ts
import { resolveGraph, next, hooksOf, walkOrder } from '@open-tomato/define-config';

const result = resolveGraph(
  {
    build: {
      $start: 'lint',
      lint: { onSuccess: 'test' },
      format: { when: 'before:test' },
      test: {},
    },
  },
  {
    lint: { outcomes: ['success', 'fail'] },
    format: { outcomes: ['success'], pure: true },
    test: { outcomes: ['success', 'fail'] },
  },
);

const { graph } = result;

// next() finds the node an outcome leads to
console.log(next(graph, 'build.lint', 'success'));
// build.test

// hooksOf() lists the nodes placed before and after a node
console.log(hooksOf(graph, 'build.test'));
// { before: [ 'build.format' ], after: [] }

// walkOrder() shows the placement order
console.log(walkOrder(graph, 'build'));
// [ 'build.lint', 'build.format', 'build.test' ]
```

## createLoader

Find, read, merge, validate and resolve the config files of each layer. For each layer, in order
(lowest precedence first), the loader tries the `lookup` names in the layer's directory and keeps
the first one that is a file. It reads `.ts`, `.mts`, `.mjs` and `.js` through `import()` (the
`default` export) and `.json` through `JSON.parse`. Any other extension goes to the host reader in
`loaders`, keyed by the extension with its dot and called with the file's text and path. Every
entry read is tagged with its layer's `$layer`. The entries are merged with `required` and
`duplicates` and validated with `schema`, and when `steps` is given the merged `flows` section is
resolved into `graph`. Module files can see edits within one process with the
[`reload`](#module-cache) option. The lookup names below are only an example: the library knows
no file names of its own.

```ts
import { homedir } from 'node:os';

import { z } from 'zod';

import { createLoader } from '@open-tomato/define-config';

const schema = z.object({
  name: z.string(),
  steps: z.record(z.string(), z.object({ run: z.string() })),
});

const loader = createLoader({
  lookup: ['rafa.config.ts', '.rafa/config.yaml'],
  layers: [
    { layer: 'user', dir: homedir() },
    { layer: 'project', dir: '.' },
  ],
  schema,
  loaders: { '.yaml': (text) => Bun.YAML.parse(text) },
});

const { config, diagnostics, sources } = await loader.load(process.cwd());

console.log(config);
// the merged value

console.log(diagnostics);
// every problem, in stage order

console.log(sources);
// [{ layer, path, entries }] for each layer that had a file, with an absolute path
```

A relative `dir` resolves against the directory passed to `load`. A file that cannot be read
yields a `load-failed` error and its layer contributes nothing; `load` still returns the rest.

`load` also returns `provenance`, the map `merge` records over the entries read (every layer's
entries concatenated in layer order), and each source carries `entries: [from, to]`, the half-open
range of entry indexes its file contributed. The ranges follow layer order and meet end to start,
so every record's `entry` falls in exactly one source's range; a file that failed to read keeps
its place in `sources` with an empty range (`from === to`). To find the file behind a record, look
up the source whose range holds its `entry`:

```ts
import { createLoader, provenanceOf } from '@open-tomato/define-config';

const loader = createLoader({
  lookup: ['rafa.config.ts', '.rafa/config.yaml'],
  layers: [
    { layer: 'user', dir: '/home/me' },
    { layer: 'project', dir: '.' },
  ],
  loaders: { '.yaml': (text) => Bun.YAML.parse(text) },
});

const result = await loader.load(process.cwd());
const last = provenanceOf(result, 'build.retries').at(-1);
const file = result.sources.find(({ entries: [from, to] }) => last !== undefined && last.entry >= from && last.entry < to);

console.log(last, file?.path);
// run in /work/project, with one user entry and a project file that sets build.retries:
// { entry: 1, layer: 'project', kind: 'set' } '/work/project/rafa.config.ts'
```

## canonicalize and digest

`canonicalize(value)` writes any value as canonical JSON text: no whitespace, plain object keys
sorted by UTF-16 code unit at every level (with arrays, functions, class instances, and tagged
objects handled distinctly). Numbers are written with `-0` as `0`. The four tagged types use the
`$` namespace: `$date` for `Date` (ISO string), `$map` for `Map` (sorted by key text then value
text), `$set` for `Set` (sorted by member text), and `$function` for functions (by name only—the
body is never read, so body changes do not change the digest). Class instances are written as
plain objects by their own enumerable string keys. Shared references (the same object or array
reached by two paths) are written twice, never refused. Cyclic references—where a value contains
itself—throw `CanonicalizeError` with `code: 'cyclic-value'` and `path: string[]`, the key path
from the root to the cycle. `NaN`, `±Infinity`, `bigint`, symbols, `undefined` wherever it would
be written (the root, an array element, a `Map` key or value, a `Set` member; only an object
property that is `undefined` is dropped), invalid `Date` objects, and any object whose only
written key is one of the four tag names throw `CanonicalizeError` with `code: 'not-canonical'`
and `path`. `digest(value)` returns
`'sha256:' + sha256_hex(canonicalize(value))`, synchronous from `node:crypto`.

A host digests one of `result.value`, `result.config` or `result.graph` to represent a merged
config, schema validation, or flow resolution—never the whole `result` object itself.

```ts
import { merge, canonicalize, digest } from '@open-tomato/define-config';

// Merge two entries
const result = merge([
  { name: 'app', port: 8000, tags: new Set(['web', 'prod']) },
  { port: 9000 },
]);

const value = result.value;

// canonicalize produces a sorted, deterministic JSON text
console.log(canonicalize(value));
// {"name":"app","port":9000,"tags":{"$set":["prod","web"]}}

// digest returns the SHA-256 hash
console.log(digest(value));
// sha256:d3dc407e4672bb0247355c4c613df22e90e38b21dcff374587a33900944df9f7

// After one value changes
const modified = { ...value, port: 9001 };
console.log(digest(modified));
// sha256:6b5fa5986e16ad86a6932792a0274db414f015b3b40d00650000e7fa7020ebcc
```

## Diagnostic Codes

Every diagnostic the library emits has a stable, machine-readable code. Use it to match, log or
surface diagnostics as lint squiggles.

| Code | Level | When it fires |
|------|-------|---------------|
| `duplicate-key` | warn / error | In `merge`: two entries of the same `$layer` set the same key path; the `duplicates` option picks the level (`warn` by default) or turns the check off. In `resolveGraph` (always an error): an inline entry's generated id `<parent>.<outcome>` equals an id already in the flow. |
| `required-dropped` | error | A dot-joined path from `merge`'s `required` option is absent in the merged value. |
| `handler-conflict` | error | A step entry carries `on` beside a sugar key, or two sugar keys name one outcome (such as `onTrue` and `onChoice.true`). |
| `unknown-step` | error | A step entry's step is not in the registry passed to `resolveGraph`, or a handler target, `when:` anchor or `$start` names neither a step entry of the flow nor a registered step. |
| `unknown-outcome` | error | A handler names an outcome the step does not declare in the registry. |
| `impure-when` | error | A `when:` placement is on a step not registered as `pure: true`. |
| `cycle` | error | An edge closes a loop in the flow and is not marked `repeat: true`. |
| `interactive-unattended` | error | An `$unattended` flow reaches an interactive step (registered with `interactive: true`). |
| `unreachable` | warn | A step entry is never reached when walking the flow from its `$start`. A `when:` step is reached only from its anchor, so one whose anchor does not resolve gets `unreachable` beside its `unknown-step`. |
| `schema` | error | A Standard Schema V1 validation issue. |
| `load-failed` | error | The loader found a file it could not read: no reader for its extension, `import()` or the reader threw, no `default` export, or a value that is not an entry or an array of entries. |

## Config as Code

A config file is code that runs at load; the host owns the rule for which files it imports.
Validating the loaded value with a schema checks its shape, but the file's code has already run by
then, so a schema is no guard against a file the host should not have imported.

## Module Cache

The library caches nothing: every `load` looks up and reads the files again. The runtime's module
cache still applies to `import()`. A `.ts`, `.mts`, `.mjs` or `.js` config file already imported
in this process yields the module it loaded first, even when the file has changed since.

With the `reload` option off (the default), this is the whole story: no bytes are read before
importing by the file's URL. With `reload: true`, each `load` reads the file's bytes and computes
a content key. If the bytes are unchanged, the key is the same, the import uses the cached module,
and calling `load` again is cheap. If the bytes changed, the key is new, `import()` evaluates the
file again and caches the new module.

Two limits apply, by design:

**Limit 1:** Only the config file itself is evaluated again. A module it imports resolves to a
specifier with no content key and stays cached. A host that needs a fresh version of an imported
module must restart the process.

**Limit 2:** Every distinct content stays in the runtime's module registry for the life of the
process. One module is retained per edit. A file edited ten times produces ten cached modules.

A `.json` file or one read through `loaders` is read fresh on every `load`, regardless of the
`reload` option; neither uses the module cache.

```ts
import { createLoader } from '@open-tomato/define-config';

const loader = createLoader({
  lookup: ['rafa.config.ts'],
  layers: [{ layer: 'project', dir: '.' }],
  reload: true,
});

// First load: reads and evaluates the file
const first = await loader.load(process.cwd());
console.log(first.config);
// { command: 'build', task: 'npm run build' }

// If bytes unchanged, load is cheap (same module cached)
const cached = await loader.load(process.cwd());
console.log(cached.config);
// { command: 'build', task: 'npm run build' } (no re-evaluation)

// After file edit: new bytes, new content key, fresh evaluation
// File now contains: { command: 'test', task: 'npm run test' }
const reloaded = await loader.load(process.cwd());
console.log(reloaded.config);
// { command: 'test', task: 'npm run test' }
```
