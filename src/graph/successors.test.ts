import type { Graph, GraphNode } from './types';

import { describe, expect, test } from 'bun:test';

import { successors } from './successors';

/** A node of flow `f` with the given id. */
function node(id: string): GraphNode {
  return { id, flow: 'f', step: id, outcomes: ['success', 'fail'], options: {}, required: false, pure: false, interactive: false };
}

/** A graph of one flow `f` over nodes `f.a`, `f.b`, `f.c`, `f.d`. */
function graph(parts: Pick<Graph, 'edges' | 'hooks'>): Graph {
  const keys = ['f.a', 'f.b', 'f.c', 'f.d'];
  return {
    nodes: Object.fromEntries(keys.map((key) => [key, node(key.slice(2))])),
    edges: parts.edges,
    hooks: parts.hooks,
    flows: { f: { name: 'f', start: 'f.a', unattended: false, nodes: keys } },
  };
}

describe('successors', () => {
  test('an edge leads from its from to its to', () => {
    // Arrange
    const input = graph({ edges: [{ from: 'f.a', to: 'f.b', outcome: 'success', repeat: false }], hooks: [] });

    // Act
    const next = successors(input);

    // Assert
    expect(next.get('f.a')).toEqual(['f.b']);
  });

  test('a repeat edge is included', () => {
    // Arrange
    const input = graph({ edges: [{ from: 'f.b', to: 'f.a', outcome: 'fail', repeat: true }], hooks: [] });

    // Act
    const next = successors(input);

    // Assert
    expect(next.get('f.b')).toEqual(['f.a']);
  });

  test('a hook leads from its anchor to the hooked node, after the edges', () => {
    // Arrange
    const input = graph({
      edges: [{ from: 'f.a', to: 'f.b', outcome: 'success', repeat: false }],
      hooks: [
        { flow: 'f', node: 'f.d', anchor: 'f.a', position: 'after' },
        { flow: 'f', node: 'f.c', anchor: 'f.a', position: 'before' },
      ],
    });

    // Act
    const next = successors(input);

    // Assert
    expect(next.get('f.a')).toEqual(['f.b', 'f.d', 'f.c']);
    expect(next.has('f.d')).toBe(false);
  });

  test('a node with no edge and no hook has no successors', () => {
    // Arrange
    const input = graph({ edges: [{ from: 'f.a', to: 'f.b', outcome: 'success', repeat: false }], hooks: [] });

    // Act
    const next = successors(input);

    // Assert
    expect(next.get('f.b')).toBeUndefined();
    expect([...next.keys()]).toEqual(['f.a']);
  });
});
