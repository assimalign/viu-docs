# Watchers

Running side effects in response to reactive state changes with `ViuWatch.Watch`, `ViuWatch.WatchEffect`,
and their standalone `Reactive` counterparts.

> **Status:** Implemented.

Viu's watchers are a port of Vue's [`watch()` and `watchEffect()`](https://vuejs.org/guide/essentials/watchers.html).
Computeds are for deriving values; watchers are for everything a getter must not do — calling an API,
writing to storage, logging, starting a timer. If you only need a derived value, reach for
[`Reactive.Computed<T>`](./computed.md) instead.

## Read this first: the flush-mode divergence

`WatchOptions.Flush` defaults to `WatchFlushMode.Sync`. **Vue's default is `pre`.** This is a real
behavioral divergence, not a documentation shorthand, and it interacts with a second rule:

- **`Pre` and `Post` require a scheduler** — `WatchOptions.Scheduler` must hold an `IWatchScheduler`.
  Without one, a `Pre` or `Post` watcher **silently falls back to synchronous delivery**. There is no
  warning and no exception.
- **No `IWatchScheduler` ships in `Assimalign.Viu.Reactivity`** — the only implementation is
  `RuntimeWatchScheduler` in `Assimalign.Viu.RuntimeCore`, and it is internal.

The practical consequence is a single rule that governs the whole page:

| Where you are | Use | Default flush |
| --- | --- | --- |
| Inside a component's `Setup` | `ViuWatch.Watch` / `ViuWatch.WatchEffect` (`Assimalign.Viu.RuntimeCore`) | `Pre`, on the runtime scheduler |
| Non-component code, tests, plain reactivity | `Reactive.Watch` / `Reactive.WatchEffect` (`Assimalign.Viu.Reactivity`) | `Sync` |

`ViuWatch` is a thin layer over `Reactive.Watch` that does two things the standalone API cannot: it
injects a `RuntimeWatchScheduler` carrying the owning `ComponentInstance.Uid` so pre-flush callbacks
order against component renders the way upstream's `job.id = instance.uid` does, and it routes
callback, getter, and effect-body exceptions through the `OnErrorCaptured` chain to
`ApplicationConfiguration.ErrorHandler` rather than tearing down the flush.

## Watching a single ref

`Reactive.Watch` takes a source, a `WatchCallback<T>`, and optional `WatchOptions`. It does not fire on
creation.

```csharp
var source = Reactive.Reference(1);
var runs = 0;
var lastNew = 0;
var lastOld = 0;

Reactive.Watch(source, (newValue, oldValue, _) =>
{
    runs++;
    lastNew = newValue;
    lastOld = oldValue;
});

// runs == 0 — not immediate.

source.Value = 2;
// runs == 1, lastNew == 2, lastOld == 1

source.Value = 2;
// runs == 1 — an equal write never triggers the ref, so it never reaches the watcher.
```

Change detection is `EqualityComparer<T>.Default`, not JavaScript's `Object.is`. Like `Object.is`, `NaN`
is self-equal; unlike it, `+0.0` and `-0.0` compare equal. See
[Differences from Vue 3](../../roadmap/vue-differences.md).

## The five source shapes

| Source | Signature | Notes |
| --- | --- | --- |
| A ref | `Watch<T>(IReference<T> source, WatchCallback<T>, WatchOptions?)` | Tracks the `.Value` cell |
| A getter | `Watch<T>(Func<T> source, WatchCallback<T>, WatchOptions?)` | Fires on any reactive read inside the getter |
| A reactive object | `Watch<TReactive>(TReactive source, WatchCallback<TReactive>, WatchOptions?) where TReactive : class, IReactiveObject` | **Deep by default** |
| Several refs | `Watch(IReference[] sources, WatchCallback<object?[]>, WatchOptions?)` | Per-source old values preserved |
| Several getters | `Watch(Func<object?>[] sources, WatchCallback<object?[]>, WatchOptions?)` | Unset old value is an `object?[]` of nulls |

The two multi-source overloads compare element-wise with `object.Equals` (boxed, since the values arrive
as `object?`), not `EqualityComparer<T>.Default`; the `IReactiveObject` overload never compares at all —
it always delivers.

`ViuWatch` exposes the same five overloads with the same signatures.

The getter form is the one to reach for whenever the source is an expression rather than a cell:

```csharp
var cart = new ReactiveList<LineItem>();

ViuWatch.Watch(
    () => cart.Sum(item => item.Quantity),
    (total, previousTotal, _) => Analytics.CartSizeChanged(previousTotal, total));
```

Watching several refs at once preserves each source's own previous value:

```csharp
var first = Reactive.Reference(1);
var second = Reactive.Reference(10);

Reactive.Watch(
    new IReference[] { first, second },
    (newValues, oldValues, _) =>
    {
        // first.Value = 2  ->  newValues = [2, 10],  oldValues = [1, 10]
        // second.Value = 20 -> newValues = [2, 20],  oldValues = [2, 10]
    });
```

## The callback and its cleanup

```csharp
public delegate void WatchCallback<T>(T value, T oldValue, OnCleanup onCleanup);
public delegate void OnCleanup(Action cleanup);
```

`onCleanup` registers work that runs **immediately before the next callback** and **again when the
watcher stops**. Registered cleanups accumulate (`_cleanup += cleanup`) and are cleared once run. This is
the mechanism for cancelling a stale request:

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

id.Value = 2;   // cleanup for id=1 runs before the id=2 callback -> cleaned = [1]
id.Value = 3;   // cleanup for id=2 runs first                    -> cleaned = [1, 2]
handle.Stop();  // the final cleanup (id=3) runs on stop          -> cleaned = [1, 2, 3]
```

A real cancellation looks the same, with a `CancellationTokenSource` in place of the list:

```csharp
using System;
using System.Collections.Generic;
using System.Threading;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    var query = Reactive.Reference(string.Empty);
    var results = Reactive.Reference<IReadOnlyList<string>>(Array.Empty<string>());

    ViuWatch.Watch(query, (text, _, onCleanup) =>
    {
        var cancellation = new CancellationTokenSource();
        onCleanup(cancellation.Cancel);

        // WatchCallback<T> returns void, so an async body is fire-and-forget by construction.
        _ = SearchAsync(text, cancellation.Token, results);
    });

    return () => VirtualNodeFactory.Element("div", $"{results.Value.Count} result(s)");
}
```

Watch callbacks are `void`-returning. There is no `Task`-returning overload and the watcher never awaits
you — sequencing and cancellation are yours to arrange through `onCleanup`.

## WatchOptions

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

- **`Immediate`** — fires the callback once at creation. Ignored by `WatchEffect`, which always runs
  immediately anyway.
- **`Once`** — stops the watcher after its first delivered callback. Combined with `Immediate`, the
  immediate call *is* that first callback, so the watcher is already inactive when creation returns.
- **`Deep`** — traverses the source so a change to any nested reactive member fires the callback.
- **`DeepDepth`** — Vue 3.5's `deep: number`. When set it takes precedence over `Deep`; `0` disables
  traversal and negative values are clamped to `0`.
- **`Flush`** — `WatchFlushMode.Sync` (default), `.Pre`, or `.Post`.
- **`Scheduler`** — required for `Pre`/`Post`; ignored for `Sync`.

### Immediate watchers get `default(T)`, not the current value

```csharp
var source = Reactive.Reference(5);
var news = new List<int>();
var olds = new List<int>();

