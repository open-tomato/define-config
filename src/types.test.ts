import type { StandardSchemaV1 } from './standard-schema';
import type { ConfigEntry, DeepPartial, LayeredEntry, Replace } from './types';

import { describe, expect, test } from 'bun:test';

import { defineConfig } from './define-config';

interface Cfg {
  name: string;
  server: { host: string; port: number };
  labels: Record<string, string>;
  steps: Record<string, { run: string; retries?: number }>;
  flows: Record<string, Record<string, { run: string }>>;
  tags: string[];
}

const cfgSchema = {
  '~standard': {
    version: 1,
    vendor: 'hand-written',
    validate: (value: unknown) => ({ value: value as Cfg }),
    types: { input: {} as Cfg, output: {} as Cfg },
  },
} satisfies StandardSchemaV1<Cfg, Cfg>;

/** The config type, derived from the schema as a host derives it. */
type T = StandardSchemaV1.InferInput<typeof cfgSchema>;

type Required = 'steps.build' | 'flows.main.build';

type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2)
  ? true
  : false;

describe('DeepPartial and Replace', () => {
  test('DeepPartial makes every depth optional and keeps lists whole', () => {
    const partial: Equal<DeepPartial<{ a: { b: number }; l: string[] }>, { a?: { b?: number }; l?: string[] }> = true;
    const scalar: Equal<DeepPartial<string>, string> = true;
    expect([partial, scalar]).toEqual([true, true]);
  });

  test('Replace of a leaf is never', () => {
    const ofString: Equal<Replace<string>, never> = true;
    const ofList: Equal<Replace<string[]>, never> = true;
    expect([ofString, ofList]).toEqual([true, true]);
  });
});

describe('ConfigEntry', () => {
  test('refuses a wrong key and accepts the right one', () => {
    // @ts-expect-error `prot` is not a key of `server`
    defineConfig<T>([{ server: { prot: 1 } }]);
    defineConfig<T>([{ server: { port: 1 } }]);

    // @ts-expect-error `nmae` is not a top-level key
    defineConfig<T>([{ nmae: 'x' }]);
    defineConfig<T>([{ name: 'x' }]);
  });

  test('refuses false on a required key and accepts it on any other id', () => {
    // @ts-expect-error `steps.build` is required
    defineConfig<T, Required>([{ steps: { build: false } }]);
    defineConfig<T, Required>([{ steps: { lint: false } }]);

    // @ts-expect-error `flows.main.build` is required
    defineConfig<T, Required>([{ flows: { main: { build: false } } }]);
    defineConfig<T, Required>([{ flows: { other: { build: false } } }]);
    defineConfig<T, Required>([{ flows: { main: { lint: false } } }]);
  });

  test('accepts false on a required key when nothing is required', () => {
    defineConfig<T>([{ steps: { build: false } }]);
  });

  test('refuses false on a named key and accepts it on a keyed-map id', () => {
    // @ts-expect-error `server` is a named key, not a keyed-map id
    defineConfig<T>([{ server: false }]);
    defineConfig<T>([{ labels: { env: false } }]);
  });

  test('refuses $replace on a scalar and accepts it on a subtree', () => {
    // @ts-expect-error a keyed-map id holding a string has no subtree to replace
    defineConfig<T>([{ labels: { env: { $replace: true } } }]);
    defineConfig<T>([{ steps: { build: { $replace: true, run: 'bun run build' } } }]);

    // @ts-expect-error `name` is a string, not a subtree
    defineConfig<T>([{ name: { $replace: true } }]);
    defineConfig<T>([{ server: { $replace: true, port: 8080 } }]);
  });

  test('refuses true at a keyed-map id holding a subtree', () => {
    // @ts-expect-error `true` is neither an entry, a `$replace` nor `false`
    defineConfig<T>([{ steps: { lint: true } }]);
    defineConfig<T>([{ steps: { lint: { run: 'bun run lint' } } }]);
  });

  test('accepts $replace over a whole keyed map', () => {
    defineConfig<T>([{ labels: { $replace: true, env: 'prod' } }]);
  });

  test('refuses $replace set to anything but true', () => {
    // @ts-expect-error `$replace` is the literal `true`
    defineConfig<T>([{ server: { $replace: false, port: 1 } }]);
    defineConfig<T>([{ server: { $replace: true, port: 1 } }]);
  });

  test('refuses a partial list and accepts a whole one', () => {
    // @ts-expect-error a list is a value: every element is a string
    defineConfig<T>([{ tags: [1] }]);
    defineConfig<T>([{ tags: ['a'] }]);
  });
});

describe('LayeredEntry', () => {
  test('adds $layer as a string beside the entry', () => {
    // @ts-expect-error `$layer` is a string
    const bad: LayeredEntry<T> = { $layer: 1, name: 'x' };
    const good: LayeredEntry<T> = { $layer: 'project', name: 'x' };
    expect([bad.name, good.$layer]).toEqual(['x', 'project']);
  });
});

describe('defineConfig', () => {
  test('returns the very array it is given', () => {
    // Arrange
    const entries: ConfigEntry<T>[] = [{ name: 'a' }, { steps: { lint: false } }];

    // Act
    const result = defineConfig<T>(entries);

    // Assert
    expect(result).toBe(entries);
    expect(result).toEqual([{ name: 'a' }, { steps: { lint: false } }]);
  });

  test('takes its T from the schema the host validates with', () => {
    const derived: Equal<T, Cfg> = true;
    expect([derived, cfgSchema['~standard'].vendor]).toEqual([true, 'hand-written']);
  });
});
