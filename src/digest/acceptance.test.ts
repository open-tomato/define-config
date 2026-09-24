import type { StepRegistry } from '../index';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createLoader, digest, merge } from '../index';

const STEPS: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
  format: { outcomes: ['success', 'fail'], pure: true },
};

let root = '';

async function write(path: string, value: unknown): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), JSON.stringify(value));
}

function flowsWith(when: string): unknown {
  return {
    flows: {
      next: { $start: 'build', build: { onSuccess: 'test' }, test: {}, format: { when } },
    },
  };
}

function loaderFor() {
  return createLoader({
    lookup: ['config.json'],
    layers: [
      { layer: 'user', dir: 'user' },
      { layer: 'project', dir: 'project' },
    ],
    steps: STEPS,
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'define-config-digest-'));
  await write('user/config.json', { name: 'user', build: { retries: 1 } });
  await write('project/config.json', { build: { retries: 2 }, ...(flowsWith('before:test') as object) });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('digest over loaded config', () => {
  test('two loads of the same files digest equal for config and graph', async () => {
    // Arrange
    const loader = loaderFor();

    // Act
    const first = await loader.load(root);
    const second = await loader.load(root);

    // Assert
    expect(first.diagnostics).toEqual([]);
    expect(digest(first.config)).toBe(digest(second.config));
    expect(first.graph).toBeDefined();
    expect(digest(first.graph)).toBe(digest(second.graph));
  });

  test('rewriting one scalar changes the config digest', async () => {
    // Arrange
    const loader = loaderFor();
    const before = digest((await loader.load(root)).config);

    // Act
    await write('user/config.json', { name: 'renamed', build: { retries: 1 } });
    const after = digest((await loader.load(root)).config);

    // Assert
    expect(after).not.toBe(before);
    await write('user/config.json', { name: 'user', build: { retries: 1 } });
  });

  test('before:test and after:test resolve cleanly with different graph digests', async () => {
    // Arrange
    const loader = loaderFor();

    // Act
    await write('project/config.json', flowsWith('before:test'));
    const before = await loader.load(root);
    await write('project/config.json', flowsWith('after:test'));
    const after = await loader.load(root);

    // Assert
    expect(before.diagnostics.filter(d => d.level === 'error')).toEqual([]);
    expect(after.diagnostics.filter(d => d.level === 'error')).toEqual([]);
    expect(digest(before.graph)).not.toBe(digest(after.graph));
  });
});

describe('digest over a merge result', () => {
  test('the value digests to a string and differs from the whole MergeResult digest', () => {
    // Arrange
    const entries = [{ port: 8000 }, { port: 9000 }];

    // Act
    const result = merge(entries);
    const ofValue = digest(result.value);
    const ofResult = digest(result);

    // Assert
    expect(typeof ofValue).toBe('string');
    expect(ofValue).toStartWith('sha256:');
    expect(typeof ofResult).toBe('string');
    expect(ofResult).not.toBe(ofValue);
  });
});
