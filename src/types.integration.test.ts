import type { StepEntry } from './graph/types';
import type { StandardSchemaV1 } from './standard-schema';
import type { ConfigEntry } from './types';

import { describe, expect, test } from 'bun:test';

import { defineConfig } from './define-config';

type Outcome = 'success' | 'fail';

interface AppConfig {
  name: string;
  flows: Record<string, Record<string, StepEntry<Outcome>>>;
}

const appSchema = {
  '~standard': {
    version: 1,
    vendor: 'hand-written',
    validate: (value: unknown) => ({ value: value as AppConfig }),
    types: { input: {} as AppConfig, output: {} as AppConfig },
  },
} satisfies StandardSchemaV1<AppConfig, AppConfig>;

/** The config type, derived from the schema as a host derives it. */
type T = StandardSchemaV1.InferInput<typeof appSchema>;

describe('defineConfig with a type derived from a schema', () => {
  test('accepts a well-formed entry', () => {
    // Arrange
    const entry: ConfigEntry<T> = {
      name: 'app',
      flows: { main: { build: { on: { success: 'ship', fail: 'ship' }, expect: 'success' } } },
    };

    // Act
    const entries = defineConfig<T>([entry]);

    // Assert
    expect(entries).toEqual([entry]);
  });

  test('refuses a misspelled step outcome inside flows', () => {
    // Arrange / Act
    const entries = defineConfig<T>([
      // @ts-expect-error 'sucess' is not an outcome of the flow's steps
      { flows: { main: { build: { on: { sucess: 'ship' } } } } },
    ]);

    // Assert
    expect(entries).toHaveLength(1);
  });
});

describe('the hand-written schema', () => {
  test('carries the types the config type is derived from', () => {
    // Arrange / Act
    const { vendor, version } = appSchema['~standard'];

    // Assert
    expect([vendor, version]).toEqual(['hand-written', 1]);
  });
});
