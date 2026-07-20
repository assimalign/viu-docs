# Reactivity API: Core

Signature reference for refs, computeds, effects, scopes, and watchers in `Assimalign.Viu.Reactivity`.

> **Status:** Implemented.

Everything on this page is a port of [`@vue/reactivity`](https://vuejs.org/api/reactivity-core.html)
v3.5. The engine is the same `Dep`/`Sub`/`Link` graph with version-based dependency cleanup, a
global-version fast path for computeds, batching, and pause/resume — renamed into C# and compiled
ahead of time. For the teaching path, read
[Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md),
[Computed Properties](../guide/essentials/computed.md), and
[Watchers](../guide/essentials/watchers.md); this page is the lookup table.

Namespace: `Assimalign.Viu.Reactivity`. A project or package reference to
`Assimalign.Viu.Reactivity` is all you need — the `[Reactive]` source generator ships inside that
package.

Viu does not enable `ImplicitUsings`, so every example on this page assumes these directives are in
scope and only repeats them where a *different* namespace is also required:

```csharp
using System;
using System.Collections.Generic;
using Assimalign.Viu.Reactivity;
```

## Vue-to-Viu naming map

Viu spells out every abbreviation and PascalCases every member. There is **no type named `Ref`** in
the library.

| Vue 3 | Viu | Notes |
| --- | --- | --- |
| [`ref()`](https://vuejs.org/api/reactivity-core.html#ref) | `Reactive.Reference<T>` | Returns the type `Reference<T>` — method and type share a name |
| [`shallowRef()`](https://vuejs.org/api/reactivity-advanced.html#shallowref) | `Reactive.ShallowReference<T>` | Returns `ShallowReference<T>` |
| [`customRef()`](https://vuejs.org/api/reactivity-advanced.html#customref) | `Reactive.CustomReference<T>` | Returns `CustomReference<T>` |
| [`computed()`](https://vuejs.org/api/reactivity-core.html#computed) | `Reactive.Computed<T>` | Returns `Computed<T>` |
| `effect()` (not in Vue's public API docs) | `Reactive.Effect` | Returns `ReactiveEffect`; runs immediately |
| [`effectScope()`](https://vuejs.org/api/reactivity-advanced.html#effectscope) | `Reactive.EffectScope` | Returns `EffectScope` |
| [`getCurrentScope()`](https://vuejs.org/api/reactivity-advanced.html#getcurrentscope) | `Reactive.CurrentScope` | A **property**, not a method |
| [`onScopeDispose()`](https://vuejs.org/api/reactivity-advanced.html#onscopedispose) | `Reactive.OnScopeDispose` | Adds a Viu-only `failSilently` parameter |
| [`triggerRef()`](https://vuejs.org/api/reactivity-advanced.html#triggerref) | `Reactive.TriggerReference` | |
| `pauseTracking()` / `resetTracking()` | `Reactive.PauseTracking` / `Reactive.ResetTracking` | |
| [`watch()`](https://vuejs.org/api/reactivity-core.html#watch) | `Reactive.Watch` / `ViuWatch.Watch` | Five source shapes each |
| [`watchEffect()`](https://vuejs.org/api/reactivity-core.html#watcheffect) | `Reactive.WatchEffect` / `ViuWatch.WatchEffect` | |
| `.value` | `.Value` | Capital V, everywhere |
| `flush: 'sync' \| 'pre' \| 'post'` | `WatchFlushMode.Sync` / `.Pre` / `.Post` | |
| `deep: number` | `WatchOptions.DeepDepth` (`int?`) | Alongside the boolean `WatchOptions.Deep` |
| `Dep` | `Dependency` | Only `Track()` / `Trigger()` are public |
| `Sub` / `Subscriber` | `Subscriber` | Public abstract, zero public members; its constructor is `private protected`, so only `ReactiveEffect` and `Computed<T>` derive from it |
| `traverse()` | `new ReactiveTraversal(depth).Visit(value)` | A class, not a static helper: construct one per traversal with a depth ceiling |

Introspection and unwrapping (`IsRef`, `IsReactive`, `IsReadonly`, `Unref`, `ToRef`, `ToRaw`,
`MarkRaw`, `StartBatch`/`EndBatch`) and the `[Reactive]` generator live on
[Reactivity API: Utilities & Advanced](reactivity-utilities.md).

## Three rules that apply to everything below

- **`WatchOptions.Flush` defaults to `WatchFlushMode.Sync`** — Vue's default is `pre`. Nothing on
  this page is pre-flush unless you ask for it or you go through `ViuWatch`. `Pre` and `Post`
  additionally require a `WatchOptions.Scheduler`; without one they silently fall back to
  synchronous delivery, and **no `IWatchScheduler` implementation ships in this library**.
- **Change detection is `EqualityComparer<T>.Default`, not `Object.is`** — like `Object.is`, `NaN`
  is self-equal, so writing `double.NaN` over `double.NaN` does not trigger. Unlike `Object.is`,
  `+0.0` and `-0.0` compare equal. There is no way to inject a custom `IEqualityComparer<T>`.
- **Nothing here is thread-safe** — the ambient subscriber, the tracking flag, the global version,
  the batch queues, and `EffectScope.Current` are all plain static fields with no synchronization.
  This is a design decision for the single-threaded browser event loop, not a gap.

## References

### `Reactive.Reference<T>`

```csharp
public static Reference<T> Reference<T>(T value);
```

Vue counterpart: [`ref()`](https://vuejs.org/api/reactivity-core.html#ref). Creates the primary
reactivity primitive. Reading `.Value` inside an active subscriber establishes a dependency;
writing a *different* value notifies subscribers.

```csharp
var count = Reactive.Reference(1);
var seen = 0;

Reactive.Effect(() => seen = count.Value); // runs immediately: seen == 1

count.Value = 7;                           // seen == 7
count.Value = 7;                           // equal value: the effect does not re-run
```

`Reference<T>` tracks the `Value` cell only — there is no deep conversion of the value it holds,
and it never boxes `T`.

```csharp
public sealed class Reference<T> : IReference<T>
{
    public Reference(T value);
    public T Value { get; set; }
}
```

The declaration in source also lists `ITrackedReference`, but that interface is `internal` — it is
how `Reactive.TriggerReference` reaches a ref's `Dependency` without knowing the concrete type, and
it is not part of the surface you can consume or implement. The same applies to
`ShallowReference<T>`, `CustomReference<T>`, and `Computed<T>`.

### `Reactive.ShallowReference<T>`

```csharp
public static ShallowReference<T> ShallowReference<T>(T value);
```

Vue counterpart: [`shallowRef()`](https://vuejs.org/api/reactivity-advanced.html#shallowref). Only
*replacing* `Value` triggers; mutating the held object in place never notifies. Pair it with
`Reactive.TriggerReference` when you mutate in place deliberately.

```csharp
var list = Reactive.ShallowReference(new List<int> { 1 });
var lastCount = 0;

Reactive.Effect(() => lastCount = list.Value.Count); // lastCount == 1

list.Value.Add(2);                 // in-place mutation: no notification, lastCount still 1
Reactive.TriggerReference(list);   // forced: the effect re-runs, lastCount == 2
```

The implementation is byte-for-byte identical to `Reference<T>`; the distinction is kept purely for
upstream API parity, and `Reactive.IsRef` is true for both.

### `Reactive.CustomReference<T>`

```csharp
public static CustomReference<T> CustomReference<T>(CustomReferenceFactory<T> factory);

public delegate (Func<T> Get, Action<T> Set) CustomReferenceFactory<T>(Action track, Action trigger);
```

Vue counterpart: [`customRef()`](https://vuejs.org/api/reactivity-advanced.html#customref). The
factory receives `track` and `trigger` delegates already bound to this ref's dependency and returns
a named-tuple getter/setter pair. The ref performs **no** automatic tracking, triggering, or change
detection of its own — you own all three. It throws `ArgumentNullException` if the factory, or the
getter or setter it returns, is null.

This is the debounced-ref shape from the Vue docs, with an explicit flush standing in for a timer:

```csharp
Action? flush = null;
var backing = 0;

var debounced = Reactive.CustomReference<int>((track, trigger) => (
    Get: () =>
    {
        track();
        return backing;
    },
    Set: value =>
    {
        backing = value;
        flush = trigger; // defer the notification instead of triggering now
    }));

var seen = -1;
Reactive.Effect(() => seen = debounced.Value); // seen == 0

debounced.Value = 5; // stored, but no trigger yet — seen is still 0
flush!();            // now the effect re-runs and seen == 5
```

### `IReference` and `IReference<T>`

```csharp
public interface IReference
{
    object? Value { get; }
}

public interface IReference<T> : IReference
{
    new T Value { get; set; }
}
```

`IReference` is the non-generic marker every ref-like container implements — it is what
`Reactive.IsRef` checks and what makes introspection O(1) and reflection-free. Reading `Value`
through the non-generic interface boxes value types; reading through `IReference<T>` does not. Both
reads are tracked.

Implemented by `Reference<T>`, `ShallowReference<T>`, `CustomReference<T>`, `Computed<T>`, and the
`AccessorReference<T>` behind `Reactive.ToRef` and a generated `ToReferences()`. That last one is an
`internal` type — you receive it typed as `IReference<T>` and never name it.

## `Computed<T>`

```csharp
public static Computed<T> Computed<T>(Func<T> getter, Action<T>? setter = null);

public sealed class Computed<T> : Subscriber, IReference<T>, IReadonlyReactive
{
    public Computed(Func<T> getter, Action<T>? setter = null);
    public bool IsWritable { get; }   // true when a setter was supplied
    public T Value { get; set; }
}
// Source also lists the internal ITrackedReference; IReadonlyReactive.IsReadonly is an
// explicit implementation, so it is reached through Reactive.IsReadonly, not off the class.
```

Vue counterpart: [`computed()`](https://vuejs.org/api/reactivity-core.html#computed). A computed is
a `Dependency` to its readers and a `Subscriber` to its sources. It is **lazy** — the getter does
not run at construction — and version-cached with a global-version fast path.

```csharp
var count = Reactive.Reference(1);
var getterRuns = 0;

var doubled = Reactive.Computed(() =>
{
    getterRuns++;
    return count.Value * 2;
});

// getterRuns == 0: nothing has read it yet.
_ = doubled.Value;   // 2, getterRuns == 1
_ = doubled.Value;   // 2, still getterRuns == 1 — cached

count.Value = 5;
count.Value = 6;
// getterRuns == 1: invalidated, but not recomputed until read.

_ = doubled.Value;   // 12, getterRuns == 2 — exactly one recomputation
```

Recomputing to an **equal** value (`EqualityComparer<T>.Default`) does not notify downstream, so a
predicate computed absorbs churn in its source:

```csharp
var a = Reactive.Reference(1);
var effectRuns = 0;
var positive = Reactive.Computed(() => a.Value > 0);

Reactive.Effect(() =>
{
    effectRuns++;
    _ = positive.Value;
});                  // effectRuns == 1

a.Value = 2;         // recomputes to the same `true` — effectRuns stays 1
a.Value = -1;        // value actually changes — effectRuns == 2
```

### Writable computeds

Pass a setter for the writable variant:

```csharp
var first = Reactive.Reference("John");
var last = Reactive.Reference("Doe");

var full = Reactive.Computed(
    () => first.Value + " " + last.Value,
    value =>
    {
        var parts = value.Split(' ');
        first.Value = parts[0];
        last.Value = parts[1];
    });

// full.IsWritable is true, full.Value is "John Doe"
full.Value = "Jane Smith";   // first.Value == "Jane", last.Value == "Smith"
```

Writing a **getter-only** computed throws:

```csharp
var readOnly = Reactive.Computed(() => 1);
// readOnly.IsWritable is false
readOnly.Value = 5;   // throws NotSupportedException:
                      // "Cannot write to a computed without a setter."
```

This is one of three read-only shapes in Viu, and they do **not** fail alike. A getter-only
`Computed<T>` throws; a getter-only `Reactive.ToRef(...)` is a silent no-op with a
`Debug.WriteLine`; a `[Reactive(Readonly = true)]` setter is likewise a warned no-op. See
[Reactivity API: Utilities & Advanced](reactivity-utilities.md).

### Ownership and lifetime

- **Computeds are never owned by an `EffectScope`** — upstream Vue 3.5 parity. A computed created
  inside a scope keeps serving fresh values and stays fully reactive after `scope.Stop()`.
- **Cleanup is subscriber-count driven** — losing its last subscriber soft-detaches a computed from
  its sources; the next tracked read re-attaches it transparently.
- **A throwing getter is not poisoned** — the next read re-invokes it.

## Effects

### `Reactive.Effect`

```csharp
public static ReactiveEffect Effect(Action action, Action? scheduler = null);
```

Vue counterpart: `effect()`. Creates the effect, **runs it immediately**, and returns the runner
handle. If that first run throws, the effect is stopped before the exception propagates, so a
failed effect leaves no live subscriptions behind.

Dependencies are re-collected on every run, so an abandoned branch stops notifying:

```csharp
var flag = Reactive.Reference(true);
var a = Reactive.Reference(1);
var b = Reactive.Reference(10);
var runs = 0;

Reactive.Effect(() =>
{
    runs++;
    _ = flag.Value ? a.Value : b.Value;
});                  // runs == 1

a.Value = 2;         // runs == 2
b.Value = 11;        // not a dependency on this branch — runs stays 2

flag.Value = false;  // runs == 3, dependencies re-collected
a.Value = 3;         // abandoned branch — runs stays 3
```

Supply a `scheduler` to be told about invalidation instead of re-running automatically:

```csharp
var count = Reactive.Reference(1);
var invalidations = 0;
var seen = 0;

var effect = Reactive.Effect(
    () => seen = count.Value,
    scheduler: () => invalidations++);

count.Value = 5;  // invalidations == 1, but the body did not re-run — seen is still 1
effect.Run();     // manual re-run: seen == 5
```

### `ReactiveEffect`

```csharp
public sealed class ReactiveEffect : Subscriber
{
    public ReactiveEffect(Action function);
    public Action? Scheduler { get; set; }
    public Action? OnStop { get; set; }
    public bool AllowRecurse { get; set; }
    public bool IsActive { get; }
    public void Run();
    public void Stop();
    public void Pause();
    public void Resume();
    public void RunIfDirty();
}
```

| Member | Behavior |
| --- | --- |
| `ReactiveEffect(Action)` | Does **not** run the function, but **does** register with `EffectScope.Current` |
| `Scheduler` | When set, invalidations invoke it instead of re-running the body |
| `OnStop` | Invoked exactly once by `Stop()` |
| `AllowRecurse` | Vue's `ALLOW_RECURSE`; default `false` suppresses self-re-entry |
| `IsActive` | False after `Stop()`; a later `Run()` executes untracked |
| `Run()` | Executes with this effect as ambient subscriber, re-collecting dependencies |
| `Stop()` | Unlinks every dependency, fires `OnStop` once; idempotent |
| `Pause()` / `Resume()` | Defers invalidations; `Resume()` delivers exactly one trailing invalidation if anything triggered |
| `RunIfDirty()` | Runs only if a dependency changed since the last run |

The constructor form is how you set `AllowRecurse` before the first run — which is the only reason
to prefer it over `Reactive.Effect`:

```csharp
// Default (AllowRecurse = false): the effect's own write is suppressed, no infinite loop.
var count = Reactive.Reference(0);
Reactive.Effect(() => count.Value = count.Value + 1);
// count.Value == 1, the effect ran once.

// AllowRecurse = true: it re-enters until the condition stops holding.
// NOTE: `new ReactiveEffect(...)` does NOT run — you must call Run().
var counter = Reactive.Reference(0);
var recurseRuns = 0;

var effect = new ReactiveEffect(() =>
{
    recurseRuns++;
    if (counter.Value < 3)
    {
        counter.Value++;
    }
})
{
    AllowRecurse = true,
};

effect.Run();
// counter.Value == 3, recurseRuns == 4
```

## Effect scopes

### `Reactive.EffectScope`, `Reactive.CurrentScope`, `Reactive.OnScopeDispose`

```csharp
public static EffectScope EffectScope(bool detached = false);
public static EffectScope? CurrentScope { get; }
public static void OnScopeDispose(Action callback, bool failSilently = false);
```

Vue counterparts:
[`effectScope()`](https://vuejs.org/api/reactivity-advanced.html#effectscope),
[`getCurrentScope()`](https://vuejs.org/api/reactivity-advanced.html#getcurrentscope) — a
**property** in Viu — and
[`onScopeDispose()`](https://vuejs.org/api/reactivity-advanced.html#onscopedispose).

`OnScopeDispose` with no active scope is a no-op that emits a `Debug.WriteLine` warning; pass
`failSilently: true` to suppress it. That parameter is a Viu addition with no upstream counterpart.
A null callback throws `ArgumentNullException`.

```csharp
public sealed class EffectScope : IDisposable
{
    public EffectScope(bool detached = false);
    public static EffectScope? Current { get; }
    public bool IsActive { get; }
    public void Run(Action action);
    public TResult Run<TResult>(Func<TResult> function);
    public void Pause();
    public void Resume();
    public void Stop();
    public void Dispose();   // => Stop()
}
```

A scope collects every `ReactiveEffect` — and therefore every `Watch`/`WatchEffect` — plus every
`OnScopeDispose` cleanup created while it is the ambient current scope:

```csharp
var count = Reactive.Reference(1);
var runs = 0;

var scope = Reactive.EffectScope();
scope.Run(() => Reactive.Effect(() =>
{
    runs++;
    _ = count.Value;
}));                 // runs == 1

count.Value = 2;     // runs == 2

scope.Stop();        // scope.IsActive is false
count.Value = 3;     // runs stays 2 — the effect was torn down
```

Nested scopes stop with their parent unless created `detached`, and cleanups run in registration
order:

```csharp
var order = new List<int>();
var scope = Reactive.EffectScope();

scope.Run(() =>
{
    Reactive.OnScopeDispose(() => order.Add(1));
    Reactive.OnScopeDispose(() => order.Add(2));
    Reactive.OnScopeDispose(() => order.Add(3));
});

scope.Stop();   // order == [1, 2, 3]
scope.Stop();   // idempotent: nothing re-fires

// Run<TResult> returns the function's value.
var result = Reactive.EffectScope().Run(() => 42);   // 42

// IDisposable support.
using (var disposable = Reactive.EffectScope())
{
    disposable.Run(() => Reactive.Effect(() => { }));
}
```

Scope contract details worth pinning:

- **`Stop()` is exception-safe in a specific way** — it captures the *first* exception thrown by an
  `OnStop`, a cleanup, or a child scope, finishes *all* remaining teardown, and only then rethrows.
- **A stopped scope's `Run(...)` still executes the action** but does not become current, so
  anything created inside is unowned and stays live.
- **`Run` restores the previous scope even on throw.**
- **Pause/resume cascades** to child scopes and contained effects, but **never to computeds**.
- **Computeds are never collected by a scope** at all — see the ownership rule above.

Every component gets a `ComponentInstance.Scope`, so effects and watchers created in `Setup` are
torn down with the component. See [Composables](../guide/reusability/composables.md).

## Watchers

`Reactive.Watch` has five source shapes and `Reactive.WatchEffect` has two overloads.

| Overload | Vue counterpart |
| --- | --- |
| `Watch<T>(IReference<T> source, WatchCallback<T> callback, WatchOptions? options = null)` | `watch(ref, cb)` |
| `Watch<T>(Func<T> source, WatchCallback<T> callback, WatchOptions? options = null)` | `watch(() => expr, cb)` |
| `Watch<TReactive>(TReactive source, WatchCallback<TReactive> callback, WatchOptions? options = null)` where `TReactive : class, IReactiveObject` | `watch(reactiveObject, cb)` |
| `Watch(IReference[] sources, WatchCallback<object?[]> callback, WatchOptions? options = null)` | `watch([refA, refB], cb)` |
| `Watch(Func<object?>[] sources, WatchCallback<object?[]> callback, WatchOptions? options = null)` | `watch([() => a, () => b], cb)` |
| `WatchEffect(Action<OnCleanup> effect, WatchOptions? options = null)` | `watchEffect(cb)` |
| `WatchEffect(Action effect, WatchOptions? options = null)` | `watchEffect(cb)` without cleanup |

All of them return a `WatchHandle`.

### `WatchCallback<T>` and `OnCleanup`

```csharp
public delegate void WatchCallback<T>(T value, T oldValue, OnCleanup onCleanup);
public delegate void OnCleanup(Action cleanup);
```

A watcher is not immediate by default, and an equal write never reaches it because the ref itself
does not trigger:

```csharp
var source = Reactive.Reference(1);

Reactive.Watch(source, (newValue, oldValue, _) =>
{
    // first delivery: newValue == 2, oldValue == 1
});

source.Value = 2;   // callback fires
source.Value = 2;   // equal value: nothing happens
```

`onCleanup` registers work that runs immediately before the **next** callback and again when the
watcher stops. Registered cleanups accumulate multicast and are cleared once run:

```csharp
var id = Reactive.Reference(1);
var cleaned = new List<int>();

var handle = Reactive.Watch(
    id,
    (newId, _, onCleanup) =>
    {
        var current = newId;
        onCleanup(() => cleaned.Add(current));
    },
    new WatchOptions { Immediate = true });

id.Value = 2;    // cleanup for id=1 runs first — cleaned == [1]
id.Value = 3;    // cleaned == [1, 2]
handle.Stop();   // the final cleanup runs on stop — cleaned == [1, 2, 3]
```

**`Immediate` delivers `default(T)` as `oldValue`, not the current value** — `0` for `int`, `null`
for reference types:

```csharp
var source = Reactive.Reference(5);
var olds = new List<int>();

Reactive.Watch(
    source,
    (newValue, oldValue, _) => olds.Add(oldValue),
    new WatchOptions { Immediate = true });
// olds == [0] — default(int), not 5

source.Value = 6;
// olds == [0, 5]
```

### Multiple sources

The array overloads preserve per-source old values, and the unset old value on an immediate first
call is an `object?[]` of nulls sized to the source count:

```csharp
var first = Reactive.Reference(1);
var second = Reactive.Reference(10);

Reactive.Watch(
    new IReference[] { first, second },
    (newValues, oldValues, _) =>
    {
        // after first.Value = 2:  newValues == [2, 10], oldValues == [1, 10]
        // after second.Value = 20: newValues == [2, 20], oldValues == [2, 10]
    });
```

### Watching a reactive object

The `IReactiveObject` overload is **deep by default** (upstream parity) and passes the **same
instance** as both `value` and `oldValue`, because the object is mutated in place. It is never a
before/after pair.

```csharp
[Reactive]
public partial class ReactivePerson
{
    public partial string Name { get; set; }
    public partial int Age { get; set; }
}

[Reactive]
public partial class ReactiveOrder
{
    public partial ReactivePerson Customer { get; set; }
    public partial int Total { get; set; }
}
```

```csharp
var order = new ReactiveOrder { Customer = new ReactivePerson { Name = "A" }, Total = 10 };
var runs = 0;

Reactive.Watch(order, (_, _, _) => runs++);

order.Total = 20;           // root property — runs == 1
order.Customer.Name = "B";  // nested reactive member — runs == 2 (deep by default)

// Bound the traversal with DeepDepth.
var bounded = new ReactiveOrder { Customer = new ReactivePerson { Name = "A" }, Total = 1 };
var boundedRuns = 0;

Reactive.Watch(bounded, (_, _, _) => boundedRuns++, new WatchOptions { DeepDepth = 1 });

bounded.Total = 2;           // boundedRuns == 1
bounded.Customer.Name = "B"; // one level past the depth-1 ceiling — boundedRuns stays 1
```

Reactive collections implement `IReactiveTraversable` but **not** `IReactiveObject`, so
`Reactive.Watch(myList, cb)` does not compile. Use the getter overload with `Deep`:

```csharp
var list = new ReactiveList<ReactivePerson> { new() { Name = "A" } };
Reactive.Watch(() => list, (_, _, _) => { }, new WatchOptions { Deep = true });
```

See [Reactive Collections](reactive-collections.md).

### `WatchEffect`

```csharp
public static WatchHandle WatchEffect(Action<OnCleanup> effect, WatchOptions? options = null);
public static WatchHandle WatchEffect(Action effect, WatchOptions? options = null);
```

Runs the effect immediately, tracks everything it reads, and re-runs on any change. Only `Flush`
and `Scheduler` from `WatchOptions` apply — `Immediate`, `Once`, `Deep`, and `DeepDepth` are
ignored.

```csharp
var source = Reactive.Reference(1);
var cleaned = new List<int>();

var handle = Reactive.WatchEffect(onCleanup =>
{
    var current = source.Value;
    onCleanup(() => cleaned.Add(current));
});                // runs immediately, cleaned is empty

source.Value = 2;  // cleanup for the run that read 1 fires first — cleaned == [1]
handle.Stop();     // cleanup for the run that read 2 fires — cleaned == [1, 2]
```

### `WatchOptions`

```csharp
public sealed class WatchOptions
{
    public bool Immediate { get; set; }
    public bool Once { get; set; }
    public bool Deep { get; set; }
    public int? DeepDepth { get; set; }
    public WatchFlushMode Flush { get; set; } = WatchFlushMode.Sync;
    public IWatchScheduler? Scheduler { get; set; }
}
```

| Option | Behavior |
| --- | --- |
| `Immediate` | Fires once at creation with `oldValue` as `default(T)`. Ignored by `WatchEffect` |
| `Once` | Stops the watcher after its first callback. With `Immediate`, the immediate call **is** that first callback |
| `Deep` | Traverses the source so nested reactive members are tracked |
| `DeepDepth` | Vue 3.5's `deep: number`. Takes precedence over `Deep` when set; `0` disables traversal; negatives clamp to `0` |
| `Flush` | **Defaults to `Sync`** (Vue defaults to `pre`) |
| `Scheduler` | Required for `Pre` / `Post`; without one they fall back to synchronous delivery |

```csharp
var other = Reactive.Reference(1);
var runs = 0;

var handle = Reactive.Watch(other, (_, _, _) => runs++, new WatchOptions { Once = true });

other.Value = 2;   // runs == 1
// handle.IsActive is now false
```

### `WatchFlushMode`

```csharp
public enum WatchFlushMode
{
    Sync,
    Pre,
    Post,
}
```

`Sync` runs the callback the moment a dependency triggers. `Pre` and `Post` are delegated to the
injected `IWatchScheduler`. Vue's `flush` option is the counterpart, but **`Sync` is the default
here**, where Vue's is `pre`.

### `WatchHandle`

```csharp
public sealed class WatchHandle : IDisposable
{
    public bool IsActive { get; }
    public void Stop();
    public void Pause();
    public void Resume();
    public void Dispose();   // => Stop()
}
```

The constructor is internal — instances come only from `Reactive.Watch` / `Reactive.WatchEffect`
(or their `ViuWatch` mirrors). `Stop()` unlinks dependencies and runs the pending cleanup, and is
idempotent. Watchers created inside an `EffectScope` also stop when the scope stops.
`Pause()`/`Resume()` deliver exactly one trailing invalidation on resume if anything triggered while
paused, and nothing if not.

### `IWatchScheduler` and `WatchJob`

```csharp
public interface IWatchScheduler
{
    void Schedule(WatchJob job);
}

public sealed class WatchJob
{
    public WatchFlushMode Flush { get; }
    public bool IsActive { get; internal set; }
    public void Invoke();
}
```

`IWatchScheduler` is the seam through which a `Pre` or `Post` watcher hands its work to a flush
queue — the reactivity layer deliberately does not reference the runtime scheduler.
**No implementation ships in `Assimalign.Viu.Reactivity`.** `Assimalign.Viu.RuntimeCore` supplies
one; see `ViuWatch` below.

A watcher creates **at most one** `WatchJob`, lazily, and reuses it — which is precisely what lets a
scheduler deduplicate by reference equality. An implementation must skip a job whose `IsActive` is
false; `Invoke()` is itself a no-op in that state.

```csharp
public sealed class RecordingWatchScheduler : IWatchScheduler
{
    public List<WatchJob> ScheduledJobs { get; } = new();

    public void Schedule(WatchJob job)
    {
        if (!ScheduledJobs.Contains(job)) // reference dedupe
        {
            ScheduledJobs.Add(job);
        }
    }

    public void FlushAll()
    {
        var jobs = ScheduledJobs.ToArray();
        ScheduledJobs.Clear();

        foreach (var job in jobs)
        {
            job.Invoke();
        }
    }
}
```

```csharp
var scheduler = new RecordingWatchScheduler();
var source = Reactive.Reference(1);
var log = new List<int>();

Reactive.Watch(
    source,
    (newValue, _, _) => log.Add(newValue),
    new WatchOptions { Flush = WatchFlushMode.Pre, Scheduler = scheduler });

source.Value = 2;
// log is empty — pre-flush is not synchronous.
// scheduler.ScheduledJobs has one entry whose Flush is WatchFlushMode.Pre.

scheduler.FlushAll();   // log == [2]
```

## `ViuWatch` — the runtime-bound mirror

Namespace: `Assimalign.Viu.RuntimeCore`.

```csharp
public static class ViuWatch
{
    public static WatchHandle Watch<T>(IReference<T> source, WatchCallback<T> callback, WatchOptions? options = null);
    public static WatchHandle Watch<T>(Func<T> source, WatchCallback<T> callback, WatchOptions? options = null);
    public static WatchHandle Watch<TReactive>(TReactive source, WatchCallback<TReactive> callback, WatchOptions? options = null)
        where TReactive : class, IReactiveObject;
    public static WatchHandle Watch(IReference[] sources, WatchCallback<object?[]> callback, WatchOptions? options = null);
    public static WatchHandle Watch(Func<object?>[] sources, WatchCallback<object?[]> callback, WatchOptions? options = null);
    public static WatchHandle WatchEffect(Action<OnCleanup> effect, WatchOptions? options = null);
    public static WatchHandle WatchEffect(Action effect, WatchOptions? options = null);
}
```

**Inside a component, use `ViuWatch`, not `Reactive`.** The overload set is identical, but the
behavior differs in three ways that matter:

- **The default flush is `Pre` on the runtime scheduler** — matching upstream Vue. Callbacks batch
  into, and run ahead of, the render flush. Standalone `Reactive.Watch` has no scheduler and would
  run synchronously.
- **Errors route through the component `OnErrorCaptured` chain** to
  `ApplicationConfiguration.ErrorHandler`, instead of tearing down the flush. This covers the
  callback, the effect body, and the getter.
- **The scheduler job carries the component's `Uid`** so pre-flush callbacks order against
  component renders exactly as upstream's `job.id = instance.uid` does: the callback runs after an
  ancestor's render but before its own component re-renders. A watcher created with no current
  instance has no id and sorts ahead of every render.

Scope membership is *not* one of the differences: the renderer invokes `Setup` inside
`instance.Scope.Run(...)`, so any watcher created synchronously there — `ViuWatch` or plain
`Reactive` — registers with that scope and stops on unmount either way.

Call it synchronously inside `Setup`:

```csharp
using System.Threading;                  // in addition to the page-wide usings
using Assimalign.Viu.RuntimeCore;

// Inside your IComponentDefinition implementation. SearchAsync is your own helper —
// nothing in Viu provides it.
public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    var query = Reactive.Reference(string.Empty);
    var results = Reactive.Reference<IReadOnlyList<string>>([]);

    ViuWatch.Watch(query, (term, _, onCleanup) =>
    {
        var cancellation = new CancellationTokenSource();
        onCleanup(cancellation.Cancel);

        // Fire-and-forget: WatchCallback<T> returns void — there is no async overload.
        _ = SearchAsync(term, cancellation.Token, results);
    });

    return () => /* render */ null;
}
```

> **Gotcha.** `ViuWatch` injects the runtime scheduler only when `options` is null, or when
> `options.Flush` is not `Sync`. Because `WatchOptions.Flush` itself defaults to `Sync`, passing
> `new WatchOptions { Immediate = true }` gets you a **synchronous** watcher, not a pre-flush one.
> Set `Flush = WatchFlushMode.Pre` explicitly whenever you pass an options object and want the
> upstream default timing.

Use standalone `Reactive.Watch` / `Reactive.WatchEffect` for non-component code — composable
helpers that manage their own scope, tests, and anything outside a component tree.

## Not yet implemented

- **No `watchSyncEffect()` / `watchPostEffect()`** — use
  `WatchEffect(effect, new WatchOptions { Flush = ..., Scheduler = ... })`.
- **No async watch callbacks** — `WatchCallback<T>` returns `void` and there is no `Task`-returning
  overload. Arrange async cleanup manually through `OnCleanup`.
- **No `onTrack` / `onTrigger` debug hooks** anywhere — not on `ReactiveEffect`, not on
  `Computed<T>`, not on `WatchOptions`.
- **No custom `IEqualityComparer<T>` injection** into `Reference<T>`, `ShallowReference<T>`, or
  `Computed<T>` — change detection is hardwired to `EqualityComparer<T>.Default`.
- **No runtime `reactive()` / `shallowReactive()` / `readonly()` / `shallowReadonly()`** — object
  reactivity is compile-time only, via `[Reactive]` and `[ShallowReactive]`. See
  [Reactivity API: Utilities & Advanced](reactivity-utilities.md).
- **No thread safety** — and none is planned. This is a design decision, not a gap.

## See also

- [Reactivity API: Utilities & Advanced](reactivity-utilities.md) — introspection, unwrapping, raw
  access, tracking control, and the `[Reactive]` generator.
- [Reactive Collections](reactive-collections.md) — `ReactiveList<T>`,
  `ReactiveDictionary<TKey, TValue>`, `ReactiveSet<T>`, and their trigger granularity.
- [Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md) — the teaching path.
- [Watchers](../guide/essentials/watchers.md) — flush modes in practice.
- [Composables](../guide/reusability/composables.md) — effect scopes for reusable logic.
- [Differences from Vue 3](../roadmap/vue-differences.md) — the full naming map and divergence list.
- [Project Status](../roadmap/status.md) — area-by-area coverage.
