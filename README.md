# define-config

Typed config arrays with id-keyed merge, `$replace`, Standard Schema validation and outcome-typed
step graphs. Dependency-free.

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
    { a: { x: 1 } },
    { a: { $replace: true, z: 4 } },
  ],
  { required: ['a.x'] }
);
// diagnostics: [{ level: 'error', code: 'required-dropped', path: ['a', 'x'] }]
```

## validate

Run a Standard Schema V1 schema over a value and report every issue it raises as a `schema`
diagnostic.

```ts
import { z } from 'zod';
import { validate } from '@open-tomato/define-config';

const schema = z
  .object({
    name: z.string(),
    port: z.number().int().positive(),
  })
  .strict();

const value = { name: 'app', port: '8000' };
const diagnostics = validate(value, schema);

console.log(diagnostics[0]);
// { level: 'error', code: 'schema', path: ['port'], message: 'Expected number…' }
```

## resolveGraph

Resolve the merged `flows` section into a step graph and report every problem in it. The merge
produces a `flows` section where flows are keyed by flow name, each containing step entries keyed
by step id.

| Sugar | Equivalent |
|-------|------------|
| `onTrue: id` | `on: { true: id }` |
| `onFalse: id` | `on: { false: id }` |
| `onSuccess: id` | `on: { success: id }` |
| `onFail: id` | `on: { fail: id }` |
| `onChoice: id` | `on: { choice: id }` (for interactive steps) |

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
  }
);

console.log(result.graph.nodes['build.lint']);
// { id: 'lint', flow: 'build', step: 'lint', outcomes: ['success', 'fail'], … }

console.log(result.graph.edges);
// [{ from: 'build.lint', outcome: 'success', to: 'build.test', repeat: false }]
```

A `repeat: true` edge marks a loop as intentional; without it, a back edge yields a `cycle` error.

```ts
const flow = {
  retry: {
    $start: 'attempt',
    attempt: { onFail: { to: 'attempt', repeat: true } },
  },
};

const graph = resolveGraph(flow, {
  attempt: { outcomes: ['success', 'fail'] },
});
// diagnostics: [] (loop is allowed)
```

## createLoader

Find, read, merge, validate and resolve the config files of each layer. The loader runs each file
path through your `loaders` to fetch its content, hands the results to `merge` and `validate`, and
returns the merged value with every diagnostic found.

```ts
import { createLoader } from '@open-tomato/define-config';
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  steps: z.record(z.object({ run: z.string() })),
});

const loader = createLoader({
  loaders: {
    async json(path) {
      const text = await Bun.file(path).text();
      return JSON.parse(text);
    },
  },
});

const result = await loader.load(['rafa.config.json'], schema);
console.log(result.value);
// the merged config
```

## Diagnostic Codes

Every diagnostic the library emits has a stable, machine-readable code. Use it to match, log or
surface diagnostics as lint squiggles.

| Code | Level | When it fires |
|------|-------|---------------|
| `duplicate-key` | error / warn | Two entries of the same `$layer` set the same key path. The level is chosen by the `duplicates` option to `merge`. |
| `required-dropped` | error | A dot-joined path from `merge`'s `required` option is absent in the merged value. |
| `handler-conflict` | error | A step entry has conflicting handlers: e.g. both `onSuccess` and `on.success` under `resolveGraph`. |
| `unknown-step` | error | A referenced step name is not in the step registry passed to `resolveGraph`. |
| `unknown-outcome` | error | A handler names an outcome the step does not declare in the registry. |
| `impure-when` | error | A `when:` placement is on a step not registered as `pure: true`. |
| `cycle` | error | An edge closes a loop in the flow and is not marked `repeat: true`. |
| `interactive-unattended` | error | An `$unattended` flow reaches an interactive step (registered with `interactive: true`). |
| `unreachable` | warn | A step entry is never reached when walking the flow from its `$start`. |
| `schema` | error | A Standard Schema V1 validation issue. |
| `load-failed` | error | The loader failed to load or read a file, or one of the layers failed to merge or validate. |

## Config as Code

A config file is code that runs at load; the host owns the rule for which files it imports. Never
trust config from untrusted sources: always validate the loaded config against your schema.

## Module Cache

This library caches no state: every function is pure and idempotent. Call `merge`, `validate` or
`resolveGraph` as often as you need without side effects.
