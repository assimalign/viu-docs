# Performance

Where a Viu application's rendering cost actually lives, what the runtime and compiler already
optimize for you, and the handful of things an author controls.

> **Status:** Implemented. The mechanisms on this page are real and exercised by tests, but no
> benchmark suite, size budget, or startup measurement exists yet — see
> [Project status](../../roadmap/status.md).

## The budget is the interop boundary

Vue's [performance guide](https://vuejs.org/guide/best-practices/performance.html) frames cost in
terms of JavaScript work and DOM churn. Viu's cost model is different in one decisive way: the
render tree, the reactivity graph, and the diff all run in WebAssembly, while the DOM lives on the
other side of a marshaling boundary. **Every DOM mutation is a call across that boundary, and that
call is the expensive part.** A .NET allocation inside the diff is cheap by comparison.

So the design goal throughout `Assimalign.Viu.RuntimeDom` is *fewer boundary crossings*, not fewer
managed allocations. Three mechanisms implement that goal, and all three are on by default or one
flag away.

| Mechanism | What it saves | Author action |
| --- | --- | --- |
| `int` node handles instead of `JSObject` proxies | Per-node marshaling and GC-visible JS proxies | None — always on |
| One JS listener per `(element, event, capture)` triple | Every re-render's handler rebind | None — always on |
| The interop command buffer | One interop call per mutation → one per flush | `useCommandBuffer: true` |
| Block trees plus `PatchFlags` | Walking and comparing static subtrees | Use compiled `.viu` templates |
| Keyed longest-increasing-subsequence diff | Recreating moved list nodes | Supply a `:key` |

## Nodes cross as `int` handles

Every DOM node reachable from .NET is a **positive `int` handle**, with `0` reserved as the "no
node" sentinel. The JS bridge keeps a `Map` from handle to `Node` and a `WeakMap` back, and .NET
never holds a `JSObject`. This is a measured decision recorded in the package's
`ADR-0001-interop-marshaling.md`.

Two consequences matter to you as an author:

- **Directive hooks receive a handle, not a DOM object** — the `element` argument of a
  `DirectiveHook` is a boxed `int` on the browser, so a custom directive cannot reach into the DOM
  directly. See [Custom Directives](../reusability/custom-directives.md).
- **Handle release is deterministic, never swept** — removing a node walks its subtree with a
  `TreeWalker`, detaches every DOM listener it registered, and returns the released handles from
  the *same* call, which the .NET invoker registry then purges. There is no finalizer race and no
  leak to tune.

## Events cost zero interop to re-bind

Viu ports Vue's invoker pattern. Exactly **one** JS listener exists per
`(nodeHandle, eventName, capture)` triple. When a re-render produces a new handler delegate, the
registry swaps the .NET delegate behind that invoker — no `addEventListener`, no
`removeEventListener`, nothing crosses the boundary at all. This is verified directly by
`BrowserEventInvokerRegistryTests` in the repository — the registry itself is `internal`, so the
excerpt below is a runtime test, not an API you write against:

```csharp
[Fact]
public void SwappingTheHandlerBetweenRenders_MakesZeroBridgeCalls()
{
    var invoked = new List<string>();
    _registry.SetListener(Element, "onClick", (Action)(() => invoked.Add("first")));
    _bridgeCalls.Count.ShouldBe(1); // the one and only addEventListener

    _registry.SetListener(Element, "onClick", (Action)(() => invoked.Add("second")));
    _registry.SetListener(Element, "onClick", (Action)(() => invoked.Add("third")));

    // The whole point of the invoker pattern: swaps cost nothing at the boundary.
    _bridgeCalls.Count.ShouldBe(1);

    _registry.Dispatch(Element, capture: false, Event());
    invoked.ShouldBe(["third"]); // the swapped-in handler runs
}
```

The practical upshot: **do not hand-hoist event handlers out of a render function for performance
reasons.** Allocating a fresh `Action` per render costs one managed allocation, and the boundary
never notices. Hoisting for readability is fine; hoisting as an optimization is cargo cult.

