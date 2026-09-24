import { describe, expect, test } from 'bun:test';

import {
  checkAllowList,
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

const SOURCE_FILES = [
  'src/index.ts',
  'src/index.test.ts',
  'src/graph/build.ts',
  'src/graph/build.test.ts',
  'src/loader/fixtures/acceptance/project/rafa.config.ts',
];

const CLEAN_LISTING = [
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/graph/build.d.ts',
];

describe('checkAllowList', () => {
  test('reports no problems for a clean listing', () => {
    expect(checkAllowList(CLEAN_LISTING, SOURCE_FILES)).toEqual([]);
  });

  test('reports a declaration emitted for a fixture module', () => {
    // Arrange
    const fixture = 'dist/loader/fixtures/acceptance/project/rafa.config.d.ts';

    // Act
    const problems = checkAllowList([...CLEAN_LISTING, fixture], SOURCE_FILES);

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(fixture);
  });

  test('reports a declaration for a test module', () => {
    // Arrange
    const declaration = 'dist/graph/build.test.d.ts';

    // Act
    const problems = checkAllowList([...CLEAN_LISTING, declaration], SOURCE_FILES);

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(declaration);
  });

  test('reports an orphan declaration with no backing src module', () => {
    // Arrange / Act
    const problems = checkAllowList(
      [...CLEAN_LISTING, 'dist/planted.d.ts'],
      SOURCE_FILES,
    );

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('dist/planted.d.ts');
  });

  test('reports a stray script under dist', () => {
    // Arrange / Act
    const problems = checkAllowList(
      [...CLEAN_LISTING, 'dist/planted.js'],
      SOURCE_FILES,
    );

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('dist/planted.js');
  });

  test('reports a root-level stray file', () => {
    // Arrange / Act
    const problems = checkAllowList([...CLEAN_LISTING, 'planted.txt'], SOURCE_FILES);

    // Assert
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('planted.txt');
  });

  test('reports every stray path in one pass', () => {
    // Arrange
    const strays = ['dist/planted.d.ts', 'dist/planted.js', 'planted.txt'];

    // Act
    const problems = checkAllowList([...CLEAN_LISTING, ...strays], SOURCE_FILES);

    // Assert
    expect(problems).toHaveLength(3);
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
