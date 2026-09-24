/**
 * Publish guard: refuses a release unless the tag is `v<version>` for the
 * `package.json` version and the tag's commit is on `main`.
 *
 * Run as `bun run scripts/publish-guard.ts <tag>` from the repository root,
 * with `origin/main` fetched. It writes the refusal to stderr and exits 1,
 * or exits 0 when the release may go ahead.
 */

/**
 * Answers whether a tag's commit is an ancestor of `origin/main`.
 *
 * @param tag - Tag name, as given to the guard.
 * @returns `true` when the tag's commit is on `main`.
 */
export type IsOnMain = (tag: string) => boolean;

/**
 * Decides whether a tag may be published.
 *
 * The tag is checked against the version first; `isOnMain` is asked only
 * when the tag is `v<version>`.
 *
 * @param tag - Tag name being released, such as `v0.5.1`.
 * @param version - The `version` field of `package.json`, such as `0.5.1`.
 * @param isOnMain - Answers whether the tag's commit is an ancestor of
 *   `origin/main`.
 * @returns A refusal naming the reason, or `undefined` when the release may
 *   go ahead.
 */
export function checkRelease(tag: string, version: string, isOnMain: IsOnMain): string | undefined {
  const expected = `v${version}`;
  if (tag !== expected) {
    return tag.startsWith('v')
      ? `tag ${tag} does not match package.json version ${version} (expected ${expected})`
      : `tag ${tag} has no v prefix; package.json version ${version} expects ${expected}`;
  }
  if (!isOnMain(tag)) {
    return `tag ${tag} points at a commit that is not on main (not an ancestor of origin/main)`;
  }
  return undefined;
}

/**
 * Asks git whether a tag's commit is an ancestor of `origin/main`, with
 * `git merge-base --is-ancestor <tag>^{commit} origin/main`.
 *
 * @param tag - Tag name to test.
 * @param cwd - Repository directory; defaults to the current one.
 * @returns `true` when git exits 0, `false` when it exits 1.
 * @throws Error naming git's exit code and stderr on any other exit, such
 *   as an unknown tag or a missing `origin/main`.
 */
export function gitIsOnMain(tag: string, cwd?: string): boolean {
  const result = Bun.spawnSync(
    ['git', 'merge-base', '--is-ancestor', `${tag}^{commit}`, 'origin/main'],
    { cwd, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' },
  );
  if (result.exitCode === 0 || result.exitCode === 1) {
    return result.exitCode === 0;
  }
  throw new Error(`git merge-base exited ${result.exitCode}: ${result.stderr.toString().trim()}`);
}

async function main(args: readonly string[]): Promise<number> {
  const tag = args[0];
  if (tag === undefined || tag === '') {
    console.error('publish-guard: usage: bun run scripts/publish-guard.ts <tag>');
    return 1;
  }
  const manifest: unknown = await Bun.file('package.json').json();
  const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest
    ? manifest.version
    : undefined;
  if (typeof version !== 'string') {
    console.error('publish-guard: package.json has no string version');
    return 1;
  }
  try {
    const refusal = checkRelease(tag, version, (name) => gitIsOnMain(name));
    if (refusal !== undefined) {
      console.error(`publish-guard: refused: ${refusal}`);
      return 1;
    }
  } catch (error) {
    console.error(`publish-guard: ${error instanceof Error
      ? error.message
      : String(error)}`);
    return 1;
  }
  console.log(`publish-guard: ok: ${tag} matches ${version} and is on main`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
