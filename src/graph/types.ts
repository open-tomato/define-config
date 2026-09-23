/**
 * Graph types: the shapes a host writes for its flows (`StepEntry`,
 * `FlowEntry`, `Flows`), the registry it describes its steps with
 * (`StepRegistry`), and the resolved graph handed back (`Graph`).
 *
 * Vocabulary used below:
 * - a **step** is a unit of work the host registers under a step name, with
 *   the outcomes it can end in;
 * - a **step entry** is one use of a step inside a flow, under a step id
 *   unique to that flow;
 * - an **outcome** is the name a step ends with (`'success'`, `'fail'`,
 *   `'true'`, a choice); an edge leaves a step entry on one outcome.
 *
 * @module
 */

/**
 * Where an edge goes: the id of a step entry in the same flow, or an edge
 * object naming that id with its options.
 */
export type EdgeTarget =
  | string
  | {
    /** The id of the step entry the edge goes to. */
    to: string;
    /**
     * How many times this edge may be taken in one run of the flow, for an
     * edge that loops back to an earlier step entry.
     */
    repeat?: number;
  };

/** What a step entry does on an outcome: follow an edge to its target. */
export type Handler = EdgeTarget;

/**
 * One step entry in a flow, typed by the outcomes its step can end in.
 * Every key not named here is one of the step's own options and is passed
 * to the step as is.
 *
 * @typeParam Outcomes - The outcome names the step can end in. A wrong
 * outcome name under `on` or in `expect` is a type error.
 * @typeParam Ids - The step ids `when` may name; any string by default.
 */
export type StepEntry<Outcomes extends string = string, Ids extends string = string> = {
  /** The registered step this entry runs; the entry's own id when absent. */
  step?: string;
  /** The edge to follow on each outcome, keyed by outcome name. */
  on?: Partial<Record<Outcomes, Handler>>;
  /** Sugar for `on: { true: … }`. */
  onTrue?: Handler;
  /** Sugar for `on: { false: … }`. */
  onFalse?: Handler;
  /** Sugar for `on: { success: … }`. */
  onSuccess?: Handler;
  /** Sugar for `on: { fail: … }`. */
  onFail?: Handler;
  /** Sugar for the edge taken on whichever choice an interactive step ends in. */
  onChoice?: Handler;
  /** Places this entry immediately before or after the step entry with that id. */
  when?: `before:${Ids}` | `after:${Ids}`;
  /** The outcome this entry is expected to end in. */
  expect?: Outcomes;
  /** The step's own options. */
  [option: string]: unknown;
};

/**
 * One flow: its step entries keyed by step id, plus the flow's reserved
 * keys. Because `$start` and `$unattended` share the object with the step
 * ids, the value at a step id is typed to admit a string or a boolean too.
 *
 * @typeParam Outcomes - The outcome names the flow's steps can end in.
 * @typeParam Ids - The step ids `$start` and `when` may name.
 */
export type FlowEntry<Outcomes extends string = string, Ids extends string = string> = {
  /** The id of the step entry the flow starts at. */
  $start?: Ids;
  /** `true` marks a flow that runs without user input. */
  $unattended?: boolean;
  /** A step entry, keyed by its step id. */
  [id: string]: StepEntry<Outcomes, Ids> | string | boolean | undefined;
};

/**
 * All flows of a config, keyed by flow name.
 *
 * @typeParam Outcomes - The outcome names the flows' steps can end in.
 * @typeParam Ids - The step ids `$start` and `when` may name.
 */
export type Flows<Outcomes extends string = string, Ids extends string = string> = Record<
  string,
  FlowEntry<Outcomes, Ids>
>;

/**
 * What the host registers for each step, keyed by step name.
 */
export type StepRegistry = Record<
  string,
  {
    /** The outcome names the step can end in. */
    outcomes: string[];
    /** `true` when every flow must keep a step entry running this step. */
    required?: boolean;
    /** `true` when the step has no side effects. */
    pure?: boolean;
    /** `true` when the step asks the user for input. */
    interactive?: boolean;
  }
>;

/** One resolved step entry of a {@link Graph}. */
export interface GraphNode {
  /** The step entry's id in its flow. */
  id: string;
  /** The name of the flow the entry belongs to. */
  flow: string;
  /** The registered step the entry runs. */
  step: string;
  /** The outcome names the step can end in, from the registry. */
  outcomes: string[];
  /** The outcome the entry is expected to end in, when it names one. */
  expect?: string;
  /** The step's own options, as the entry set them. */
  options: Record<string, unknown>;
  /** Whether the step is registered as required. */
  required: boolean;
  /** Whether the step is registered as pure. */
  pure: boolean;
  /** Whether the step is registered as interactive. */
  interactive: boolean;
}

/** One resolved edge of a {@link Graph}: a step entry's outcome and where it goes. */
export interface GraphEdge {
  /** The key in {@link Graph.nodes} of the node the edge leaves. */
  from: string;
  /** The key in {@link Graph.nodes} of the node the edge goes to. */
  to: string;
  /** The outcome the edge is taken on. */
  outcome: string;
  /**
   * The `repeat` of the edge object the handler was written as: `true`, or
   * how many times the edge may be taken in one run, for an edge meant to
   * loop back; `false` for a handler written as an id or without `repeat`.
   */
  repeat: boolean | number;
}

/** One resolved flow of a {@link Graph}. */
export interface FlowSummary {
  /** The flow's name. */
  name: string;
  /** The key in {@link Graph.nodes} of the node the flow starts at. */
  start: string;
  /** Whether the flow runs without user input. */
  unattended: boolean;
  /** The keys in {@link Graph.nodes} of the flow's nodes. */
  nodes: string[];
}

/** The resolved step graph of every flow. */
export interface Graph {
  /** Every node, keyed by a key unique across flows. */
  nodes: Record<string, GraphNode>;
  /** Every edge, in the order the flows declare them. */
  edges: GraphEdge[];
  /** Every flow, keyed by flow name. */
  flows: Record<string, FlowSummary>;
}
