/**
 * Entry types: the shapes a host writes into `defineConfig([...])`, derived
 * from the config type `T` the host's schema infers.
 *
 * Vocabulary used below:
 * - a **keyed map** is an object type with a string index signature
 *   (`Record<string, V>`, `{ [id: string]: V }`); its keys are ids the host
 *   does not know in advance.
 * - a **subtree** is any object-typed value below the root, keyed map or not.
 * - a **leaf** is a scalar, a function or an array. Arrays are values, not
 *   maps: a later entry's list replaces an earlier one whole.
 *
 * @module
 */

/** Values that entries never descend into. Arrays are handled beside it. */
type Leaf =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | ((...args: never[]) => unknown);

/** `true` when `K` is the key type of an index signature rather than a named key. */
type IsIndexKey<K> = string extends K
  ? true
  : number extends K
    ? true
    : false;

/** The named (non-index-signature) keys of `T`. */
type KnownKeys<T> = keyof {
  [K in keyof T as IsIndexKey<K> extends true
    ? never
    : K]: 0;
};

/** The value type of `T`'s string index signature, or `never` when it has none. */
type IndexValue<T> = string extends keyof T
  ? T extends { [key: string]: infer V }
    ? V
    : never
  : never;

/** First dot-separated segment of each required path in `P`. */
type Head<P extends string> = P extends `${infer H}.${string}`
  ? H
  : P;

/** What remains of each required path in `P` below the segment `K`. */
type Tail<P extends string, K extends string> = P extends `${K}.${infer Rest}`
  ? Rest
  : never;

/**
 * `T` with every property at every depth made optional. Leaves are kept
 * whole: a partial string is the string, and a partial list is the full list
 * (lists replace, they do not merge). Distributes over unions.
 *
 * @typeParam T - The config type, or any part of it.
 */
export type DeepPartial<T> = T extends Leaf | readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * The keys of `T`, each optional, index signature included. Entry and
 * replace shapes are built as ONE mapped type over a skeleton like this one,
 * never as an intersection of a named part and an index-signature part:
 * such an intersection, placed in a union beside a `$replace` shape, made
 * TypeScript accept a stray `true` at a map id (`{ steps: { lint: true } }`).
 */
type OptionalKeys<T> = { [K in keyof T]?: 0 };

/** Ids of a keyed map `T` that a required path in `Required` names. */
type RequiredIds<T, Required extends string> = string extends keyof T
  ? Exclude<Head<Required>, KnownKeys<T>>
  : never;

/**
 * The value an entry may set at key `K` of an object of type `T`:
 * - an index-signature key (any id of a keyed map): an entry, a `$replace`
 *   or `false`;
 * - a named key: an entry or a `$replace`, never `false`;
 * - an id a required path names: an entry or a `$replace` carrying the rest
 *   of the path down, and `false` only when no required path ends there.
 */
type EntryAt<T, Required extends string, K> = IsIndexKey<K> extends true
  ? EntryValue<IndexValue<T>, never> | false | undefined
  : K extends KnownKeys<T>
    ? EntryValue<T[K & keyof T], Tail<Required, K & string>>
    : | EntryValue<IndexValue<T>, Tail<Required, K & string>>
      | (K extends Required
        ? never
        : false);

/** Maps skeleton `S` (the keys, with their modifiers) to entry values. */
type EntryShape<S, T, Required extends string> = {
  [K in keyof S]: EntryAt<T, Required, K>;
};

/** An entry for an object type: its named keys plus its keyed-map ids. */
type EntryObject<T, Required extends string> = EntryShape<
  OptionalKeys<T> & { [K in RequiredIds<T, Required>]?: 0 },
  T,
  Required
>;

/**
 * Maps skeleton `S` to the values of a replacing subtree. `$replace` is a
 * named key of the same object literal, and TypeScript checks named keys
 * against the index signature too, so over a keyed map the signature admits
 * `true` beside the partial value. The cost: inside a `$replace` object over
 * a keyed map, an id set to `true` is not refused by the type.
 */
type ReplaceShape<S, T> = {
  [K in keyof S]: K extends '$replace'
    ? true
    : IsIndexKey<K> extends true
      ? DeepPartial<IndexValue<T>> | true | undefined
      : DeepPartial<T[K & keyof T]>;
};

/**
 * The value a `{ $replace: true, …rest }` subtree takes when it stands in
 * for a value of type `T`: the marker plus a {@link DeepPartial} of `T`.
 * At merge time the subtree at that key becomes `rest`, discarding what
 * earlier entries put there. Leaves (scalars, functions, arrays) have no
 * subtree to replace, so `Replace` of a leaf is `never`: a `$replace` on a
 * scalar is a type error.
 *
 * @typeParam T - The type of the subtree being replaced.
 */
export type Replace<T> = T extends Leaf | readonly unknown[]
  ? never
  : T extends object
    ? ReplaceShape<{ $replace: 0 } & OptionalKeys<T>, T>
    : never;

/** A value under a key: either an entry for it, or a `$replace` of it. */
type EntryValue<T, Required extends string> =
  | EntryNode<T, Required>
  | Replace<T>;

/** An entry for a value of type `T`: leaves whole, objects recursively. */
type EntryNode<T, Required extends string> = T extends Leaf | readonly unknown[]
  ? T
  : T extends object
    ? EntryObject<T, Required>
    : T;

/**
 * One config entry for a config of type `T`: a {@link DeepPartial} of `T`
 * in which, additionally,
 * - every keyed-map id also accepts `false`, which removes that id;
 * - every subtree below the root also accepts `{ $replace: true, …rest }`
 *   (see {@link Replace}), which replaces that subtree with `rest`.
 *
 * `Required` lists dot-joined key paths (`'a.x'`, `'flows.main.build'`)
 * that must survive the merge; a `false` whose key path is one of them is a
 * type error. The type does not refuse a `$replace` that drops a required
 * path, since what `rest` keeps is only known once entries merge; the
 * `required` option of `merge` reports that case. Keys that themselves
 * contain a dot cannot be named in `Required`.
 *
 * @typeParam T - The config type, derived from the host's schema.
 * @typeParam Required - Dot-joined key paths `false` may not remove.
 */
export type ConfigEntry<T, Required extends string = never> = EntryNode<T, Required>;

/**
 * A {@link ConfigEntry} with its layer label, as a loader or a host hands
 * it to `merge`. `$layer` names the layer (`'defaults'`, `'user'`,
 * `'project'` or any string); two entries of the same layer that set the
 * same key are duplicates, entries of different layers override silently.
 *
 * @typeParam T - The config type, derived from the host's schema.
 * @typeParam Required - Dot-joined key paths `false` may not remove.
 */
export type LayeredEntry<T, Required extends string = never> = ConfigEntry<T, Required> & {
  /** The layer this entry belongs to. */
  $layer?: string;
};
