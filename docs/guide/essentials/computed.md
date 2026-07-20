# Computed Properties

Lazily evaluated, self-caching derived state built with `Reactive.Computed<T>`, and the read-only
rules that differ from every other read-only shape in Viu.

> **Status:** Implemented.

Viu's `Reactive.Computed<T>` is the C# port of Vue's
[`computed()`](https://vuejs.org/api/reactivity-core.html#computed). It behaves the way a Vue
developer expects — lazy, cached, tracked, optionally writable — with the same `.Value` /
`.value` spelling change that applies across the whole reactivity layer. The differences worth
learning are in caching detail, in what happens when you write to a read-only computed, and in the
fact that a computed is never owned by an `EffectScope`.

If you have not read [Reactivity Fundamentals](reactivity-fundamentals.md) yet, start there —
this page assumes `Reference<T>` and `.Value`.

## Creating a computed

There is exactly one factory, with an optional setter:

```csharp
public static Computed<T> Computed<T>(Func<T> getter, Action<T>? setter = null);
```

It returns `Computed<T>`, which implements `IReference<T>` — so a computed is a ref as far as the
rest of the system is concerned, and `Reactive.IsRef(computed)` is `true`.

```csharp
using System;
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(1);
var doubled = Reactive.Computed(() => count.Value * 2);

Console.WriteLine(doubled.Value); // 2

count.Value = 5;
Console.WriteLine(doubled.Value); // 10
```

The type parameter is inferred from the getter's return type, so `Reactive.Computed(() =>
count.Value * 2)` is a `Computed<int>`. Reading `doubled.Value` inside an effect, a watcher, or a
render function establishes a dependency on the computed, and the computed in turn depends on
every reactive value its getter read.

The Vue counterparts, for orientation:

| Vue 3 | Viu | Notes |
| --- | --- | --- |
| `computed(getter)` | `Reactive.Computed<T>(getter)` | Read-only computed. |
| `computed({ get, set })` | `Reactive.Computed<T>(getter, setter)` | Writable computed. |
| `ComputedRef<T>` | `Computed<T>` | A sealed class deriving from `Subscriber` and implementing `IReference<T>`. |
| `.value` | `.Value` | Capital `V`, everywhere. |
| `isReadonly(c)` | `Reactive.IsReadonly(c)` | `true` for a getter-only computed. |
| — | `Computed<T>.IsWritable` | Viu addition: whether a setter was supplied. |

## Deriving a list

The most common use of a computed is projecting reactive source data into the shape a template
wants. Because expressions are plain C#, LINQ is the idiomatic tool:

```csharp
using Assimalign.Viu.Reactivity;

[Reactive]
public partial class TodoItem
{
    public partial string Title { get; set; }

    public partial bool Done { get; set; }
}
```

```csharp
using System;
using System.Linq;
using Assimalign.Viu.Reactivity;

var todos = new ReactiveList<TodoItem>
{
    new TodoItem { Title = "Port the reactivity graph", Done = true },
    new TodoItem { Title = "Port the renderer", Done = false },
    new TodoItem { Title = "Write the docs", Done = false },
};

var showDone = Reactive.Reference(false);

var visible = Reactive.Computed(() => showDone.Value
    ? todos.ToList()
    : todos.Where(todo => !todo.Done).ToList());

var remaining = Reactive.Computed(() => todos.Count(todo => !todo.Done));

Console.WriteLine(remaining.Value); // 2

todos[1].Done = true;
Console.WriteLine(remaining.Value); // 1

todos.Add(new TodoItem { Title = "Ship", Done = false });
Console.WriteLine(remaining.Value); // 2
```

Both computeds stay correct for two different reasons, and it is worth knowing which is which:

- **Element mutation** — `todos[1].Done = true` triggers the `Done` dependency the `[Reactive]`
  source generator emitted on `TodoItem`. The getter read that property, so it is a dependency.
- **Structural mutation** — `todos.Add(...)` triggers `ReactiveList<T>`'s iteration and length
  dependencies. Enumerating the list (which `Where`, `Count`, and `ToList` all do) tracks
  iteration, so the getter re-runs.

A computed built over a `List<T>` instead of a `ReactiveList<T>` would see the first change but
not the second, because a plain `List<T>` owns no dependency cells at all.

## Writable computeds

Pass a setter to make a computed writable. The classic full-name example, verified against
`ComputedTests.cs`:

```csharp
using System;
using Assimalign.Viu.Reactivity;

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

Console.WriteLine(full.IsWritable); // True
Console.WriteLine(full.Value);      // John Doe

