# Reactive Collections

Reference for `ReactiveList<T>`, `ReactiveDictionary<TKey, TValue>`, and `ReactiveSet<T>`, including their
exact dependency-tracking and trigger granularity.

> **Status:** Implemented.

All three types live in `Assimalign.Viu.Reactivity` and ship in the `Assimalign.Viu.Reactivity` package.

```csharp
using Assimalign.Viu.Reactivity;
```

> **About the examples on this page.** The behavioral snippets are lifted from
> `Assimalign.Viu.Reactivity`'s own test suite, so the assertion-style ones use
> [Shouldly](https://docs.shouldly.org/) (`ShouldBeTrue`, `ShouldBeFalse`). To run them yourself, add
> `using Shouldly;` alongside the `using` directive shown. Snippets that are statements only are meant
> to sit inside a method body.

## Why these types exist

Vue makes arrays, `Map`s, and `Set`s reactive by wrapping them in a JavaScript `Proxy` and instrumenting
every mutating method. C# has no `Proxy`, and WASM forbids the reflection an equivalent interceptor would
need, so Viu replaces the proxied built-ins with three first-class collections that carry the
instrumentation in their own member bodies.

- **`ReactiveList<T>`** — the counterpart of a reactive array
  ([`reactive([])`](https://vuejs.org/api/reactivity-core.html#reactive) in Vue).
- **`ReactiveDictionary<TKey, TValue>`** — the counterpart of a reactive `Map`.
- **`ReactiveSet<T>`** — the counterpart of a reactive `Set`.

Each one ports the corresponding dependency-key scheme from `@vue/reactivity` v3.5: Vue's `ARRAY_ITERATE_KEY`,
`ITERATE_KEY`, and `MAP_KEY_ITERATE_KEY` become private per-collection `Dependency` cells, and Vue's per-index
and per-key buckets in `targetMap` become a lazily populated table of `Dependency` cells owned by the
collection instance.

These three are the **complete** set. See [Not yet implemented](#not-yet-implemented) below.

## `ReactiveList<T>`

```csharp
public sealed class ReactiveList<T> : IList<T>, IReadOnlyList<T>, IReactiveTraversable
```

| Member | Signature | Reactive behavior |
| --- | --- | --- |
| Constructor | `ReactiveList()` | Empty list. |
| Constructor | `ReactiveList(int capacity)` | Pre-sized backing storage. |
| Constructor | `ReactiveList(IEnumerable<T> items)` | Seeded; the seed reads are not tracked. Throws `ArgumentNullException` on null. |
| `Count` | `int Count { get; }` | Tracks the **length** dependency. |
| `IsReadOnly` | `bool IsReadOnly => false` | Constant; no tracking. |
| Indexer | `T this[int index] { get; set; }` | Getter tracks that **index**. Setter triggers that index and **iteration** — never length — and only when the value differs. |
| `Add` | `void Add(T item)` | Triggers the new index, iteration, and length. |
| `AddRange` | `void AddRange(IEnumerable<T> items)` | Triggers once for the whole batch. An empty sequence triggers nothing. |
| `Insert` | `void Insert(int index, T item)` | Triggers every index from `index` onward (their elements shifted), plus iteration and length. |
| `RemoveAt` | `void RemoveAt(int index)` | Same fan-out as `Insert`. |
| `RemoveRange` | `void RemoveRange(int index, int count)` | Triggers only when `count > 0`. |
| `Remove` | `bool Remove(T item)` | Delegates to `RemoveAt` when found; returns `false` and triggers nothing when absent. |
| `Clear` | `void Clear()` | Triggers all tracked indices, iteration, and length. **No-op on an already-empty list.** |
| `Contains` | `bool Contains(T item)` | Tracks iteration. |
| `IndexOf` | `int IndexOf(T item)` | Tracks iteration. |
| `CopyTo` | `void CopyTo(T[] array, int arrayIndex)` | Tracks iteration. |
| `GetEnumerator` | `Enumerator GetEnumerator()` | Tracks iteration and returns a non-allocating `struct` enumerator. |

`Enumerator` is a public nested `struct` implementing `IEnumerator<T>` with a `readonly T Current`,
`bool MoveNext()`, and `void Dispose()`, so `foreach` over a `ReactiveList<T>` allocates nothing beyond the
tracking link itself.

### Per-index tracking in practice

```csharp
var list = new ReactiveList<int>(new[] { 1, 2, 3 });
var lengthRuns = 0;
var indexRuns = 0;
var enumerationRuns = 0;
var sum = 0;

Reactive.Effect(() =>
{
    lengthRuns++;
    _ = list.Count;
});

Reactive.Effect(() =>
{
    indexRuns++;
    _ = list[1];
});

Reactive.Effect(() =>
{
    enumerationRuns++;
    sum = 0;
    foreach (var value in list)
    {
        sum += value;
    }
});

// Replacing an existing element runs the index dep and the iteration dep — so enumerating
// effects observe the replacement — but leaves the length dep untouched.
list[1] = 20;
// lengthRuns      == 1
// indexRuns       == 2
// enumerationRuns == 2
// sum             == 24
```

This is the upstream numeric-`SET` rule from `dep.ts`, reproduced exactly. An effect that reads only
`list.Count` is a pure structural observer and never re-runs on element replacement.

## `ReactiveDictionary<TKey, TValue>`

```csharp
public sealed class ReactiveDictionary<TKey, TValue>
    : IDictionary<TKey, TValue>, IReadOnlyDictionary<TKey, TValue>, IReactiveTraversable
    where TKey : notnull
```

| Member | Signature | Reactive behavior |
| --- | --- | --- |
| Constructor | `ReactiveDictionary()` | Empty, default key comparer. |
| Constructor | `ReactiveDictionary(IEqualityComparer<TKey>? comparer)` | Custom key comparer for **storage lookup only**. |
| Constructor | `ReactiveDictionary(IEnumerable<KeyValuePair<TKey, TValue>> items)` | Seeded. |
| `Count` | `int Count { get; }` | Tracks **entry iteration**. |
| `IsReadOnly` | `bool IsReadOnly => false` | Constant; no tracking. |
| `Keys` | `ICollection<TKey> Keys { get; }` | Tracks **keys-only iteration** — the port of `MAP_KEY_ITERATE_KEY`. |
| `Values` | `ICollection<TValue> Values { get; }` | Tracks entry iteration. |
| Indexer | `TValue this[TKey key] { get; set; }` | Getter tracks that **key**. Setting an existing key triggers the key and entry iteration when the value differs; setting a **new** key triggers the key and **both** iteration deps. |
| `Add` | `void Add(TKey key, TValue value)` | Triggers the key and both iteration deps. Throws `ArgumentException` on a duplicate key. |
| `Remove` | `bool Remove(TKey key)` | Triggers the key and both iteration deps when present; triggers nothing when absent. |
| `Clear` | `void Clear()` | Triggers all tracked keys and both iteration deps. **No-op on an already-empty dictionary.** |
| `ContainsKey` | `bool ContainsKey(TKey key)` | Tracks that key. |
| `TryGetValue` | `bool TryGetValue(TKey key, [MaybeNullWhen(false)] out TValue value)` | Tracks that key. |
| `GetEnumerator` | `Enumerator GetEnumerator()` | Tracks entry iteration; non-allocating `struct` enumerator over `KeyValuePair<TKey, TValue>`. |

### Keys-only iteration is a separate dependency

```csharp
var dictionary = new ReactiveDictionary<string, int> { ["a"] = 1, ["b"] = 2 };
var runs = 0;
var seen = 0;

Reactive.Effect(() =>
{
    runs++;
    seen = dictionary["a"];
});

dictionary["b"] = 20;   // a different key: no re-run          -> runs == 1
dictionary["a"] = 10;   // this key changed                    -> runs == 2
dictionary["a"] = 10;   // equal value, EqualityComparer<int>  -> runs == 2

// An effect that reads Keys subscribes to keys-only iteration, so it re-runs on ADD and
// DELETE but never on a value replacement.
var keysDictionary = new ReactiveDictionary<string, int> { ["a"] = 1 };
var keyRuns = 0;
var keyCount = 0;

Reactive.Effect(() =>
{
    keyRuns++;
    keyCount = keysDictionary.Keys.Count;
});

keysDictionary["a"] = 99;    // value replacement -> keyRuns == 1
keysDictionary.Add("b", 2);  // structural change -> keyRuns == 2, keyCount == 2
```

## `ReactiveSet<T>`

```csharp
public sealed class ReactiveSet<T> : ISet<T>, IReadOnlyCollection<T>, IReactiveTraversable
```

| Member | Signature | Reactive behavior |
| --- | --- | --- |
| Constructor | `ReactiveSet()` | Empty, default member comparer. |
| Constructor | `ReactiveSet(IEqualityComparer<T>? comparer)` | Custom member comparer for **storage lookup only**. |
| Constructor | `ReactiveSet(IEnumerable<T> items)` | Seeded. |
| `Count` | `int Count { get; }` | Tracks **iteration**. |
| `IsReadOnly` | `bool IsReadOnly => false` | Constant; no tracking. |
| `Add` | `bool Add(T item)` | Triggers that **member** and iteration when newly added; **a no-op add triggers nothing**. |
| `Remove` | `bool Remove(T item)` | Triggers that member and iteration when present; **a no-op remove triggers nothing**. |
| `Clear` | `void Clear()` | Triggers all tracked members and iteration. **No-op on an already-empty set.** |
| `Contains` | `bool Contains(T item)` | Tracks that member only. |
| `UnionWith` | `void UnionWith(IEnumerable<T> other)` | Triggers each newly added member, then iteration **exactly once**. |
| `ExceptWith` | `void ExceptWith(IEnumerable<T> other)` | Triggers each removed member, then iteration once. |
| `IntersectWith` | `void IntersectWith(IEnumerable<T> other)` | Triggers each removed member, then iteration once. |
| `SymmetricExceptWith` | `void SymmetricExceptWith(IEnumerable<T> other)` | Triggers each toggled member, then iteration once. |
| `IsSubsetOf` | `bool IsSubsetOf(IEnumerable<T> other)` | Tracks iteration. |
| `IsSupersetOf` | `bool IsSupersetOf(IEnumerable<T> other)` | Tracks iteration. |
| `IsProperSubsetOf` | `bool IsProperSubsetOf(IEnumerable<T> other)` | Tracks iteration. |
| `IsProperSupersetOf` | `bool IsProperSupersetOf(IEnumerable<T> other)` | Tracks iteration. |
| `Overlaps` | `bool Overlaps(IEnumerable<T> other)` | Tracks iteration. |
| `SetEquals` | `bool SetEquals(IEnumerable<T> other)` | Tracks iteration. |
| `CopyTo` | `void CopyTo(T[] array, int arrayIndex)` | Tracks iteration. |
| `GetEnumerator` | `Enumerator GetEnumerator()` | Tracks iteration; non-allocating `struct` enumerator. |

The four bulk operations collect the members that **actually** changed, trigger each of those member cells,
and then trigger iteration once. A bulk call that changes nothing triggers nothing at all.

```csharp
var set = new ReactiveSet<int>();
var runs = 0;
var has = false;

Reactive.Effect(() =>
{
    runs++;
    has = set.Contains(5);
});

set.Add(5);   // runs == 2, has == true
set.Add(6);   // a different member: a Contains(5) effect does not re-run -> runs == 2

// UnionWith triggers iteration once for the whole batch of new members.
var other = new ReactiveSet<int> { 1 };
var countRuns = 0;
var count = 0;

Reactive.Effect(() =>
{
    countRuns++;
    count = other.Count;
});

other.UnionWith(new[] { 1, 2, 3 }); // 1 is already present; 2 and 3 are new
// countRuns == 2 (not 3), count == 3
```

`T` is deliberately left **unconstrained**, so `null` is a legal set member. Null routes to a dedicated null
dependency cell, because `Dictionary<TKey, TValue>` — the backing store for per-member cells — rejects null
keys.

## Trigger granularity matrix

The exact fan-out is easy to get wrong, so it is pinned by tests and stated here in full.

| Operation | Per-index / per-key / per-member dep | Iteration dep | Secondary dep |
| --- | --- | --- | --- |
| `ReactiveList<T>` — read `list[i]` | tracks index `i` | — | — |
| `ReactiveList<T>` — read `list.Count` | — | — | tracks length |
| `ReactiveList<T>` — assign existing index (changed) | triggers that index | triggers | **length NOT triggered** |
| `ReactiveList<T>` — assign existing index (equal value) | — | — | — |
| `ReactiveList<T>` — `Add` / `AddRange` | triggers the newly occupied indices | triggers | triggers length |
| `ReactiveList<T>` — `Insert` / `RemoveAt` / `RemoveRange` / `Remove` | triggers every tracked index from the mutation point onward | triggers | triggers length |
| `ReactiveDictionary<,>` — read `dict[k]` / `ContainsKey` / `TryGetValue` | tracks key `k` | — | — |
| `ReactiveDictionary<,>` — read `Keys` | — | — | tracks keys-only iteration |
| `ReactiveDictionary<,>` — read `Count` / `Values` / enumerate | — | tracks entry iteration | — |
| `ReactiveDictionary<,>` — set existing key (changed) | triggers that key | triggers entry iteration | **keys-only NOT triggered** |
| `ReactiveDictionary<,>` — `Add` / set new key / `Remove` | triggers that key | triggers entry iteration | triggers keys-only iteration |
| `ReactiveSet<T>` — `Contains` | tracks that member | — | — |
| `ReactiveSet<T>` — `Add` (new) / `Remove` (present) | triggers that member | triggers | — |
| `ReactiveSet<T>` — no-op `Add` / no-op `Remove` | — | — | — |
| `ReactiveSet<T>` — bulk set operation | triggers each changed member | triggers **once** | — |
| All three — `Clear()` on a non-empty collection | triggers all tracked cells | triggers | triggers length (list) / keys-only (dictionary) |
| All three — `Clear()` on an **empty** collection | — | — | — |

## Dependency cells are lazy

Per-index, per-key, and per-member `Dependency` cells are created **on the first tracked read** and reused
thereafter. An internal `ReactivityState.CanTrack` check (there is an active subscriber *and* tracking is
enabled) gates the creation, so reading `list[3]` outside any effect, computed, or watcher allocates
nothing — no cell, no dictionary entry, no link node. Steady-state reads and writes after the first tracked
read allocate nothing either. `ReactivityState` is not public API; the observable consequence is what
matters here, not the gate itself.

The practical consequence: mutating an index or key that no effect has ever read is close to free, because
`Trigger` finds no cell to notify.

## Watching a collection

The snippets below use this `[Reactive]` class as the element type (the same shape used on
[Reactivity API: Utilities & Advanced](reactivity-utilities.md)):

```csharp
using Assimalign.Viu.Reactivity;

[Reactive]
public partial class ReactivePerson
{
    public partial string Name { get; set; }
}
```

Reactive collections implement `IReactiveTraversable` but **not** `IReactiveObject`. That is deliberate —
they have no fixed named-property surface for `GetDependency(string)` to answer over. It also means the
`IReactiveObject` overload of `Reactive.Watch` does not apply:

```csharp
var list = new ReactiveList<ReactivePerson>();

// DOES NOT COMPILE — the `where TReactive : class, IReactiveObject` constraint fails.
// Reactive.Watch(list, (_, _, _) => { });
```

Use the getter overload and opt into `Deep` explicitly:

```csharp
var first = new ReactivePerson { Name = "A" };
var list = new ReactiveList<ReactivePerson> { first };
var runs = 0;

Reactive.Watch(() => list, (_, _, _) => runs++, new WatchOptions { Deep = true });
// runs == 0 — not immediate

first.Name = "B";                                // nested reactive element -> runs == 1
list.Add(new ReactivePerson { Name = "C" });     // structural change       -> runs == 2
```

Traversal descends only through `IReference` cells and `IReactiveTraversable` values, so a deep watch reaches
a nested `[Reactive]` element but treats a plain CLR object as a leaf. Each collection contributes its
iteration dependency and then visits its contents: a list visits every element, a set visits every member,
and a **dictionary visits every value — not its keys**.

Inside a component, prefer `ViuWatch.Watch` from `Assimalign.Viu.RuntimeCore` so the watcher gets a
scheduler and is bound to the component scope. See [Watchers](../guide/essentials/watchers.md) for the flush
rules, and remember that `WatchOptions.Flush` defaults to `WatchFlushMode.Sync` in Viu, not `Pre`.

## Rendering a collection

`ReactiveList<T>` is the source you want behind `v-for` when the list itself mutates — its iteration and
length dependencies are what make the render effect re-run, and the renderer's keyed longest-increasing-
subsequence diff then moves nodes rather than recreating them. See
[Conditional & List Rendering](../guide/essentials/conditional-and-list.md).

## Raw access

`Reactive.ToRaw` has a dedicated overload for each collection, and unlike the generic overload these
genuinely escape the instrumentation:

```csharp
public static List<T> ToRaw<T>(ReactiveList<T> list);
public static Dictionary<TKey, TValue> ToRaw<TKey, TValue>(ReactiveDictionary<TKey, TValue> dictionary)
    where TKey : notnull;
public static HashSet<T> ToRaw<T>(ReactiveSet<T> set);
```

Each returns the **live underlying storage**. Reads off it do not track and writes through it do not trigger,
but it is the same data the instrumented members operate on.

```csharp
var list = new ReactiveList<int> { 1, 2 };
var runs = 0;
var seenCount = 0;

Reactive.Effect(() =>
{
    runs++;
    seenCount = list.Count;
});
// runs == 1, seenCount == 2

var raw = Reactive.ToRaw(list);
raw.Add(3);      // same storage, no trigger -> runs == 1, raw.Count == 3
list.Add(4);     // reactive mutation        -> runs == 2
```

This differs from the generic `Reactive.ToRaw<T>(T)`, which returns a `[Reactive]` object **by identity** —
reads through that result still track. See
[Reactivity API: Utilities & Advanced](reactivity-utilities.md).

## Classification and equality

```csharp
Reactive.IsReactive(new ReactiveList<int>()).ShouldBeTrue();
Reactive.IsReactive(new ReactiveDictionary<string, int>()).ShouldBeTrue();
Reactive.IsReactive(new ReactiveSet<int>()).ShouldBeTrue();

Reactive.IsRef(new ReactiveList<int>()).ShouldBeFalse();   // collections are not refs
```

`Reactive.IsReactive` keys on `IReactiveTraversable`, which is why all three report `true` — unless the
instance has been passed through `Reactive.MarkRaw`, which excludes it from traversal and flips
`IsReactive` to `false` permanently.

Two different equality mechanisms are in play, and conflating them is a common mistake:

- **The comparer you pass to the constructor** — `ReactiveDictionary(IEqualityComparer<TKey>?)` and
  `ReactiveSet(IEqualityComparer<T>?)` govern **storage lookup**: which key or member an operation lands on.
- **The value-change cutoff** — always `EqualityComparer<T>.Default`, hardwired. It decides whether an
  indexer assignment counts as a change at all. There is no way to inject a custom comparer for it.

Like Vue's `Object.is`, `EqualityComparer<double>.Default` treats `NaN` as self-equal; **unlike** `Object.is`,
it treats `+0.0` and `-0.0` as equal. See [Differences from Vue 3](../roadmap/vue-differences.md).

## Thread safety

None of these types is thread-safe, and neither is anything else in `Assimalign.Viu.Reactivity`. The
dependency cells, the ambient active subscriber, and the batch queues are all plain static or instance state
with no synchronization. This is a design decision for the single-threaded browser event-loop model, not a
gap — multi-threaded use is unsupported.

## Not yet implemented

> **Status:** Planned — not present in the codebase.

- **No other reactive collections** — there is no `ReactiveQueue`, no reactive stack, and no reactive
  observable-collection type. `ReactiveList<T>`, `ReactiveDictionary<TKey, TValue>`, and `ReactiveSet<T>` are
  the complete set.
- **No `INotifyPropertyChanged` / `INotifyCollectionChanged` bridging** — these collections do not implement
  the classic .NET change-notification interfaces, and there is no adapter that projects an
  `ObservableCollection<T>` into Viu's dependency graph or vice versa.
- **No custom value-change comparer** — the change cutoff is hardwired to `EqualityComparer<T>.Default`
  across refs, computeds, generated properties, and these collections.
- **No public object-plus-key tracking API** — Viu's port of Vue's `targetMap` (`TargetTracking`) is
  internal, so you cannot register arbitrary external containers into the same tracking scheme. The public
  extension point for a hand-written reactive source is the `Dependency` type's `Track()` and `Trigger()`.

## See also

- [Reactivity API: Core](reactivity-core.md) — refs, computeds, effects, and scopes.
- [Reactivity API: Utilities & Advanced](reactivity-utilities.md) — `ToRaw`, `MarkRaw`, and introspection.
- [Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md) — the `[Reactive]` generator.
- [Watchers](../guide/essentials/watchers.md) — flush modes and the deep-watch options.
- [Project Status](../roadmap/status.md) — area-by-area coverage.