The JS listener also applies Vue's attach-timestamp guard — an event whose `timeStamp` predates the
listener's attachment returns immediately, before any interop call. See
[Event Handling](../essentials/event-handling.md) for the full dispatch contract.

## The interop command buffer

By default each node operation is its own interop call. Opting into the command buffer serializes
every *write* into a shared binary frame that a single `applyCommandBuffer` call drains at the
scheduler's flush boundary.

```csharp
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

// One applyCommandBuffer call per scheduler flush instead of one interop call per mutation.
var application = BrowserRuntime.CreateApp(
    new ApplicationRoot(),
    rootProperties: null,
    useCommandBuffer: true);

application.Mount("#app");

// Keep the WASM main loop alive; rendering is reactive from here.
await Task.Delay(Timeout.Infinite);
```

It is **behaviorally invisible** — the JS applier reuses the exact same leaf functions the direct
path calls, so a buffered frame and a direct sequence produce byte-identical DOM. But it comes with
real constraints, which are worth stating plainly:

| Constraint | Detail |
| --- | --- |
| Opt-in, construction-time only | The `useCommandBuffer` flag on `BrowserRuntime.CreateApp` is the only switch; there is no way to toggle it later |
| One buffered renderer per process | Activation replaces three ambient statics; `Unmount()` restores them |
| No buffered `CreateRenderer` | `BrowserRuntime.CreateRenderer()` always returns the direct-path renderer |
| Reads force a flush | `parentNode`, `nextSibling`, `querySelector`, and `insertStaticContent` cannot be answered from an unapplied buffer |
| Transitions run direct | Transition class, timing, and FLIP operations bypass the buffer entirely |

The read rule is the one that can silently cost you the benefit. **Interleaving reads with writes
defeats the batching** — each read commits the pending frame before it can answer, so a pattern of
write-read-write-read degrades to roughly the direct-path call count plus overhead. Since the
renderer itself only reads during anchor resolution and static-content insertion, this mostly
matters for `<Transition>`-heavy trees, where the FLIP measurement path is read-then-write by
nature and already runs direct. See [Transition & TransitionGroup](../built-ins/transition.md).

Buffered-frame ordering of transition class writes is a documented follow-up, not finished
behavior. Treat the command buffer as the right default for mutation-heavy, transition-light
screens.

## What the compiler already does

Compiled `.viu` templates carry patch metadata that hand-written `VirtualNodeFactory` trees do not.
This is Vue's compiler-informed virtual DOM, ported whole.

- **Block trees** — `_openBlock` / `_createElementBlock` collect only the vnodes that can actually
  change into `VirtualNode.DynamicChildren`. On patch the renderer walks that flat list instead of
  recursing the full subtree, so static markup is never visited twice.
- **`PatchFlags`-guided patching** — a `PatchFlags.Text` element re-patches its text and nothing
  else; `PatchFlags.Class` touches only the class. A verified example: a text-only update to a
  compiled element produces exactly one `SetElementText` operation and zero structural operations.
- **The keyed LIS diff** — `PatchKeyedChildren` runs a genuine longest-increasing-subsequence pass,
  so a reordered keyed list *moves* nodes rather than destroying and recreating them.
