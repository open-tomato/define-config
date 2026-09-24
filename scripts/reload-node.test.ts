import { join } from 'node:path';

import { expect, test } from 'bun:test';

const SCRIPT = join(import.meta.dir, 'reload-node.mjs');

test('reload-node refuses to run under bun, so the Node leg cannot pass on bun', () => {
  // Act: bun itself runs the script, as `bun run check-node` does through
  // its node shim when no Node is installed.
  const result = Bun.spawnSync([process.execPath, SCRIPT], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });

  // Assert
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain('running under bun, not Node');
});
