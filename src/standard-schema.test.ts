import type { StandardSchemaV1 } from './standard-schema';

import { describe, expect, test } from 'bun:test';

interface Cfg { name: string }

function validateCfg(value: unknown): StandardSchemaV1.Result<Cfg> {
  if (typeof value === 'object' && value !== null && typeof (value as Cfg).name === 'string') {
    return { value: value as Cfg };
  }
  return { issues: [{ message: 'name must be a string', path: [{ key: 'name' }] }] };
}

const schema = {
  '~standard': {
    version: 1,
    vendor: 'hand-written',
    validate: validateCfg,
    types: { input: { name: '' }, output: { name: '' } },
  },
} satisfies StandardSchemaV1<Cfg, Cfg>;

type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2)
  ? true
  : false;

describe('StandardSchemaV1', () => {
  test('a hand-written object satisfies the interface and infers its types', () => {
    const input: Equal<StandardSchemaV1.InferInput<typeof schema>, { name: string }> = true;
    const output: Equal<StandardSchemaV1.InferOutput<typeof schema>, { name: string }> = true;
    expect([input, output]).toEqual([true, true]);
  });

  test('refuses a spec version other than 1', () => {
    const bad = {
      '~standard': {
        // @ts-expect-error version must be the literal 1
        version: 2,
        vendor: 'x',
        validate: (value: unknown) => ({ value }),
      },
    } satisfies StandardSchemaV1;
    const good = {
      '~standard': { version: 1, vendor: 'x', validate: (value: unknown) => ({ value }) },
    } satisfies StandardSchemaV1;
    expect([bad['~standard'].vendor, good['~standard'].version]).toEqual(['x', 1]);
  });

  test('validate reports issues with path segments', () => {
    const result = schema['~standard'].validate({});
    expect(result.issues?.[0]?.path).toEqual([{ key: 'name' }]);
    expect(schema['~standard'].validate({ name: 'a' })).toEqual({ value: { name: 'a' } });
  });
});
