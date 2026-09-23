import { describe, expect, test } from 'bun:test';

import {
  checkManifest,
  checkPackedFiles,
  parsePackedFiles,
} from './pack-check';

const PACK_OUTPUT = [
  'packed 1.96KB package.json',
  'packed 228B NOTICE',
  'packed 11B dist/index.d.ts',
  'packed 82B dist/index.js',
].join('\n');

describe('parsePackedFiles', () => {
  test('extracts file paths from packed lines', () => {
    // Arrange / Act
    const files = parsePackedFiles(PACK_OUTPUT);

    // Assert
    expect(files).toEqual(['package.json', 'NOTICE', 'dist/index.d.ts', 'dist/index.js']);
  });

  test('returns an empty list for empty output', () => {
    expect(parsePackedFiles('')).toEqual([]);
  });
});

describe('checkPackedFiles', () => {
  test('reports no problems when all required files are listed', () => {
    expect(checkPackedFiles(parsePackedFiles(PACK_OUTPUT))).toEqual([]);
  });

  test('reports each missing required file', () => {
    // Arrange
    const files = ['package.json', 'dist/index.js'];

    // Act
    const problems = checkPackedFiles(files);

    // Assert
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('dist/index.d.ts');
    expect(problems.join('\n')).toContain('NOTICE');
  });
});

describe('checkManifest', () => {
  test('accepts the repository manifest', async () => {
    const manifest: unknown = await Bun.file('package.json').json();

    expect(checkManifest(manifest)).toEqual([]);
  });

  test('rejects a fixture manifest that carries dependencies', async () => {
    // Arrange
    const manifest: unknown = await Bun.file(
      'scripts/fixtures/manifest-with-dependencies.json',
    ).json();

    // Act
    const problems = checkManifest(manifest);

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('dependencies');
  });

  test('rejects a manifest that is not an object', () => {
    expect(checkManifest(null)).toHaveLength(1);
  });
});