- **`v-once` and the cache slot** — `v-once` compiles to `_setBlockTracking` plus a `_setCache`
  write into the generated per-instance `_cache` array, so the subtree is created once and reused
  by reference on every later render. This is the counterpart of Vue's
  [`v-once`](https://vuejs.org/api/built-in-directives.html#v-once).

That metadata is emitted only by the template compiler. A hand-written tree built with
`VirtualNodeFactory.Element(...)` and no explicit `PatchFlags` falls back to the full diff — correct
but unoptimized. It is a good reason to prefer `.viu` files over hand-built vnodes for anything
larger than a demo. See [Single-File Components](../scaling-up/single-file-components.md) and
[Render Functions & VirtualNode](../../api/render-function.md).

## What you control

### Key your lists

Without `:key` the renderer cannot tell a move from a replacement, and the LIS pass has nothing to
work with.

```viu
@template {
    <ul>
        <li v-for="todo in Todos" :key="todo.Id">{{ todo.Title }}</li>
    </ul>
}
```

When `v-for` sits on a `<template>`, the key belongs on the **`<template>` tag itself**, not on one
of its children — the keyed unit is the whole iteration. Putting it on a child reports
`XVForTemplateKeyPlacement` ("`<template v-for>` key should be placed on the `<template>` tag"). See
[Conditional & List Rendering](../essentials/conditional-and-list.md).

### Prefer `ReactiveList<T>` over rebuilding a `List<T>`

Replacing a whole list reference invalidates every subscriber of that reference. Mutating a
`ReactiveList<T>` triggers only what actually read the affected slots, and the type exposes a struct
enumerator so iteration on the render hot path allocates nothing.

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

public sealed class TodoBoard : IComponentDefinition
{
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var todos = new ReactiveList<TodoItem>();
        var remaining = Reactive.Computed(() =>
        {
            // foreach over the struct enumerator: no allocation, tracks the iteration dependency.
            var count = 0;
            foreach (var todo in todos)
            {
                if (!todo.IsDone)
                {
                    count++;
                }
            }
            return count;
        });

        // Mutating the list triggers only the subscribers that read the affected slots.
        void Add() => todos.Add(new TodoItem { Title = "untitled" });

        return () => VirtualNodeFactory.Element(
            "section",
            VirtualNodeFactory.Properties(("class", "board")),
            VirtualNodeFactory.Element("p", $"{remaining.Value} remaining"),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("type", "button"), ("onClick", (Action)Add)),
                "Add"));
    }
}
```

Note the watcher caveat that comes with reactive collections: `Reactive.Watch(todos, callback)` does
not compile, because the collections implement `IReactiveTraversable` but not `IReactiveObject`. Use
a getter source with `Deep = true` instead. See [Watchers](../essentials/watchers.md).

### Let equal-value writes do the coalescing

`Reference<T>` compares with `EqualityComparer<T>.Default` and **does not notify on an equal-value
write**. That single rule is often worth more than any batching. The shipping stopwatch example
relies on it: a 100 ms timer writes ten times a second, but the formatted string only changes once a
second, so the component re-renders once a second.

```csharp
while (!cancellationToken.IsCancellationRequested)
{
    await Task.Delay(100, CancellationToken.None);
    if (stopwatch.IsRunning)
    {
        // Equal-value writes do not notify: ten ticks a second coalesce to one
        // re-render per displayed second.
        elapsedText.Value = stopwatch.Elapsed.ToString(@"hh\:mm\:ss");
    }
}
```

Formatting *into* a ref, rather than storing the raw value and formatting in the render function, is
the pattern that makes this work.

### Batch bulk mutations

`Reactive.StartBatch()` and `Reactive.EndBatch()` queue and coalesce triggers so a bulk update
notifies subscribers once instead of once per write.

```csharp
Reactive.StartBatch();
try
{
    foreach (var row in incoming)
    {
        rows.Add(row);
    }
}
finally
{
    Reactive.EndBatch();
}
```

Always pair them in a `try`/`finally`. `EndBatch` with no open batch throws
`InvalidOperationException("EndBatch called without a matching StartBatch.")`, so an exception
escaping an unbalanced batch turns one bug into two.

### Understand stable slots

`ComponentSlots` defaults to `SlotFlags.Stable`, which means **a parent-only re-render does not
force the child to re-render**. That is safe because a slot's reactive reads are still tracked by
the consuming child. Only structural changes — `v-if`, `v-for`, or dynamic slot names inside the
slot content — need `SlotFlags.Dynamic`, and `PatchFlags.DynamicSlots` on the component vnode forces
the update regardless. Do not mark slots dynamic defensively. See [Slots](../components/slots.md).

### Derive with `Computed<T>`, not in the render body

A `Computed<T>` is version-cached and only re-evaluates when a source actually changed. The same
expression inlined into the render function re-runs on every render. See
[Computed Properties](../essentials/computed.md).

## How to measure

### Operation counts, on CoreCLR

`Assimalign.Viu.Testing` renders into an in-memory tree and records every node operation. Because
the test node-ops take no shortcuts into renderer internals, **the operation sequence you observe is
the sequence the browser adapter would receive** — so operation counts are a faithful CoreCLR proxy
for interop call counts, measurable in an ordinary unit test with no browser or WASM toolchain.

```csharp
using Shouldly;
using Xunit;

