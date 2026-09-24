/**
 * Spec examples typed as a host would write them: `Flows` values with a
 * wanted loop and an `onChoice` map, and a `LayeredEntry` over a keyed-map
 * root. Checked by `check-types`; each is also run at run time.
 */

import type { LayeredEntry } from '../types';
import type { Flows, StepRegistry } from './types';

import { describe, expect, test } from 'bun:test';

import { merge } from '../merge';

import { resolveGraph } from './index';

const registry: StepRegistry = {
  build: { outcomes: ['success', 'fail'] },
  test: { outcomes: ['success', 'fail'] },
  ask: { outcomes: ['yes', 'no'], interactive: true },
};

describe('spec examples typed as Flows', () => {
  test('an accepted cycle closed by { to, repeat: true } has no cycle', () => {
    // Arrange
    const flows: Flows = {
      next: {
        $start: 'build',
        $unattended: true,
        build: { onSuccess: 'test' },
        test: { onFail: { to: 'build', repeat: true } },
      },
    };

    // Act
    const { diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(diagnostics.filter((d) => d.code === 'cycle')).toEqual([]);
  });

  test('a step entry with an onChoice map resolves without error', () => {
    // Arrange
    const flows: Flows = {
      next: {
        $start: 'ask',
        ask: { onChoice: { yes: 'build', no: { to: 'test' } } },
        build: {},
        test: {},
      },
    };

    // Act
    const { diagnostics } = resolveGraph(flows, registry);

    // Assert
    expect(diagnostics.filter((d) => d.level === 'error')).toEqual([]);
  });

  test('refuses repeat: 2 and onChoice: a string inside a Flows value', () => {
    // Arrange / Act
    const bad: Flows[] = [
      // @ts-expect-error `repeat` accepts only the literal `true`
      { next: { build: { onFail: { to: 'build', repeat: 2 } } } },
      // @ts-expect-error `onChoice` is a map, not a step id
      { next: { ask: { onChoice: 'x' } } },
    ];

    // Assert
    expect(bad).toHaveLength(2);
  });
});

describe('spec example typed as LayeredEntry', () => {
  test('a keyed-map root with $layer merges without diagnostics', () => {
    // Arrange
    type Steps = Record<string, { run: string }>;
    const entry: LayeredEntry<Steps> = {
      $layer: 'project',
      build: { run: 'bun run build' },
    };

    // Act
    const { value, diagnostics } = merge([entry]);

    // Assert
    expect(diagnostics).toEqual([]);
    expect(value).toEqual({ build: { run: 'bun run build' } });
  });
});