Reactive.Watch(
    source,
    (newValue, oldValue, _) => { news.Add(newValue); olds.Add(oldValue); },
    new WatchOptions { Immediate = true });

// news == [5], olds == [0]   <- default(int), not 5

source.Value = 6;
// olds == [0, 5]
```

This is `0` for `int`, `null` for reference types, and an `object?[]` of nulls sized to the source count
for the multi-source overloads. Guard on it if the first invocation must be distinguishable.

The one exception is the `IReactiveObject` overload: its unset old value is **the source instance
itself**, not `default`, because that overload always hands you the same object as both `value` and
`oldValue` (see [Watching a reactive object](#watching-a-reactive-object)).

### Once

```csharp
var other = Reactive.Reference(1);
var runs = 0;
var handle = Reactive.Watch(other, (_, _, _) => runs++, new WatchOptions { Once = true });

other.Value = 2;
// runs == 1, handle.IsActive == false
```

## Watching a reactive object

The `IReactiveObject` overload — the one that accepts a `[Reactive]` source-generated class directly — is
**deep by default**, matching upstream. It also has a property that must never be described as a
before/after pair: because the object is mutated in place, the callback receives **the same instance** as
both `value` and `oldValue`.

```csharp
var order = new ReactiveOrder { Customer = new ReactivePerson { Name = "A" }, Total = 10 };
var runs = 0;

