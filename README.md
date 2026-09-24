# define-config

Typed config arrays with id-keyed merge and outcome-typed step graphs.
Merges entries recursively with `$replace` and `$layer` support, and resolves flows.
Validates with Standard Schema and is dependency-free.

## Install

```bash
npm install @open-tomato/define-config
```

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

An entry typed as `LayeredEntry<T>` takes `$layer` as a string whether the root of `T` has named
keys or is a keyed map. When the root is a keyed map, its ids are typed as strings that start with
a printable ASCII character other than `$`, so a misspelt `$lyer` is a type error, and a root id
set to `true` is a type error as it is in a `ConfigEntry`.

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

## createLoader

Find, read, merge, validate and resolve the config files of each layer. For each layer, in order
(lowest precedence first), the loader tries the `lookup` names in the layer's directory and keeps
the first one that is a file. It reads `.ts`, `.mts`, `.mjs` and `.js` through `import()` (the
`default` export) and `.json` through `JSON.parse`. Any other extension goes to the host reader in
`loaders`, keyed by the extension with its dot and called with the file's text and path. Every
entry read is tagged with its layer's `$layer`. The entries are merged with `required` and
`duplicates` and validated with `schema`, and when `steps` is given the merged `flows` section is
resolved into `graph`. The lookup names below are only an example: the library knows no file
names of its own.

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
// [{ layer, path }] for each layer that had a file, with an absolute path
```

A relative `dir` resolves against the directory passed to `load`. A file that cannot be read
yields a `load-failed` error and its layer contributes nothing; `load` still returns the rest.

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
| `unreachable` | warn | A step entry is never reached when walking the flow from its `$start`. |
| `schema` | error | A Standard Schema V1 validation issue. |
| `load-failed` | error | The loader found a file it could not read: no reader for its extension, `import()` or the reader threw, no `default` export, or a value that is not an entry or an array of entries. |

## Config as Code

A config file is code that runs at load; the host owns the rule for which files it imports.
Validating the loaded value with a schema checks its shape, but the file's code has already run by
then, so a schema is no guard against a file the host should not have imported.

## Module Cache

The library caches nothing: every `load` looks up and reads the files again. The runtime's module
cache still applies to `import()`, so a `.ts`, `.mts`, `.mjs` or `.js` config file already imported
in this process yields the module it loaded first, even when the file has changed since. `.json`
files and files read through `loaders` are read afresh on every `load`.
