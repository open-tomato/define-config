/**
 * `defineConfig`: the typed front door of a config file.
 *
 * @module
 */

import type { ConfigEntry } from './types';

/**
 * Declare a list of config entries for a config of type `T`. At runtime
 * this is the identity: it returns the very array it is given, unchanged.
 * It exists for its parameter type, so that an editor flags a wrong key, a
 * `$replace` on a scalar or a `false` on a required key while the entries
 * are written, before anything merges them.
 *
 * @example
 * ```ts
 * export default defineConfig<Config, 'steps.build'>([
 *   { steps: { lint: false } },
 *   { steps: { build: { $replace: true, run: 'bun run build' } } },
 * ]);
 * ```
 *
 * @typeParam T - The config type, derived from the schema the host validates with.
 * @typeParam Required - Dot-joined key paths a `false` may not remove.
 * @param entries - The entries, in the order they apply.
 * @returns `entries`, the same array.
 */
export function defineConfig<T, Required extends string = never>(
  entries: ConfigEntry<T, Required>[],
): ConfigEntry<T, Required>[] {
  return entries;
}
