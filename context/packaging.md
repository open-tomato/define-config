# Packaging

## `bun run check-pack` checks a fresh build, not the current `dist/`

`check-pack` reads the listing from `bun pm pack --dry-run`, and that command runs the
`prepack` script (`bun run build`) first. `build` starts with `rm -rf dist`, so any file
planted under `dist/` is wiped before the listing is taken and `check-pack` exits 0.

To prove the allow-list rejects a stray file, set `prepack` to a no-op in `package.json`,
plant the file, run `bun run check-pack` (it exits 1 and names the path), then restore
`package.json`.

This page replaces no earlier statement; the `check-pack` note in `AGENTS.md` points here.

## `check-pack: ok` is the gate's own line, not a `bun run gates` line

On success `scripts/pack-check.ts` prints `check-pack: ok`, and `bun run gates` passes each
gate's stdout through, so a filter on lines starting with a gate name finds seven lines, not
six. Match the runner's own lines on `: exit ` or `skipped` instead.

This section replaces no earlier statement.
