# Composables

Factoring stateful logic into plain static methods that return refs and actions, and the effect-scope
machinery that tears them down.

> **Status:** Implemented.

A *composable* in Viu is exactly what it is in Vue: an ordinary function that creates reactive state,
wires up whatever effects that state needs, and hands the caller back a bundle of refs and actions.
It is the direct counterpart of a [Vue composable](https://vuejs.org/guide/reusability/composables.html),
and it is the **only** logic-reuse mechanism Viu offers. There are no mixins, there is no Options API
to mix into, and neither is planned — see [Differences from Vue 3](../../roadmap/vue-differences.md).

Nothing about a composable is special to the framework. There is no attribute, no registration, and
no base class. A composable is a static method that happens to call `Reactive.Reference<T>` and
friends, so the ordinary C# rules about generics, nullability, and trimming all apply unchanged.

## Your first composable

Follow Vue's `use*` convention, spelled `Use*` in C#. Return a tuple when the surface is small:

```csharp
using System;
using Assimalign.Viu.Reactivity;

namespace MyApp.Composables;

public static class Counters
{
    public static (Reference<int> Count, Action Increment, Action Reset) UseCounter(int initial = 0)
    {
        var count = Reactive.Reference(initial);

        void Increment() => count.Value++;
        void Reset() => count.Value = initial;

        return (count, Increment, Reset);
    }
}
```

Remember the two naming rules from [Reactivity Fundamentals](../essentials/reactivity-fundamentals.md):
the ref type is `Reference<T>` (there is no type named `Ref` anywhere in Viu), and its cell is `.Value`
with a capital V. The factory method `Reactive.Reference<T>` shares its name with the type it returns.

Once the returned surface grows past three members, a positional `record` reads better than a tuple and
gives the shape a name you can put in a signature:

```csharp
using System;
using Assimalign.Viu.Reactivity;

namespace MyApp.Composables;

public sealed record CounterHandle(
    Reference<int> Count,
    Computed<bool> IsEven,
    Action Increment,
    Action Reset);

public static class Counters
{
    public static CounterHandle UseCounter(int initial = 0)
    {
        var count = Reactive.Reference(initial);
        var isEven = Reactive.Computed(() => count.Value % 2 == 0);

        return new CounterHandle(
            count,
            isEven,
            Increment: () => count.Value++,
            Reset: () => count.Value = initial);
    }
}
```

Return the refs themselves, not their current values. A composable that returns `int` instead of
`Reference<int>` has handed the caller a dead snapshot — the render function will never re-run for it.

## Consuming a composable in `Setup`

Call composables from inside `IComponentDefinition.Setup`, which runs exactly once per instance and
returns the render closure. The closure captures the refs, so reads inside it are tracked and drive
re-renders:

```csharp
using System;
using System.Collections.Generic;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using MyApp.Composables;

namespace MyApp.Components;

public sealed class CounterPanel : IComponentDefinition
{
    public string? Name => "CounterPanel";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties =>
        [new ComponentPropertyDefinition("start") { DefaultValue = 0 }];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var (count, isEven, increment, reset) = Counters.UseCounter(properties.Get<int>("start"));

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Element("span", $"{count.Value} ({(isEven.Value ? "even" : "odd")})"),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", increment)),
                "+1"),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", reset)),
                "reset"));
    }
}
```

Because `Setup` returns the render function rather than being called alongside a separate `Render`
member, there is no `this` to attach composable results to and no name collision to worry about. Two
calls to `UseCounter` in the same `Setup` produce two entirely independent pieces of state.

## Composables that own effects

A composable that only creates refs needs no cleanup. One that starts a watcher does — and inside a
component that cleanup is automatic, because every `ComponentInstance` owns an `EffectScope` exposed
as `ComponentInstance.Scope`, and `Setup` runs inside it.

Use `ViuWatch.Watch` / `ViuWatch.WatchEffect` from `Assimalign.Viu.RuntimeCore` rather than
`Reactive.Watch` / `Reactive.WatchEffect` whenever the composable is meant for components. `ViuWatch`
injects the runtime scheduler, which is what makes `WatchFlushMode.Pre` and `.Post` actually defer —
the standalone reactivity layer ships no `IWatchScheduler`, and a pre/post watcher without one falls
back to synchronous delivery. See [Watchers](../essentials/watchers.md) for the full flush story.

```csharp
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp.Composables;

public static class Search
{
    /// <summary>Call from Setup so the watcher joins the component's scope.</summary>
    public static (Reference<string> Query, Reference<IReadOnlyList<string>> Results) UseSearch(
        Func<string, CancellationToken, Task<IReadOnlyList<string>>> fetch)
    {
        var query = Reactive.Reference(string.Empty);
        var results = Reactive.Reference<IReadOnlyList<string>>(Array.Empty<string>());

        ViuWatch.Watch(query, (current, _, onCleanup) =>
        {
            var cancellation = new CancellationTokenSource();
            onCleanup(cancellation.Cancel);

            _ = LoadAsync(current, results, fetch, cancellation.Token);
        });

        return (query, results);
    }

    private static async Task LoadAsync(
        string query,
        Reference<IReadOnlyList<string>> results,
        Func<string, CancellationToken, Task<IReadOnlyList<string>>> fetch,
        CancellationToken token)
    {
        var loaded = await fetch(query, token);
        if (!token.IsCancellationRequested)
        {
            results.Value = loaded;
        }
    }
}
```

The `onCleanup` delegate is `WatchCallback<T>`'s third parameter. Registered cleanups run immediately
before the next callback **and** again when the watcher stops — which, for a component-scoped watcher,
is when the component unmounts. `WatchCallback<T>` returns `void`; there is no `Task`-returning
overload, so async work is fired and cancelled through `OnCleanup` as shown above.

If a composable needs to run something only after the element exists, register a lifecycle hook from
inside it. Hooks bind to `ComponentInstance.Current` at registration time, so they must be registered
synchronously during `Setup` — see [Lifecycle Hooks & Template Refs](../essentials/lifecycle-and-template-refs.md).

```csharp
using System;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp.Composables;

public static class Mounting
{
    public static Reference<bool> UseIsMounted()
    {
        var started = Reactive.Reference(false);

        Lifecycle.OnMounted(() => started.Value = true);
        Lifecycle.OnUnmounted(() => started.Value = false);

        return started;
    }
}
```

## Effect scopes outside components

`Reactive.EffectScope(bool detached = false)` is Viu's port of
[`effectScope()`](https://vuejs.org/api/reactivity-advanced.html#effectscope). Use it when a composable
must live outside a component — an app-level singleton, a test fixture, or a unit of state you want to
tear down explicitly.

```csharp
using System;
using Assimalign.Viu.Reactivity;

namespace MyApp.Composables;

public sealed class FormValidation : IDisposable
{
    private readonly EffectScope _scope = Reactive.EffectScope(detached: true);

    public Reference<bool> IsValid { get; } = Reactive.Reference(false);

    public FormValidation(Reference<string> email, Reference<string> password)
    {
        _scope.Run(() =>
        {
            Reactive.WatchEffect(() =>
            {
                IsValid.Value = email.Value.Contains('@') && password.Value.Length >= 8;
            });

            Reactive.OnScopeDispose(() => IsValid.Value = false);
        });
    }

    public void Dispose() => _scope.Dispose();
}
```

The scope members are:

- **`Run(Action)` and `Run<TResult>(Func<TResult>)`** — execute the delegate with this scope current, so
  every `ReactiveEffect`, watcher, and `OnScopeDispose` callback created inside is collected by it. The
  generic overload returns the function's value. The previous scope is restored even if the delegate throws.
- **`Stop()` and `Dispose()`** — `Dispose()` calls `Stop()`, so `using var scope = Reactive.EffectScope();`
  works. `Stop()` is idempotent; a second call re-fires nothing.
- **`Pause()` and `Resume()`** — defer invalidations and then deliver exactly **one** trailing invalidation
  on resume if anything triggered while paused, and nothing if not. These cascade to child scopes and
  contained effects, but **never** to computeds.
- **`IsActive`** — false after `Stop()`.
- **`EffectScope.Current` (static)** — the ambient scope, also reachable as `Reactive.CurrentScope`.

Nested scopes stop with their parent. Pass `detached: true` to opt out, as `FormValidation` does above —
a detached scope created inside another scope survives the parent's `Stop()`.

### `Reactive.CurrentScope` and `Reactive.OnScopeDispose`

Vue's `getCurrentScope()` is a **property** in Viu, not a method: `Reactive.CurrentScope`, typed
`EffectScope?`. `onScopeDispose()` becomes `Reactive.OnScopeDispose(Action callback, bool failSilently = false)`.
The `failSilently` parameter is a Viu addition — with no active scope, `OnScopeDispose` is a no-op that
emits a `Debug.WriteLine` warning, and `failSilently: true` suppresses just the warning.

That pair lets a composable register teardown that works identically inside a component (where the
component's scope owns it) and inside a hand-rolled scope, while still degrading gracefully when called
from neither:

```csharp
using System;
using Assimalign.Viu.Reactivity;

namespace MyApp.Composables;

public static class Tickers
{
    public static Reference<int> UseTicker(Action<Action> subscribe, Action<Action> unsubscribe)
    {
        var ticks = Reactive.Reference(0);

        void OnTick() => ticks.Value++;

        subscribe(OnTick);
        Reactive.OnScopeDispose(() => unsubscribe(OnTick), failSilently: Reactive.CurrentScope is null);

        return ticks;
    }
}
```

### The teardown contract

| Behavior | Contract |
| --- | --- |
| Callback order | `OnScopeDispose` callbacks run in registration order, each exactly once |
| Exception handling | `Stop()` captures the **first** exception from an `OnStop`, a cleanup, or a child scope, finishes **all** remaining teardown, then rethrows |
| Idempotency | A second `Stop()` (or `Dispose()`) fires nothing |
| Stopped-scope `Run` | The action still **executes**, but the scope does **not** become current — nothing created inside is collected by it, and whatever scope was already ambient stays ambient |
| Child scopes | Stop with the parent unless created `detached: true` |
| Computeds | Never owned by any scope — see below |

The stopped-scope `Run` rule is the sharp edge. Calling `Run` on a scope you already stopped does not
throw and does not no-op; the effects the action creates are simply never registered with it, so unless
some outer scope happens to be ambient they stay live with nothing left to stop them. Check `IsActive`
first if a scope's lifetime is not obviously bounded.

### Computeds are never owned by a scope

This is upstream Vue 3.5 parity and it bites composable authors specifically. `EffectScope` collects
effects and watchers; it does **not** collect `Computed<T>`. A computed created inside a scope keeps
serving fresh values and stays fully reactive after `Stop()`:

```csharp
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(1);
Computed<int>? doubled = null;

var scope = Reactive.EffectScope();
scope.Run(() => doubled = Reactive.Computed(() => count.Value * 2));

scope.Stop();

count.Value = 5;
_ = doubled!.Value;   // 10 — still live, still recomputing
```

Computeds clean themselves up by subscriber count instead: losing the last subscriber soft-detaches a
computed from its sources, and the next tracked read re-attaches it. So a computed left behind by a
stopped scope is not a leak in the effect sense — it simply is not something `Stop()` controls. Do not
write a composable whose correctness depends on a computed going inert at teardown. See
[Computed Properties](../essentials/computed.md).

## `Reactive.Effect` versus `new ReactiveEffect`

Composables reach for raw effects rarely — a watcher is almost always the better tool — but when they do,
the two construction paths differ in ways that matter:

| | `Reactive.Effect(action)` | `new ReactiveEffect(action)` |
| --- | --- | --- |
| Runs the action | Immediately, at creation | No — you must call `Run()` |
| Registers with `EffectScope.Current` | Yes — in the constructor, before the immediate run | Yes — in the constructor |
| On a throwing first run | Stops the effect, then rethrows, leaving no live subscriptions | N/A — nothing runs yet |
| Configuring `AllowRecurse` before the first run | Not possible | The reason this form exists |

`ReactiveEffect` exposes `Scheduler`, `OnStop`, `AllowRecurse`, `IsActive`, `Run()`, `Stop()`, `Pause()`,
`Resume()`, and `RunIfDirty()`. `AllowRecurse` defaults to `false`, which is what stops an effect that
writes its own dependency from re-entering; set it via an object initializer before the first `Run()`:

```csharp
using Assimalign.Viu.Reactivity;

var counter = Reactive.Reference(0);
var effect = new ReactiveEffect(() =>
{
    if (counter.Value < 3)
    {
        counter.Value++;
    }
})
{
    AllowRecurse = true,
};

effect.Run();   // counter.Value is now 3
```

## Sharing state between components

A composable called from two components produces two independent sets of refs. To share one set, either
hoist the state to module scope (a `static readonly` field, ideally inside a detached `EffectScope`) or —
preferably — provide it through the component tree with `DependencyInjection.Provide` /
`DependencyInjection.Inject` and a `static readonly InjectionKey<T>`:

```csharp
using Assimalign.Viu.RuntimeCore;

namespace MyApp.Composables;

public static class Session
{
    public static readonly InjectionKey<CounterHandle> Key = new(nameof(CounterHandle));

    public static void ProvideCounter() => DependencyInjection.Provide(Key, Counters.UseCounter());

    public static CounterHandle UseCounter() =>
        DependencyInjection.Inject(Key, () => Counters.UseCounter());
}
```

`InjectionKey<T>` identity is **reference** identity, so the key must be a shared singleton — two keys
with the same `Name` are different keys. `Inject` with a default (here the `Func<T>` factory overload)
also suppresses the not-found dev warning. Full rules in [Provide / Inject](../components/provide-inject.md).

Note that Viu deliberately has no `app.config.globalProperties`, because there is no `Proxy` under AOT.
App-level provide plus inject is the sanctioned replacement.

## Not yet implemented

Composables themselves are complete; these are gaps in the surrounding surface that composable authors
run into. See [Project status](../../roadmap/status.md).

- **No `watchSyncEffect` / `watchPostEffect` wrappers** — pass `WatchOptions { Flush = ... }` instead.
- **No async watch callbacks** — `WatchCallback<T>` returns `void`; coordinate async work via `OnCleanup`.
- **No `onTrack` / `onTrigger` debug hooks** — they do not exist on `ReactiveEffect`, `Computed<T>`, or
  `WatchOptions`.
- **No runtime `reactive(obj)`** — object reactivity is compile-time only, via `[Reactive]` on a
  `partial class`. A composable cannot make an arbitrary instance reactive at runtime.
- **No `Reactive.ToRefs(obj)`** — the `toRefs` counterpart is the generated instance method
  `ToReferences()` on a `[Reactive]` class.
- **No `unmarkRaw`** — `Reactive.MarkRaw` is permanent.
- **No `Lifecycle.OnActivated` / `OnDeactivated` invocation** — registration works and the hooks are
  stored, but nothing ever calls them because KeepAlive is not implemented. A composable must not depend
  on them. See [KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md).
- **No thread safety of any kind** — every piece of ambient reactivity state, `EffectScope.Current`
  included, is a plain static field with no synchronization. This is a design decision for the
  single-threaded browser event loop, not a gap to be filled.

## Related

- [Reactivity Fundamentals](../essentials/reactivity-fundamentals.md) — refs and the `[Reactive]` generator
- [Computed Properties](../essentials/computed.md) — caching, ownership, and read-only failure modes
- [Watchers](../essentials/watchers.md) — `ViuWatch` versus `Reactive.Watch`, and the flush-mode default
- [Components](../essentials/components.md) — the `Setup` contract composables are called from
- [Custom Directives](./custom-directives.md) — the other reusability primitive
- [Reactivity API: Core](../../api/reactivity-core.md) — full `EffectScope`, `ReactiveEffect`, and watcher signatures
