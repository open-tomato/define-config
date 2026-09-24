import type { Gate, RunGatesOptions } from './gates';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { CHECK_NODE_SKIPPED, findRealNode, GATES, runGates } from './gates';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function exits(name: string, code: number): Gate {
  return { name, command: ['bun', '-e', `process.exit(${code})`] };
}

function writesMarker(name: string, marker: string, contents = 'ran'): Gate {
  const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, ${contents})`;
  return { name, command: ['bun', '-e', script] };
}

function options(
  gates: readonly Gate[],
  lines: string[],
  overrides: Partial<RunGatesOptions> = {},
): RunGatesOptions {
  return {
    gates,
    distDir: join(dir, 'dist'),
    env: { ...process.env, CI: undefined },
    findNode: () => '/usr/bin/node',
    writeLine: (line) => lines.push(line),
    ...overrides,
  };
}

describe('GATES', () => {
  test('lists the six gates in run order', () => {
    expect(GATES.map((gate) => gate.name)).toEqual([
      'lint',
      'check-types',
      'test',
      'build',
      'check-pack',
      'check-node',
    ]);
  });
});

describe('runGates', () => {
  test('stops at the first failing gate and returns its code', async () => {
    // Arrange
    const marker = join(dir, 'third-ran');
    const lines: string[] = [];
    const gates = [exits('first', 0), exits('second', 1), writesMarker('third', marker, '\'ran\'')];

    // Act
    const result = await runGates(options(gates, lines));

    // Assert
    expect(result).toBe(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^first: exit 0 \(\d+\.\d{2}s\)$/);
    expect(lines[1]).toMatch(/^second: exit 1 \(\d+\.\d{2}s\)$/);
    expect(existsSync(marker)).toBe(false);
  });

  test('returns the failing gate\'s own exit code', async () => {
    // Arrange
    const lines: string[] = [];

    // Act
    const result = await runGates(options([exits('only', 3)], lines));

    // Assert
    expect(result).toBe(3);
    expect(lines).toEqual([expect.stringMatching(/^only: exit 3 /)]);
  });

  test('removes the dist directory before the first gate runs', async () => {
    // Arrange
    const dist = join(dir, 'dist');
    mkdirSync(dist);
    const marker = join(dir, 'dist-existed');
    const contents = `String(require('node:fs').existsSync(${JSON.stringify(dist)}))`;
    const lines: string[] = [];

    // Act
    const result = await runGates(options([writesMarker('probe', marker, contents)], lines));

    // Assert
    expect(result).toBe(0);
    expect(readFileSync(marker, 'utf8')).toBe('false');
  });

  test('the dist probe records a directory that is present (control)', async () => {
    // Arrange
    const dist = join(dir, 'dist');
    mkdirSync(dist);
    const marker = join(dir, 'dist-existed');
    const contents = `String(require('node:fs').existsSync(${JSON.stringify(dist)}))`;
    const lines: string[] = [];

    // Act
    const result = await runGates(options(
      [writesMarker('probe', marker, contents)],
      lines,
      { distDir: join(dir, 'elsewhere') },
    ));

    // Assert
    expect(result).toBe(0);
    expect(readFileSync(marker, 'utf8')).toBe('true');
  });

  test('skips check-node and carries on when node is missing outside CI', async () => {
    // Arrange
    const marker = join(dir, 'after-ran');
    const lines: string[] = [];
    const gates = [exits('check-node', 1), writesMarker('after', marker, '\'ran\'')];

    // Act
    const result = await runGates(options(gates, lines, { findNode: () => null }));

    // Assert
    expect(result).toBe(0);
    expect(lines[0]).toBe(CHECK_NODE_SKIPPED);
    expect(lines).toHaveLength(2);
    expect(existsSync(marker)).toBe(true);
  });

  test('fails at check-node when node is missing under CI=true', async () => {
    // Arrange
    const marker = join(dir, 'after-ran');
    const lines: string[] = [];
    const gates = [exits('first', 0), exits('check-node', 0), writesMarker('after', marker, '\'ran\'')];
    const env = { ...process.env, CI: 'true' };

    // Act
    const result = await runGates(options(gates, lines, { env, findNode: () => null }));

    // Assert
    expect(result).not.toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines.at(-1)).toStartWith('check-node: exit ');
    expect(lines.at(-1)).not.toBe(CHECK_NODE_SKIPPED);
    expect(existsSync(marker)).toBe(false);
  });

  test('returns 0 with one line per gate, in list order, when all pass', async () => {
    // Arrange
    const lines: string[] = [];
    const gates = [exits('a', 0), exits('b', 0), exits('check-node', 0)];

    // Act
    const result = await runGates(options(gates, lines));

    // Assert
    expect(result).toBe(0);
    expect(lines.map((line) => line.split(':')[0])).toEqual(['a', 'b', 'check-node']);
    expect(lines.every((line) => / exit 0 \(\d+\.\d{2}s\)$/.test(line))).toBe(true);
  });
});

describe('findRealNode', () => {
  test('returns null when no node is on PATH', () => {
    expect(findRealNode(() => null)).toBeNull();
  });

  test('returns null for a node that is bun, as bun run\'s node shim is', () => {
    // Arrange: `bun run` links a `node` to bun when no Node is installed.
    const shim = join(dir, 'node');
    symlinkSync(process.execPath, shim);

    // Act / Assert
    expect(findRealNode(() => shim)).toBeNull();
  });

  test('returns the path of a node that is not bun (control)', () => {
    // Arrange: a stand-in that answers the probe the way Node does.
    const node = join(dir, 'node');
    writeFileSync(node, '#!/bin/sh\nexit 0\n');
    chmodSync(node, 0o755);

    // Act / Assert
    expect(findRealNode(() => node)).toBe(node);
  });

  test('returns null for a node that cannot be run', () => {
    // Arrange: a file named node without the execute bit.
    const node = join(dir, 'node');
    writeFileSync(node, '#!/bin/sh\nexit 0\n');

    // Act / Assert
    expect(findRealNode(() => node)).toBeNull();
  });
});
