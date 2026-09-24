/**
 * Checks `reload` under Node, which bun's own test run cannot: Node keys
 * its module cache on the `file://` URL with its query, bun on the path.
 *
 * Run by `bun run check-node`, which builds `dist/` first. In a fresh
 * `mkdtemp` directory it writes a `rafa.config.mjs` exporting
 * `{ port: 8000 }`, loads it with `reload: true`, rewrites it to
 * `{ port: 9000 }` and loads again. It then repeats those steps with
 * `reload` off in a second directory as the control, which shows the edit
 * is invisible without the option, so the first reading could have failed.
 * It exits 0 only when the reloading second load reads 9000 and the
 * control's second load reads 8000, and 1 naming each mismatch otherwise.
 * Both directories are removed in a `finally`.
 *
 * `dist/index.js` is a build output, not a source module, so it is loaded
 * with `import()` at run time rather than a static import: lint runs over
 * source before any build and cannot resolve it. When it is missing the
 * script exits 1 saying so, instead of failing inside Node's resolver.
 *
 * It also exits 1 when it runs under bun. With no Node installed,
 * `bun run check-node` finds bun's `node` shim and would run this check on
 * bun, passing a Node leg that never ran on Node.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = new URL('../dist/index.js', import.meta.url);

if (process.versions.bun !== undefined) {
  process.stderr.write(
    'reload-node: running under bun, not Node: `bun run` puts a node shim on PATH when no Node is installed; install Node\n',
  );
  process.exit(1);
}

if (!existsSync(ENTRY)) {
  process.stderr.write('reload-node: dist/index.js is missing; run `bun run build` first\n');
  process.exit(1);
}

const { createLoader } = await import(ENTRY.href);

const FILE = 'rafa.config.mjs';

/** Write the config file in `dir` exporting `port`. */
async function writeConfig(dir, port) {
  await writeFile(join(dir, FILE), `export default { port: ${port} };\n`);
}

/** Load `dir` and return its `port`, with any diagnostic messages. */
async function loadPort(loader, dir) {
  const { config, diagnostics } = await loader.load(dir);
  return { port: config.port, problems: diagnostics.map((d) => d.message) };
}

/** Load at 8000, rewrite to 9000, load again; print and return both reads. */
async function run(label, reload, dir) {
  const loader = createLoader({ lookup: [FILE], layers: [{ layer: 'project', dir }], reload });
  await writeConfig(dir, 8000);
  const first = await loadPort(loader, dir);
  await writeConfig(dir, 9000);
  const second = await loadPort(loader, dir);
  process.stdout.write(`${label} (reload: ${reload}): first load ${first.port}, second load ${second.port}\n`);
  return { first, second };
}

/** One mismatch line when `read` is not `expected`, else nothing. */
function mismatch(what, read, expected) {
  if (read.port === expected) {
    return [];
  }
  const detail = read.problems.length > 0
    ? ` (diagnostics: ${read.problems.join('; ')})`
    : '';
  return [`${what}: expected ${expected}, got ${String(read.port)}${detail}`];
}

const dirs = [];
try {
  const reloadDir = await mkdtemp(join(tmpdir(), 'reload-node-'));
  dirs.push(reloadDir);
  const controlDir = await mkdtemp(join(tmpdir(), 'reload-node-control-'));
  dirs.push(controlDir);

  const reloading = await run('reloading', true, reloadDir);
  const control = await run('control', false, controlDir);

  const mismatches = [
    ...mismatch('reloading first load', reloading.first, 8000),
    ...mismatch('reloading second load', reloading.second, 9000),
    ...mismatch('control first load', control.first, 8000),
    ...mismatch('control second load', control.second, 8000),
  ];
  if (mismatches.length > 0) {
    process.stderr.write(`reload-node: mismatch\n${mismatches.map((m) => `  ${m}\n`).join('')}`);
    process.exitCode = 1;
  } else {
    process.stdout.write('reload-node: ok\n');
  }
} finally {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}