full.Value = "Jane Smith";
Console.WriteLine(first.Value);     // Jane
Console.WriteLine(last.Value);      // Smith
```

The setter is a plain `Action<T>`. It does not compute or cache anything — its only job is to
write back into the sources the getter reads, which is what makes the next read produce the value
you just assigned. Viu enforces nothing about that relationship; a setter that writes to unrelated
state produces a computed whose read and write disagree, exactly as in Vue.

`IsWritable` is a Viu addition with no Vue counterpart. It exposes the same fact
`Reactive.IsReadonly` reports, from the other direction:

```csharp
// Continues the snippet above.
var readOnly = Reactive.Computed(() => 1);

Console.WriteLine(readOnly.IsWritable);           // False
Console.WriteLine(Reactive.IsReadonly(readOnly)); // True
Console.WriteLine(Reactive.IsReadonly(full));     // False — a writable computed is not readonly
```

## Read-only failure modes

This is the divergence most likely to bite you at runtime, because Viu has **three read-only
shapes and only two failure modes**, and they are not interchangeable.

| Shape | Write behavior | How you find out |
| --- | --- | --- |
| Getter-only `Computed<T>` | **Throws** | `NotSupportedException("Cannot write to a computed without a setter.")` |
| Getter-only `Reactive.ToRef(getter)` | Silent no-op | `Debug.WriteLine` warning only |
| `[Reactive(Readonly = true)]` property | Silent no-op | `Debug.WriteLine` warning only |

```csharp
using Assimalign.Viu.Reactivity;

[Reactive(Readonly = true)]
public partial class ReadonlyProfile
{
    public partial string Handle { get; set; }
}
```

```csharp
using System;
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(1);
var todo = new TodoItem { Title = "Write the docs", Done = false };

// 1. Computed without a setter — a hard exception.
var doubled = Reactive.Computed(() => count.Value * 2);
doubled.Value = 5; // throws NotSupportedException

// 2. ToRef without a setter — nothing happens, the source is unchanged.
var titleRef = Reactive.ToRef(() => todo.Title);
titleRef.Value = "Something else";
Console.WriteLine(todo.Title); // "Write the docs" — the write was dropped

// 3. [Reactive(Readonly = true)] — the generated setter warns and neither mutates nor triggers.
var profile = new ReadonlyProfile();
profile.Handle = "ada";
Console.WriteLine(profile.Handle is null); // True — the assignment never landed
```

Case 3 has a sharp edge worth naming: an object initializer routes through that same generated
setter, so `new ReadonlyProfile { Handle = "ada" }` is *also* dropped. A `[Reactive(Readonly =
true)]` class has no way to seed its own properties from outside.

The practical consequence: **a getter-only computed is the only read-only shape you can rely on to
fail loudly.** The other two emit a `Debug.WriteLine`, which is invisible in a Release WASM build.
When you need a derived value that must never be written by mistake, a getter-only computed is the
shape that will actually tell you.

Reads still track in all three cases. Read-only in Viu means "writes are rejected", never "this
value stops participating in reactivity".

## Laziness and caching

A computed's getter does not run at construction, and it does not re-run on every read. It runs on
the first read, then again only when a dependency has actually changed:

```csharp
using System;
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(1);
var getterRuns = 0;
var doubled = Reactive.Computed(() =>
{
    getterRuns++;
    return count.Value * 2;
});

Console.WriteLine(getterRuns);    // 0 — lazy: not invoked at construction

Console.WriteLine(doubled.Value); // 2
Console.WriteLine(doubled.Value); // 2
Console.WriteLine(getterRuns);    // 1 — the second read is served from cache

count.Value = 5;
count.Value = 6;
Console.WriteLine(getterRuns);    // 1 — nothing recomputed yet; there was no read

Console.WriteLine(doubled.Value); // 12
Console.WriteLine(getterRuns);    // 2 — exactly one recomputation, on the read
```

Two writes between reads produce one recomputation, not two. Internally, a computed is
version-cached and additionally guarded by a global-version fast path, so a read taken when
nothing reactive has changed anywhere skips dependency traversal entirely. You never manage this;
it just means reads of an unchanged computed are close to free.

### Equal-value recomputation does not propagate

When a computed recomputes and the new value equals the old one, its downstream subscribers are
not notified. This is what keeps a `bool` or a bucketed value from re-rendering the world every
time an underlying number moves:

```csharp
using System;
using Assimalign.Viu.Reactivity;

var a = Reactive.Reference(1);
var getterRuns = 0;
var effectRuns = 0;

var positive = Reactive.Computed(() =>
{
    getterRuns++;
    return a.Value > 0;
});

Reactive.Effect(() =>
{
    effectRuns++;
    _ = positive.Value;
});

Console.WriteLine(effectRuns); // 1
Console.WriteLine(getterRuns); // 1

