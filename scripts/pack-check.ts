/**
 * Dry-run pack validator: asserts the published tarball would contain the
 * build output and NOTICE, that it holds nothing outside the allow-list, and
 * that the manifest declares no runtime `dependencies` (the package is
 * dependency-free).
 *
 * Run as `bun run check-pack`.
 */

/** Files that must appear in the tarball. */
export const REQUIRED_FILES: readonly string[] = [
  'dist/index.js',
  'dist/index.d.ts',
  'NOTICE',
];

/**
 * Extracts file paths from `bun pm pack --dry-run` output lines of the form
 * `packed <size> <path>`.
 *
 * @param output - Combined stdout/stderr of the pack command.
 * @returns The listed file paths, in output order.
 */
export function parsePackedFiles(output: string): string[] {
  return output
    .split('\n')
    .map((line) => /^packed\s+\S+\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((path): path is string => path !== undefined);
}

/**
 * Reports each required file missing from the packed file list.
 *
 * @param files - Paths listed by the dry-run pack.
 * @returns One message per missing file; empty when all are present.
 */
export function checkPackedFiles(files: readonly string[]): string[] {
  return REQUIRED_FILES
    .filter((required) => !files.includes(required))
    .map((required) => `packed tarball is missing ${required}`);
}

/**
 * Tarball paths allowed by name. Every other allowed path is a
 * `.d.ts` declaration under `dist/` backed by a published `src` module (see
 * {@link isPublishedModule}).
 */
export const ALLOWED_FILES: readonly string[] = [
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'dist/index.js',
];

/**
 * Tells whether a repository path is a `src` module whose declaration may
 * ship: a `.ts` file under `src/` that is neither a `*.test.ts` file, nor a
 * `*.d.ts` file, nor under a `fixtures/` directory.
 *
 * @param path - Repository-relative path with `/` separators.
 * @returns `true` when the module's declaration belongs in the tarball.
 */
export function isPublishedModule(path: string): boolean {
  return path.startsWith('src/')
    && path.endsWith('.ts')
    && !path.endsWith('.test.ts')
    && !path.endsWith('.d.ts')
    && !path.split('/').includes('fixtures');
}

/**
 * Reports each packed path outside the tarball allow-list: the
 * {@link ALLOWED_FILES} names, plus `dist/<p>.d.ts` for each `src/<p>.ts`
 * among `sourceFiles` that {@link isPublishedModule} accepts.
 *
 * @param files - Paths listed by the dry-run pack.
 * @param sourceFiles - Repository-relative paths of the files under `src/`.
 * @returns One message per disallowed path; empty when all are allowed.
 */
export function checkAllowList(
  files: readonly string[],
  sourceFiles: readonly string[],
): string[] {
  const declarations = new Set(
    sourceFiles
      .filter(isPublishedModule)
      .map((source) => `dist/${source.slice('src/'.length, -'.ts'.length)}.d.ts`),
  );
  return files
    .filter((file) => !ALLOWED_FILES.includes(file) && !declarations.has(file))
    .map((file) => `packed tarball holds ${file}, which is outside the allow-list`);
}

/**
 * Reports a `dependencies` field on a manifest.
 *
 * @param manifest - Parsed package.json contents.
 * @returns Problem messages; empty when the manifest is clean.
 */
export function checkManifest(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) {
    return ['manifest is not a JSON object'];
  }
  if ('dependencies' in manifest) {
    return ['manifest must not carry a "dependencies" field'];
  }
  return [];
}

async function main(): Promise<number> {
  const proc = Bun.spawn(['bun', 'pm', 'pack', '--dry-run'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    console.error(`bun pm pack --dry-run exited ${exitCode}\n${stderr}`);
    return 1;
  }
  const manifest: unknown = await Bun.file('package.json').json();
  const sourceFiles = await Array.fromAsync(
    new Bun.Glob('src/**/*.ts').scan({ cwd: '.' }),
  );
  const packed = parsePackedFiles(`${stdout}\n${stderr}`);
  const problems = [
    ...checkPackedFiles(packed),
    ...checkAllowList(packed, sourceFiles),
    ...checkManifest(manifest),
  ];
  for (const problem of problems) {
    console.error(`check-pack: ${problem}`);
  }
  if (problems.length === 0) {
    console.log('check-pack: ok');
  }
  return Number(problems.length > 0);
}

if (import.meta.main) {
  process.exit(await main());
}
