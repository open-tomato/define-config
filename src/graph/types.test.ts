import type {
  EdgeTarget,
  FlowEntry,
  Flows,
  Graph,
  StepEntry,
  StepRegistry,
} from './types';

import { describe, expect, test } from 'bun:test';

type Outcomes = 'pass' | 'fail';

describe('StepEntry', () => {
  test('refuses a wrong outcome name in on and accepts a right one', () => {
    // @ts-expect-error `passs` is not an outcome of the step
    const bad: StepEntry<Outcomes> = { on: { passs: 'deploy' } };
    const good: StepEntry<Outcomes> = { on: { pass: 'deploy' } };
    expect<unknown[]>([bad.on, good.on]).toEqual([{ passs: 'deploy' }, { pass: 'deploy' }]);
  });

  test('refuses a wrong outcome name in expect and accepts a right one', () => {
    // @ts-expect-error `passs` is not an outcome of the step
    const bad: StepEntry<Outcomes> = { expect: 'passs' };
    const good: StepEntry<Outcomes> = { expect: 'pass' };
    expect<unknown[]>([bad.expect, good.expect]).toEqual(['passs', 'pass']);
  });

  test('refuses a when that is not before: or after: an id', () => {
    // @ts-expect-error `when` is `before:<id>` or `after:<id>`
    const bad: StepEntry<Outcomes, 'lint'> = { when: 'during:lint' };
    const good: StepEntry<Outcomes, 'lint'> = { when: 'after:lint' };
    expect<unknown[]>([bad.when, good.when]).toEqual(['during:lint', 'after:lint']);
  });

  test('accepts repeat: true on an edge object', () => {
    const marked: EdgeTarget = { to: 'build', repeat: true };
    expect(marked).toEqual({ to: 'build', repeat: true });
  });

  test('refuses repeat: 2, repeat: false and repeat: \'twice\' on an edge object', () => {
    // @ts-expect-error `repeat` is the literal `true`, not a number
    const counted: EdgeTarget = { to: 'build', repeat: 2 };
    // @ts-expect-error `repeat` is the literal `true`, not `false`
    const unmarked: EdgeTarget = { to: 'build', repeat: false };
    // @ts-expect-error `repeat` is the literal `true`, not a string
    const worded: EdgeTarget = { to: 'build', repeat: 'twice' };
    expect<unknown[]>([counted, unmarked, worded]).toEqual([
      { to: 'build', repeat: 2 },
      { to: 'build', repeat: false },
      { to: 'build', repeat: 'twice' },
    ]);
  });

  test('types the repeat: true loop mark inside a step entry', () => {
    const entry: StepEntry<Outcomes> = { onFail: { to: 'attempt', repeat: true } };
    expect(entry.onFail).toEqual({ to: 'attempt', repeat: true });
  });

  test('accepts an onChoice map of step ids and edge objects', () => {
    const entry: StepEntry<Outcomes> = { onChoice: { yes: 'deploy', no: { to: 'ask', repeat: true } } };
    expect(entry.onChoice).toEqual({ yes: 'deploy', no: { to: 'ask', repeat: true } });
  });

  test('refuses an onChoice written as a single step id', () => {
    // @ts-expect-error `onChoice` is a map of choice to handler, not one handler
    const bad: StepEntry<Outcomes> = { onChoice: 'x' };
    expect<unknown>(bad.onChoice).toBe('x');
  });

  test('passes any other key through as a step option', () => {
    const entry: StepEntry<Outcomes> = { step: 'run', command: 'bun test', onFail: 'report' };
    expect(entry.command).toBe('bun test');
  });
});

describe('FlowEntry and Flows', () => {
  test('refuses a wrong outcome name inside a flow and accepts a right one', () => {
    // @ts-expect-error `passs` is not an outcome of the flow's steps
    const bad: Flows<Outcomes> = { main: { build: { on: { passs: 'deploy' } } } };
    const good: Flows<Outcomes> = { main: { build: { on: { pass: 'deploy' } } } };
    expect([Object.keys(bad), Object.keys(good)]).toEqual([['main'], ['main']]);
  });

  test('types $start and $unattended beside the step entries', () => {
    // @ts-expect-error `$start` names a step id of the flow
    const bad: FlowEntry<Outcomes, 'build'> = { $start: 'lint', build: {} };
    const good: FlowEntry<Outcomes, 'build'> = { $start: 'build', $unattended: true, build: {} };
    expect<unknown[]>([bad.$start, good.$start]).toEqual(['lint', 'build']);
  });

  test('accepts $start and $unattended beside a step entry with the default type arguments', () => {
    const flow: FlowEntry = { $start: 'build', $unattended: true, build: {} };
    const flows: Flows = { main: { $start: 'build', $unattended: true, build: {} } };
    expect<unknown[]>([flow, flows.main]).toEqual([
      { $start: 'build', $unattended: true, build: {} },
      { $start: 'build', $unattended: true, build: {} },
    ]);
  });

  test('refuses a step id set to a string or a boolean', () => {
    // @ts-expect-error a step id takes a step entry, not a string
    const worded: FlowEntry = { $start: 'build', build: 'deploy' };
    // @ts-expect-error a step id takes a step entry, not a boolean
    const flagged: FlowEntry = { $start: 'build', build: true };
    // @ts-expect-error a step id takes a step entry, not a string, inside Flows too
    const nested: Flows = { main: { build: {}, deploy: 'build' } };
    expect<unknown[]>([worded.build, flagged.build, Object.keys(nested)]).toEqual(['deploy', true, ['main']]);
  });

  test('refuses a $-prefixed key that is not $start or $unattended', () => {
    // @ts-expect-error `$strat` is neither a reserved key nor a step id
    const typo: FlowEntry = { $strat: 'build', build: {} };
    expect(Object.keys(typo)).toEqual(['$strat', 'build']);
  });
});

describe('StepRegistry and Graph', () => {
  test('describe a registry and the graph resolved from it', () => {
    // Arrange
    const registry: StepRegistry = { build: { outcomes: ['pass', 'fail'], required: true } };

    // Act
    const graph: Graph = {
      nodes: {
        'main.build': {
          id: 'build',
          flow: 'main',
          step: 'build',
          outcomes: registry.build?.outcomes ?? [],
          options: {},
          required: true,
          pure: false,
          interactive: false,
        },
      },
      edges: [{ from: 'main.build', to: 'main.build', outcome: 'fail', repeat: 2 }],
      flows: { main: { name: 'main', start: 'main.build', unattended: false, nodes: ['main.build'] } },
    };

    // Assert
    expect(graph.nodes['main.build']?.outcomes).toEqual(['pass', 'fail']);
  });
});