Reactive.Watch(order, (_, _, _) => runs++);
// runs == 0

order.Total = 20;           // root property        -> runs == 1
order.Customer.Name = "B";  // nested reactive member -> runs == 2 (deep traversal subscribed to it)
```

`[ShallowReactive]` stops traversal at the root, and `DeepDepth` bounds it:

```csharp
var bounded = new ReactiveOrder { Customer = new ReactivePerson { Name = "A" }, Total = 1 };
var boundedRuns = 0;

Reactive.Watch(bounded, (_, _, _) => boundedRuns++, new WatchOptions { DeepDepth = 1 });

bounded.Total = 2;            // boundedRuns == 1
bounded.Customer.Name = "B";  // one level past the depth-1 ceiling -> still 1
```

Two traversal rules follow from Viu being reflection-free:

- **Plain CLR objects are leaves** — traversal descends only through `IReference` cells and
  `IReactiveTraversable` values. A deep watch will never observe a mutation inside an un-annotated POCO.
  This is documented behavior, not a gap.
- **`Reactive.MarkRaw` excludes an object permanently** — a marked instance is skipped by traversal and
  reports `IsReactive == false`. There is no unmark.

See [Reactivity Fundamentals](./reactivity-fundamentals.md) for the `[Reactive]` generator itself.

## Watching a reactive collection

`ReactiveList<T>`, `ReactiveDictionary<TKey, TValue>`, and `ReactiveSet<T>` implement
`IReactiveTraversable` but **not** `IReactiveObject`. The object overload's generic constraint therefore
does not admit them — `Reactive.Watch(myReactiveList, cb)` does not compile. Wrap the collection in a
getter and opt into `Deep` explicitly:

```csharp
var first = new ReactivePerson { Name = "A" };
var list = new ReactiveList<ReactivePerson> { first };
var runs = 0;

Reactive.Watch(() => list, (_, _, _) => runs++, new WatchOptions { Deep = true });

first.Name = "B";                              // nested member    -> runs == 1
list.Add(new ReactivePerson { Name = "C" });   // structural change -> runs == 2
```

More detail in [Reactive Collections](../../api/reactive-collections.md) and
[Conditional & List Rendering](./conditional-and-list.md).

## WatchEffect

`WatchEffect` runs its body immediately, tracks everything the body reads, and re-runs on any change —
no explicit source list.

```csharp
public static WatchHandle WatchEffect(Action<OnCleanup> effect, WatchOptions? options = null);
public static WatchHandle WatchEffect(Action effect, WatchOptions? options = null);
```

```csharp
var source = Reactive.Reference(1);
var cleaned = new List<int>();

var handle = Reactive.WatchEffect(onCleanup =>
{
    var current = source.Value;
    onCleanup(() => cleaned.Add(current));
});
// cleaned == []

source.Value = 2;  // cleanup for the run that read 1 fires before the re-run -> cleaned = [1]
handle.Stop();     // cleanup for the run that read 2 fires on stop           -> cleaned = [1, 2]
```

Only `Flush` and `Scheduler` are honoured from `WatchOptions`; `Immediate`, `Once`, `Deep`, and
`DeepDepth` are ignored.

## Flush timing inside a component

With `ViuWatch` and no options, the callback runs **pre-flush** — batched into the render flush and
ordered ahead of the component's own render job. The snippet below is lifted from the runtime's own test
suite; `TestComponent`, `_renderer`, and `_pump` (a `TestSchedulerPump`) are **internal test-harness
types, not public API** — they stand in for a mounted component and a manually pumped flush queue:

```csharp
var state = Reactive.Reference(0);
var order = new List<string>();

