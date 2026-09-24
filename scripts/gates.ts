/**
 * Gate runner: removes `dist/`, then runs each repository gate as its own
 * process, in order, printing one line per gate (name, exit code, duration).
 * It stops at the first non-zero exit and exits with that code; the exit code
 * is the only verdict, and no gate's output is read.
 *
 * Run as `bun run gates`.
 */

import { rm } from 'node:fs/promises';

/** One gate: a name for the report line and the command it spawns. */
export interface Gate {
  /** Name printed at the start of the gate's report line. */
  readonly name: string;
  /** Command and arguments, spawned directly (no shell). */
  readonly command: readonly string[];
}

/** Name of the gate that needs `node` on `PATH`. */
export const CHECK_NODE = 'check-node';

/** Line written in place of the `check-node` run when `node` is missing. */
export const CHECK_NODE_SKIPPED = `${CHECK_NODE}: skipped (no node on PATH)`;

/** The repository gates, in the order `bun run gates` runs them. */
export const GATES: readonly Gate[] = [
  { name: 'lint', command: ['bun', 'run', 'lint'] },
  { name: 'check-types', command: ['bun', 'run', 'check-types'] },
  { name: 'test', command: ['bun', 'test'] },
  { name: 'build', command: ['bun', 'run', 'build'] },
  { name: 'check-pack', command: ['bun', 'run', 'check-pack'] },
  { name: CHECK_NODE, command: ['bun', 'run', 'check-node'] },
];

/** Inputs to {@link runGates}. */
export interface RunGatesOptions {
  /** Gates to run, in order. */
  readonly gates: readonly Gate[];
  /** Directory removed (recursively, if present) before the first gate. */
  readonly distDir: string;
  /** Environment passed to each gate; its `CI` decides a missing `node`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Returns the path of `node`, or `null` when none is on `PATH`. */
  readonly findNode: () => string | null;
  /** Receives each report line, without a trailing newline. */
  readonly writeLine: (line: string) => void;
  /** Working directory for each gate; defaults to the current one. */
  readonly cwd?: string;
}

/** Exit code returned when `check-node` fails for want of `node` under CI. */
const NO_NODE_EXIT = 1;

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

async function runGate(gate: Gate, options: RunGatesOptions): Promise<number> {
  const started = performance.now();
  const proc = Bun.spawn([...gate.command], {
    cwd: options.cwd,
    env: { ...options.env },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await proc.exited;
  const elapsed = formatSeconds(performance.now() - started);
  options.writeLine(`${gate.name}: exit ${exitCode} (${elapsed})`);
  return exitCode;
}

/**
 * Removes `distDir`, then runs each gate as its own process and writes one
 * line per gate holding its name, exit code and duration. The `check-node`
 * gate is not run when `findNode` returns `null`: it writes
 * {@link CHECK_NODE_SKIPPED} and carries on, unless `env.CI` is `'true'`,
 * where it writes a failing `check-node` line and stops.
 *
 * @param options - Gates, the directory to remove, environment, `node`
 * probe and line writer.
 * @returns `0` when every gate passed or was skipped; otherwise the exit
 * code of the first gate that did not pass.
 */
export async function runGates(options: RunGatesOptions): Promise<number> {
  await rm(options.distDir, { recursive: true, force: true });
  for (const gate of options.gates) {
    if (gate.name === CHECK_NODE && options.findNode() === null) {
      if (options.env['CI'] !== 'true') {
        options.writeLine(CHECK_NODE_SKIPPED);
        continue;
      }
      options.writeLine(`${CHECK_NODE}: exit ${NO_NODE_EXIT} (no node on PATH, CI=true)`);
      return NO_NODE_EXIT;
    }
    const exitCode = await runGate(gate, options);
    if (exitCode !== 0) {
      return exitCode;
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await runGates({
    gates: GATES,
    distDir: 'dist',
    env: process.env,
    findNode: () => Bun.which('node'),
    writeLine: (line) => process.stdout.write(`${line}\n`),
  }));
}