using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.Shared;
using Assimalign.Viu.Testing;

[Fact]
public void TextOnlyUpdate_ProducesExactlyOneOperation()
{
    var renderer = new TestRenderer();
    var container = renderer.CreateContainer();

    VirtualNode Compiled(string text) =>
        VirtualNodeFactory.Element("div", null, text, PatchFlags.Text);

    renderer.Render(Compiled("a"), container);
    renderer.OperationLog.Reset();           // isolate the patch from the mount
    renderer.Render(Compiled("b"), container);

    renderer.OperationLog.Count(TestNodeOperationType.SetElementText).ShouldBe(1);
    renderer.OperationLog.StructuralOperationCount.ShouldBe(0);
    renderer.OperationLog.Operations.Count.ShouldBe(1);
}
```

`OperationLog.Reset()` right after the mount is the canonical arrange step, and
`StructuralOperationCount.ShouldBe(0)` is the idiomatic way to pin "this patch did no structural
work". `OfType(...)` returns the operations themselves so you can assert on `PropertyName`,
`PreviousValue`, and `NextValue`. See [Testing](../scaling-up/testing.md).

### Handle-leak checks, in the browser

`BrowserRuntime.GetRegistryDiagnostics()` returns
`(int JsNodes, int JsListenerMaps, int DotnetListeners)`. A mount/unmount cycle must return all
three to their prior sizes — that is the lifecycle contract, and the example app's `?diagnostics=1`
mode verifies it over 100 raw mount/unmount cycles of a listener-bearing tree plus 25 full
`CreateApp`/`Mount`/`Unmount` cycles with component lifecycles, props, emits, and timers.

```csharp
using System;

using Assimalign.Viu.RuntimeDom;

var before = BrowserRuntime.GetRegistryDiagnostics();

var panel = BrowserRuntime.CreateApp(new DetailPanel());
panel.Mount("#panel");
panel.Unmount();

var after = BrowserRuntime.GetRegistryDiagnostics();

// Any drift here is a handle or listener leak, not a GC artifact — release is deterministic.
Console.WriteLine($"nodes {before.JsNodes} -> {after.JsNodes}, " +
                  $"listeners {before.DotnetListeners} -> {after.DotnetListeners}");
```

Both this and `CreateApp` throw `InvalidOperationException` unless
`BrowserRuntime.InitializeAsync()` has been **awaited** to completion — merely calling it is not
enough.

## Not yet implemented

Being honest about measurement is part of a performance page:

- **No benchmark suite** — there are no published throughput, size, or startup numbers for Viu of
  any kind. The only browser-side measurement in the repository is an ad-hoc benchmark script in the
  example app, reachable through its `?diagnostics=1` query.
- **No 10k-row measurements** — the command buffer's payoff is proven today only by an instrumented
  apply-counter, not by a large-list benchmark.
- **No WASM size or startup budget gates** — planned, not built.
- **Buffered-frame ordering of transition writes** — transition operations run direct even with
  `useCommandBuffer: true`.
- **No `defineAsyncComponent`, no `KeepAlive`** — the two Vue features most often reached for as
  performance tools do not exist. `KeepAlive` is a marker that throws `NotSupportedException`; see
  [KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md).
- **`v-memo` codegen** — parses, but does not yet emit compilable C#, so
  [Vue's `v-memo`](https://vuejs.org/api/built-in-directives.html#v-memo) has no working
  counterpart. Reach for `v-once` instead where the subtree is genuinely static.

For the constraint that explains why so much of this is precomputed rather than discovered at
runtime, read [AOT & Trimming](./aot-and-trimming.md). For the full area-by-area picture, read
[Project status](../../roadmap/status.md).