var component = new TestComponent
{
    SetupFunction = (_, _) =>
    {
        ViuWatch.Watch(state, (value, _, _) => order.Add($"watch:{value}"));
        return () =>
        {
            order.Add($"render:{state.Value}");
            return VirtualNodeFactory.Text(state.Value.ToString());
        };
    },
};

_renderer.Render(VirtualNodeFactory.Component(component), _container);
// order == ["render:0"]

state.Value = 1;
_pump.RunUntilIdle();
// order == ["render:0", "watch:1", "render:1"]
```

With `new WatchOptions { Flush = WatchFlushMode.Post }` the last line instead reads
`["render:0", "render:1", "watch:1"]` — the callback runs after the DOM has been patched, which is when
you can read layout or a template ref.

| Mode | When the callback runs | Scheduler path |
| --- | --- | --- |
| `Sync` | The instant a dependency triggers | None |
| `Pre` | Before the render job, in the same flush | `Scheduler.QueueJob` with `IsPreFlush` |
| `Post` | After the render job, in the post-flush phase | `Scheduler.QueuePostFlushCallback` |

Repeated triggers inside one turn coalesce: a watcher creates at most one `WatchJob`, lazily, and reuses
it, so `RuntimeWatchScheduler` deduplicates by reference into a single delivery per flush. Await
`Scheduler.NextTick()` to observe the settled result — note it returns `Task.CompletedTask` when nothing
is queued, so awaiting it does not necessarily yield.

### The options-object trap

`ViuWatch` injects the runtime scheduler in exactly two cases: when `options` is `null`, and when
`options.Flush` is not `Sync` while `options.Scheduler` is `null`. Because `WatchOptions.Flush` itself
defaults to `WatchFlushMode.Sync`, **passing an options object without setting `Flush` opts you back out
of pre-flush timing**:

```csharp
// Pre-flush (runtime default) — no options object at all.
ViuWatch.Watch(count, OnCount);

// SYNCHRONOUS — WatchOptions.Flush defaulted to Sync, so no scheduler is injected.
ViuWatch.Watch(count, OnCount, new WatchOptions { Immediate = true });

// Pre-flush with Immediate — say so explicitly.
ViuWatch.Watch(count, OnCount, new WatchOptions { Immediate = true, Flush = WatchFlushMode.Pre });
```

Whenever you construct a `WatchOptions` for `ViuWatch`, set `Flush` explicitly.

## WatchHandle: stop, pause, resume

Every watch factory returns a `WatchHandle`. Its constructor is internal — handles come only from
`Reactive.Watch`/`WatchEffect` and their `ViuWatch` equivalents.

```csharp
public sealed class WatchHandle : IDisposable
{
    public bool IsActive { get; }
    public void Stop();
    public void Pause();
    public void Resume();
    public void Dispose();   // == Stop()
}
```

- **`Stop`** — unlinks every dependency and runs the pending cleanup. Idempotent. `Dispose` is an alias,
  so a handle works with `using`.
- **`Pause` / `Resume`** — defers delivery. On resume the watcher delivers **exactly one** trailing
  invalidation if anything triggered while paused, and nothing at all if nothing did.
- **`IsActive`** — false after `Stop`, after a `Once` watcher's first callback, or after the owning
  `EffectScope` stops.

## Automatic teardown

A watcher created while an `EffectScope` is current is owned by that scope and stops with it. A component
runs `Setup` inside `ComponentInstance.Scope`, so **any watcher registered during `Setup` is torn down on
unmount** with no bookkeeping:

```csharp
using System;
using System.Threading;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

public sealed class Stopwatch : IComponentDefinition
{
    public string? Name => "Stopwatch";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var running = Reactive.Reference(false);
        var elapsed = Reactive.Reference(TimeSpan.Zero);