// 1 -> 2: the computed recomputes to the same `true`; the effect must not re-run.
a.Value = 2;
Console.WriteLine(getterRuns); // 2
Console.WriteLine(effectRuns); // 1

// 2 -> -1: the value actually changes; the effect re-runs.
a.Value = -1;
Console.WriteLine(getterRuns); // 3
Console.WriteLine(effectRuns); // 2
```

Note the asymmetry: the **getter** re-runs (the computed had to recompute to discover the value
was unchanged), but the **effect** does not.

### Change detection uses `EqualityComparer<T>.Default`

Vue compares with `Object.is`. Viu compares with `EqualityComparer<T>.Default`, across refs,
computeds, and generated `[Reactive]` property setters alike. The two agree on the case people
usually ask about and disagree on one:

- **`NaN` is self-equal** — same as `Object.is`. Recomputing `double.NaN` from `double.NaN` does
  not notify.
- **`+0.0` and `-0.0` compare equal** — *unlike* `Object.is`, which distinguishes them. A computed
  moving from `-0.0` to `+0.0` is treated as unchanged.

For reference types this means `Equals`/`IEquatable<T>` semantics, not reference identity: a
computed returning a value-equal `record` will not notify downstream even though the instance is
new. There is no way to inject a custom `IEqualityComparer<T>` — see
[Not yet implemented](#not-yet-implemented).

## Computeds are never owned by an effect scope

This is upstream Vue 3.5 parity and it surprises people, so it is worth stating plainly:
`EffectScope` collects every `ReactiveEffect` — and therefore every watcher — created while it is
current, but **it never collects computeds**. A computed created inside a scope keeps serving
fresh values and stays fully reactive after `scope.Stop()`.

```csharp
using System;
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(1);
Computed<int>? doubled = null;

var scope = Reactive.EffectScope();
scope.Run(() => doubled = Reactive.Computed(() => count.Value * 2));

scope.Stop();

count.Value = 5;
Console.WriteLine(doubled!.Value); // 10 — still fresh

// A NEW effect reading the computed is fully reactive, too.
var effectRuns = 0;
var seen = 0;
Reactive.Effect(() =>
{
    effectRuns++;
    seen = doubled!.Value;
});

count.Value = 6;
Console.WriteLine(effectRuns);     // 2
Console.WriteLine(seen);           // 12
```

The same exclusion applies to pausing. `EffectScope.Pause()` and `Resume()` cascade to child
scopes and to the effects the scope contains — but **never to computeds**. Pausing a scope does
not freeze a computed's value; a read still recomputes.

If you are writing a composable and you want derived state to stop when the scope stops, the
computed is the wrong tool. Stop the *effects that read it* instead — those are scope-owned — or
gate the getter on a ref you flip during teardown.

## Cleanup is subscriber-count driven

Since a scope will not tear a computed down, Viu uses the same mechanism Vue 3.5 does: the
computed's own subscriber count.

- **Losing the last subscriber soft-detaches it** — when nothing is observing a computed any more,
  it unsubscribes from its sources, so mutating those sources no longer re-runs its getter.
- **The next tracked read re-attaches it** — reading `.Value` again resubscribes and serves a
  freshly computed value.

The upshot for application code is that an unread computed costs nothing and you never have to
dispose one. There is no `Stop()` on `Computed<T>`, and none is needed: a computed never enters a
stopped state, and a read always returns a correct value.

## A throwing getter is not poisoned

If a computed's getter throws, the exception propagates to whoever read `.Value`. The computed
does not cache the failure — the next read invokes the getter again:

```csharp
using System;
using Assimalign.Viu.Reactivity;

var denominator = Reactive.Reference(0);
var ratio = Reactive.Computed(() => 100 / denominator.Value);

// Reading ratio.Value here throws DivideByZeroException.

denominator.Value = 4;
Console.WriteLine(ratio.Value); // 25 — the getter is re-invoked, not stuck on the failure
```

This means a computed over data that is briefly invalid recovers on its own once the data becomes
valid, without any reset step.

## Forcing a notification

`Reactive.TriggerReference` takes any `IReference` and force-notifies the readers of those that
own a dependency cell — `Computed<T>` is one of them (upstream parity with `triggerRef()`). The
notification bypasses the equality cutoff entirely:

```csharp
using System;
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(1);
var doubled = Reactive.Computed(() => count.Value * 2);

Reactive.Effect(() => Console.WriteLine(doubled.Value));

// Re-runs the effect even though the computed's cached value is unchanged.
Reactive.TriggerReference(doubled);
```

This is a deliberate escape hatch and rarely the right answer. If you find yourself reaching for
it routinely, the usual cause is a getter reading through something that is not reactive — a plain
`List<T>`, a POCO with no `[Reactive]` attribute — and the fix is to make that source reactive
rather than to force notifications. Note that `Reactive.ToRef(...)` refs own no dependency cell, so
`TriggerReference` is a silent no-op on them.

## Computeds in a component

Inside `Setup`, a computed is created once, captured by the returned render closure, and read
during render. Because `Setup` runs exactly once per instance, there is no re-creation cost per
render:

```csharp
using System;
using System.Linq;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

