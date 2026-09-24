import type { StandardSchemaV1 } from './standard-schema';

import { describe, expect, test } from 'bun:test';

import { validate, validateSections } from './validate';

/** A hand-written Standard Schema V1 schema from vendor `test`. */
function schemaOf(
  check: (value: unknown) => StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>,
): StandardSchemaV1 {
  return { '~standard': { version: 1, vendor: 'test', validate: check } };
}

/** Accepts only a number; reports one issue with no path otherwise. */
const numberSchema = schemaOf((value) => {
  if (typeof value === 'number') {
    return { value };
  }
  return { issues: [{ message: 'expected a number' }] };
});

/** Records every value it is asked to validate, and always succeeds. */
function recordingSchema(seen: unknown[]): StandardSchemaV1 {
  return schemaOf((value) => {
    seen.push(value);
    return { value };
  });
}

describe('validate', () => {
  test('a success result yields no diagnostics', () => {
    expect(validate(1, numberSchema)).toEqual([]);
  });

  test('a failing value yields one schema error per issue', () => {
    // Arrange
    const schema = schemaOf(() => ({
      issues: [
        { message: 'first', path: ['a'] },
        { message: 'second', path: ['b'] },
      ],
    }));

    // Act
    const diagnostics = validate({}, schema);

    // Assert
    expect(diagnostics).toEqual([
      { level: 'error', code: 'schema', path: ['a'], message: 'first' },
      { level: 'error', code: 'schema', path: ['b'], message: 'second' },
    ]);
  });

  test('an issue with no path gets the empty path', () => {
    expect(validate('x', numberSchema)).toEqual([
      { level: 'error', code: 'schema', path: [], message: 'expected a number' },
    ]);
  });

  test('a nested path mixing PropertyKey and PathSegment segments becomes strings', () => {
    // Arrange
    const tag = Symbol('tag');
    const schema = schemaOf(() => ({
      issues: [{ message: 'bad', path: ['steps', { key: 0 }, { key: 'run' }, 2, tag, { key: tag }] }],
    }));

    // Act
    const [diagnostic] = validate({}, schema);

    // Assert
    expect(diagnostic?.path).toEqual(['steps', '0', 'run', '2', 'Symbol(tag)', 'Symbol(tag)']);
  });

  test('a Promise result throws a TypeError naming the vendor', () => {
    // Arrange
    const schema: StandardSchemaV1 = {
      '~standard': { version: 1, vendor: 'async-vendor', validate: (value) => Promise.resolve({ value }) },
    };

    // Act
    const run = () => validate(1, schema);

    // Assert
    expect(run).toThrow(TypeError);
    expect(run).toThrow('"async-vendor"');
  });

  test('a synchronous schema whose output merely has a then key does not throw', () => {
    // Control for the Promise check: only a callable `then` counts.
    const schema = schemaOf((value) => ({ value: { then: value } }));

    expect(validate(1, schema)).toEqual([]);
  });
});

describe('validateSections', () => {
  test('each diagnostic path is prefixed with its section path', () => {
    // Arrange
    const value = { tools: { git: { depth: 'deep' } } };
    const nested = schemaOf(() => ({ issues: [{ message: 'expected a number', path: [{ key: 'depth' }] }] }));

    // Act
    const diagnostics = validateSections(value, [[['tools', 'git'], nested]]);

    // Assert
    expect(diagnostics).toEqual([
      { level: 'error', code: 'schema', path: ['tools', 'git', 'depth'], message: 'expected a number' },
    ]);
  });

  test('each section validates the value found at its path', () => {
    // Arrange
    const seen: unknown[] = [];
    const value = { a: { b: 1 }, c: 2 };

    // Act
    validateSections(value, [
      [['a', 'b'], recordingSchema(seen)],
      [['c'], recordingSchema(seen)],
      [[], recordingSchema(seen)],
    ]);

    // Assert
    expect(seen).toEqual([1, 2, value]);
  });

  test('a missing subtree validates undefined', () => {
    // Arrange
    const seen: unknown[] = [];

    // Act
    const diagnostics = validateSections({ a: 1 }, [
      [['missing', 'deeper'], recordingSchema(seen)],
      [['a', 'below-a-scalar'], recordingSchema(seen)],
      [['x'], numberSchema],
    ]);

    // Assert
    expect(seen).toEqual([undefined, undefined]);
    expect(diagnostics).toEqual([
      { level: 'error', code: 'schema', path: ['x'], message: 'expected a number' },
    ]);
  });

  test('an inherited key is not a section value', () => {
    const seen: unknown[] = [];

    validateSections({}, [[['toString'], recordingSchema(seen)]]);

    expect(seen).toEqual([undefined]);
  });

  test('the result is the union of every section, in section order', () => {
    // Arrange
    const value = { host: 'x', module: { level: 'x' } };

    // Act
    const diagnostics = validateSections(value, [
      [['host'], numberSchema],
      [['module', 'level'], numberSchema],
      [['host'], recordingSchema([])],
    ]);

    // Assert
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([['host'], ['module', 'level']]);
  });

  test('no sections yields no diagnostics', () => {
    expect(validateSections({ a: 'x' }, [])).toEqual([]);
  });

  test('an asynchronous section schema throws a TypeError', () => {
    const schema = schemaOf((value) => Promise.resolve({ value }));

    expect(() => validateSections({}, [[['a'], schema]])).toThrow(TypeError);
  });
});
