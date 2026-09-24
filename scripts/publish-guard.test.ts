import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { checkRelease } from './publish-guard';

const SCRIPT = join(import.meta.dir, 'publish-guard.ts');

const onMain = (): boolean => true;
const offMain = (): boolean => false;

describe('checkRelease', () => {
  test('refuses tag v9.9.9 against version 0.5.1, naming both', () => {
    // Act
    const refusal = checkRelease('v9.9.9', '0.5.1', onMain);

    // Assert
    expect(refusal).toBeDefined();
    expect(refusal).toContain('v9.9.9');
    expect(refusal).toContain('0.5.1');
  });

  test('refuses a tag without the v prefix', () => {
    // Act
    const refusal = checkRelease('0.5.1', '0.5.1', onMain);

    // Assert
    expect(refusal).toBeDefined();
    expect(refusal).toContain('v prefix');
  });

  test('refuses a commit that is not on main', () => {
    // Act
    const refusal = checkRelease('v0.5.1', '0.5.1', offMain);

    // Assert
    expect(refusal).toBeDefined();
    expect(refusal).toContain('not on main');
  });

  test('accepts v0.5.1 against 0.5.1 on main', () => {
    // Arrange
    const asked: string[] = [];

    // Act
    const refusal = checkRelease('v0.5.1', '0.5.1', (tag) => {
      asked.push(tag);
      return true;
    });

    // Assert
    expect(refusal).toBeUndefined();
    expect(asked).toEqual(['v0.5.1']);
  });
});

/**
 * Environment for git in the scratch repository: no inherited `GIT_*`
 * variables (a hook's `GIT_DIR` would point git at this repository), and a
 * fixed identity so commits work on a machine without one.
 */
function scratchEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && value !== undefined) {
      env[key] = value;
    }
  }
  return {
    ...env,
    GIT_AUTHOR_NAME: 'guard-test',
    GIT_AUTHOR_EMAIL: 'guard-test@example.invalid',
    GIT_COMMITTER_NAME: 'guard-test',
    GIT_COMMITTER_EMAIL: 'guard-test@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
}

describe('publish-guard against a scratch git repository', () => {
  let repo = '';
  const env = scratchEnv();

  const git = (...args: string[]): void => {
    const result = Bun.spawnSync(['git', ...args], { cwd: repo, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
    }
  };

  const commitVersion = async (version: string): Promise<void> => {
    await writeFile(join(repo, 'package.json'), `${JSON.stringify({ version })}\n`);
    git('add', 'package.json');
    git('commit', '-q', '-m', `release ${version}`);
  };

  const guard = (tag: string): { exitCode: number; stderr: string } => {
    const result = Bun.spawnSync([process.execPath, SCRIPT, tag], { cwd: repo, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  };

  beforeAll(async () => {
    // Arrange: main carries v0.5.1 (annotated, so `^{commit}` must peel it);
    // a side branch off main carries v0.6.0 with a matching package.json.
    repo = await mkdtemp(join(tmpdir(), 'publish-guard-'));
    git('init', '-q', '-b', 'main');
    await commitVersion('0.5.1');
    git('tag', '-a', 'v0.5.1', '-m', 'v0.5.1');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    git('checkout', '-q', '-b', 'side');
    await commitVersion('0.6.0');
    git('tag', 'v0.6.0');
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  test('refuses the side-branch tag whose version matches, because it is not on main', () => {
    // Act: the working tree is on `side`, so package.json names 0.6.0.
    const result = guard('v0.6.0');

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not on main');
  });

  test('accepts the tag on main when package.json names its version', () => {
    // Arrange
    git('checkout', '-q', 'v0.5.1');

    // Act
    const result = guard('v0.5.1');

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});