public sealed class TodoSummary : IComponentDefinition
{
    public string? Name => "TodoSummary";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var todos = new ReactiveList<TodoItem>();
        var remaining = Reactive.Computed(() => todos.Count(todo => !todo.Done));
        var label = Reactive.Computed(() => remaining.Value == 1
            ? "1 item left"
            : $"{remaining.Value} items left");

        return () => VirtualNodeFactory.Element(
            "p",
            VirtualNodeFactory.Properties(("class", "todo-summary")),
            label.Value);
    }
}
```

Note that `label` is a computed over another computed. Chaining is normal and cheap: `label` only
recomputes when `remaining` reports an actual value change, so incrementing and decrementing a
todo's `Done` flag back to the same count re-renders nothing.

A `.viu` single-file component expresses the same derivation, and its template reads it without
`.Value` — the generator classifies any `Computed<T>` member as a `SetupReference` binding and
inserts `.Value` during identifier rewriting. The one thing to get right is that `@script` content
is a **partial-class body, not a method body**: the computeds are members initialized in a
constructor, not locals.

```viu
@template {
    <p class="todo-summary">{{ Label }}</p>
}

@script {
    using System.Linq;
    using Assimalign.Viu.Reactivity;

    public ReactiveList<TodoItem> Todos = new();

    public Computed<int> Remaining { get; }

    public Computed<string> Label { get; }

    public TodoSummary()
    {
        Remaining = Reactive.Computed(() => Todos.Count(todo => !todo.Done));
        Label = Reactive.Computed(() => Remaining.Value == 1
            ? "1 item left"
            : $"{Remaining.Value} items left");
    }
}
```

The class name comes from the file name, so this is `TodoSummary.viu`. Indent every block body —
a `}` in column 0 closes the block.

> **Not yet implemented:** the `.viu` compiler emits the `partial class` and its `Render` method,
> but the runtime adapter that turns that generated class into an `IComponentDefinition` does not
> exist yet, so a `.viu` component cannot be mounted today. The C# `IComponentDefinition` form
> above is the shape that runs.

See [Single-File Components](../scaling-up/single-file-components.md) for the `.viu` block format
and [Template Syntax](template-syntax.md) for the `.Value` insertion rule.

## Computed or watcher?

Both derive from reactive state, and picking the wrong one is a common source of tangled code.

- **Use a computed for a value** — when you want to *read* something derived, want it cached, and
  want it recomputed only on demand. A computed getter should be pure: no writes to other refs, no
  DOM work, no I/O.
- **Use a watcher for an action** — when a change should *cause* something: a network call, a log
  line, imperative work. See [Watchers](watchers.md), and note the flush-mode divergence documented
  there — `WatchOptions.Flush` defaults to `WatchFlushMode.Sync`, not `Pre`.

A getter that mutates state is the anti-pattern in both frameworks. In Viu it is worse than
untidy: writing to a ref that the same getter reads sets up a self-triggering dependency, and the
recursion suppression that saves a `ReactiveEffect` (`AllowRecurse`, default `false`) is not part
of a computed's contract.

## Not yet implemented

The following exist in Vue but not in Viu today. See [Project Status](../../roadmap/status.md) and
[Differences from Vue 3](../../roadmap/vue-differences.md) for the full picture.

- **No `onTrack` / `onTrigger` debug hooks** — Vue's dev-only computed debugging callbacks do not
  exist on `Computed<T>`, `ReactiveEffect`, or `WatchOptions`.
- **No custom equality comparer** — change detection is hardwired to `EqualityComparer<T>.Default`
  on `Computed<T>`, `Reference<T>`, `ShallowReference<T>`, and generated property setters. There
  is no injection point.
- **No runtime `readonly(obj)` wrapper** — you cannot derive a read-only view of an existing
  mutable reactive object. Read-only is decided at compile time via
  `[Reactive(Readonly = true)]`, or per value by omitting a computed's setter.
- **No async computeds** — the getter is a `Func<T>`; there is no `Task`-returning form, and
  `Suspense` is a marker object that throws `NotSupportedException`, so there is no boundary to
  await one. Load asynchronously into a `Reference<T>` from `Setup` and derive from that ref
  instead. See [KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md).
- **No thread safety** — every piece of ambient reactivity state is a plain static field with no
  synchronization. This is a design decision for the single-threaded browser event loop, not a gap
  to be filled. Do not touch a computed from a background thread.