        // Owned by the component scope; stops automatically on unmount.
        ViuWatch.Watch(running, (isRunning, _, onCleanup) =>
        {
            if (!isRunning)
            {
                return;
            }

            var timer = new Timer(_ => elapsed.Value += TimeSpan.FromMilliseconds(100), null, 100, 100);
            onCleanup(timer.Dispose);
        });

        return () => VirtualNodeFactory.Element("span", $"{elapsed.Value:mm\\:ss\\.ff}");
    }
}
```

Store the handle only when you need to stop a watcher earlier than its scope. Watchers created outside any
scope — a `Task` continuation, a static initializer — are unowned and leak until you `Stop` them yourself.
See [Composables](../reusability/composables.md) for scope mechanics.

### Watchers in `.viu` single-file components

> **Not yet wired.** The `.viu` generator emits a `partial class` with a `static Render` method and
> `RenderCacheSize`, but **no runtime adapter turns that class into an `IComponentDefinition`** — there is
> no generated `Setup`, so there is no component `EffectScope` for a watcher to join. Registering a
> watcher from a `.viu` `@script` block works, but it is **not** scope-owned and will not stop on unmount.
> Until the adapter lands, hand-written `IComponentDefinition` components are the only place `ViuWatch`'s
> automatic teardown applies. See
> [Single-File Components — Not yet implemented](../scaling-up/single-file-components.md#not-yet-implemented).

The `@script` block is the generated partial class body, so a watcher goes in a constructor or a method,
not in a `Setup` function. Two structural rules matter here: **block content must be indented** (a `}` in
column 0 closes the `@script` block early), and a `Reference<T>` field is unwrapped for you in the
template, so `{{ Elapsed }}` emits `_ctx.Elapsed.Value`.

```viu
@template {
    <span>{{ Elapsed }}</span>
}

@script {
    using System;

    using Assimalign.Viu.Reactivity;

    public Reference<TimeSpan> Elapsed = Reactive.Reference(TimeSpan.Zero);

    public Reference<bool> Running = Reactive.Reference(false);

    public Stopwatch()
    {
        // Standalone reactivity: synchronous flush, and yours to stop — there is no owning scope yet.
        Reactive.Watch(Running, (isRunning, _, _) => Console.WriteLine($"running: {isRunning}"));
    }
}
```

The surrounding SFC mechanics — the column-0 rule, the `using`-hoisting split, and the binding
classification that drives `.Value` insertion — are covered in
[Single-File Components](../scaling-up/single-file-components.md).

## Not yet implemented

- **No `watchSyncEffect` / `watchPostEffect` wrappers** — use
  `WatchEffect(effect, new WatchOptions { Flush = ..., Scheduler = ... })`, or `ViuWatch.WatchEffect`
  with an explicit `Flush`.
- **No async watch callbacks** — `WatchCallback<T>` returns `void` and there is no `Task`-returning
  overload. Async cleanup must be arranged manually through `OnCleanup`.
- **No `onTrack` / `onTrigger` debug hooks** — Vue's dev-only tracing callbacks do not exist on
  `WatchOptions`, `ReactiveEffect`, or `Computed<T>`, and there is no DevTools integration to surface
  them.
- **No public `IWatchScheduler` implementation** — `RuntimeWatchScheduler` is internal to
  `Assimalign.Viu.RuntimeCore`. Outside a component you must supply your own if you want `Pre`/`Post`.
- **No scope-owned watchers in `.viu` components** — the SFC generator emits no `Setup`, so a watcher
  registered from an `@script` block joins no component `EffectScope` and is never torn down for you.
  See [Watchers in `.viu` single-file components](#watchers-in-viu-single-file-components).
- **No thread safety** — all ambient reactivity and scheduler state is plain static fields with no
  synchronization, by design, for the single-threaded browser event-loop model.

See [Project Status](../../roadmap/status.md) for area-by-area coverage and
[Reactivity API: Core](../../api/reactivity-core.md) for the full signature reference.
