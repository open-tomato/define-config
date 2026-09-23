import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { validate, validateSections } from './validate';

/** The host schema: a `name` string and a nested `server.port` number. */
const hostSchema = z.object({
  name: z.string(),
  server: z.object({ port: z.number() }),
});

/** A module schema that constrains `port` further than the host does. */
const moduleSchema = z.object({
  port: z.number().max(1024, 'port must be at most 1024'),
});

describe('validate with zod', () => {
  test('yields no diagnostics for a valid value', () => {
    // Arrange
    const value = { name: 'app', server: { port: 80 } };

    // Act
    const diagnostics = validate(value, hostSchema);

    // Assert
    expect(diagnostics).toEqual([]);
  });

  test('maps a nested zod issue to a schema diagnostic with a string path', () => {
    // Arrange
    const value = { name: 'app', server: { port: 'eighty' } };

    // Act
    const diagnostics = validate(value, hostSchema);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.level).toBe('error');
    expect(diagnostics[0]?.code).toBe('schema');
    expect(diagnostics[0]?.path).toEqual(['server', 'port']);
  });

  test('reports every failing field', () => {
    // Arrange
    const value = { name: 1, server: {} };

    // Act
    const paths = validate(value, hostSchema).map((diagnostic) => diagnostic.path);

    // Assert
    expect(paths).toContainEqual(['name']);
    expect(paths).toContainEqual(['server', 'port']);
  });
});

describe('validateSections with zod', () => {
  test('prefixes issue paths with the section path', () => {
    // Arrange
    const value = { server: { port: 'x' } };

    // Act
    const diagnostics = validateSections(value, [[['server'], moduleSchema]]);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.path).toEqual(['server', 'port']);
  });

  test('a module section adds a diagnostic the host schema did not raise', () => {
    // Arrange
    const value = { name: 'app', server: { port: 8080 } };

    // Act
    const hostOnly = validateSections(value, [[[], hostSchema]]);
    const withModule = validateSections(value, [
      [[], hostSchema],
      [['server'], moduleSchema],
    ]);

    // Assert
    expect(hostOnly).toEqual([]);
    expect(withModule).toHaveLength(1);
    expect(withModule[0]?.code).toBe('schema');
    expect(withModule[0]?.path).toEqual(['server', 'port']);
    expect(withModule[0]?.message).toContain('port must be at most 1024');
  });

  test('keeps the host diagnostics alongside the module ones', () => {
    // Arrange
    const value = { name: 5, server: { port: 8080 } };

    // Act
    const diagnostics = validateSections(value, [
      [[], hostSchema],
      [['server'], moduleSchema],
    ]);

    // Assert
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      ['name'],
      ['server', 'port'],
    ]);
  });

  test('validates a missing subtree as undefined', () => {
    // Arrange
    const value = { name: 'app' };

    // Act
    const diagnostics = validateSections(value, [[['server'], moduleSchema]]);

    // Assert
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.path).toEqual(['server']);
  });
});
