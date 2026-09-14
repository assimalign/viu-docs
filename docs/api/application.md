# Application API

Reference for creating, configuring, mounting, and unmounting a Viu application, plus the browser
bootstrap that puts one on screen.

> **Status:** Implemented. `ApplicationConfiguration.Performance` is inert and there is no SSR or
> hydration entry point — see [Project status](../roadmap/status.md).

Viu splits the application surface across two packages, exactly as Vue splits `@vue/runtime-core`
from `@vue/runtime-dom`:

- **`Assimalign.Viu.RuntimeDom`** — `BrowserRuntime` and `BrowserApplication`, the browser-specific
  half. This is what an app author calls. It is the counterpart to Vue's
  [`createApp`](https://vuejs.org/api/application.html#createapp) from `vue`.
- **`Assimalign.Viu.RuntimeCore`** — `Application<TNode>`, `Renderer<TNode>`, `RendererFactory`,
  and `Scheduler`, the platform-agnostic half. This is the counterpart to Vue's
  [`createRenderer`](https://vuejs.org/api/custom-renderer.html#createrenderer) surface, and it is
  what you reach for when targeting a node type other than the DOM.

Everything on this page is single-threaded by design. `BrowserRuntime`, `BrowserApplication`, the
`Scheduler`, and every ambient static behind them assume the browser main thread and the JavaScript
event-loop model. None of it is thread-safe, and that is deliberate.

## The whole bootstrap

Two calls create and mount a Viu app. A third keeps the WebAssembly main loop alive.

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new StopwatchApplication()).Mount("#app");

// Keep the WASM main loop alive; rendering is reactive from here.
await Task.Delay(Timeout.Infinite);
```

The `Task.Delay(Timeout.Infinite)` is not a placeholder. `runMain()` returning would tear the
managed app down, and after `Mount` there is no further imperative work to do — every subsequent
frame is driven by a reactive effect reacting to a `Reference<T>` write. See
[Quick Start](../guide/quick-start.md) for the surrounding project, `index.html`, and `main.js`.

## `BrowserRuntime`

```csharp
[SupportedOSPlatform("browser")]
public static class BrowserRuntime
{
    public static Task InitializeAsync(CancellationToken cancellationToken = default);

    public static BrowserApplication CreateApp(
        IComponentDefinition rootComponent,
        VirtualNodeProperties? rootProperties = null,
        bool useCommandBuffer = false);

    public static Renderer<int> CreateRenderer();

    public static int QuerySelector(string selector);

    public static (int JsNodes, int JsListenerMaps, int DotnetListeners) GetRegistryDiagnostics();
}
```

### `InitializeAsync`

Loads the `viu-dom.js` bridge module that ships inside the `Assimalign.Viu.RuntimeDom` package and
wires up event dispatch. It must complete before anything else on this class is touched.

- **Idempotent, but not retryable** — the implementation is `_initialization ??=
  InitializeCoreAsync(cancellationToken)`. The `Task` is cached in a static field forever. If the
  module fetch fails, the *faulted* task is what every later call returns; there is no way to try
  again in the same process.
- **The cancellation token of later calls is ignored** — only the first call's token is ever
  observed, because later calls never reach `InitializeCoreAsync`.
- **You must `await` it, not merely call it** — the guard behind every other member requires
  `IsCompletedSuccessfully`. Firing and forgetting leaves you throwing `InvalidOperationException`
  from `CreateApp`.

### `CreateApp`

The counterpart to Vue's [`createApp(rootComponent)`](https://vuejs.org/api/application.html#createapp).
Builds the browser node-ops, wraps them in a `Renderer<int>`, and returns a `BrowserApplication`.

- **`rootProperties`** — root-level props handed to the root component, the counterpart to Vue's
  second `createApp` argument. Build them with `VirtualNodeFactory.Properties`.
- **`useCommandBuffer`** — opt into the batched interop command buffer. Node operations serialize
  into a shared binary frame that a single interop call applies per scheduler flush, instead of one
  call per mutation. It is behaviorally invisible: buffered and direct modes produce byte-identical
  DOM. It is construction-time only, and because it arms three ambient statics, **only one buffered
  renderer may be live per process**. `Unmount` restores them.
- **Throws** `ArgumentNullException` when `rootComponent` is null, and `InvalidOperationException`
  when `InitializeAsync` has not completed successfully.

### `CreateRenderer`, `QuerySelector`, `GetRegistryDiagnostics`

| Member | Behavior |
| --- | --- |
| `CreateRenderer()` | Returns a `Renderer<int>` over the browser node-ops (upstream: `ensureRenderer()`). Always the **direct** path — there is no buffered overload. |
| `QuerySelector(string)` | Resolves a CSS selector to an `int` node handle. Throws `BrowserDomException` when nothing matches, naming the selector. Throws `ArgumentException` on a null or empty selector. |
| `GetRegistryDiagnostics()` | Returns `(JsNodes, JsListenerMaps, DotnetListeners)` — leak diagnostics for the handle registries. A full mount/unmount cycle must return all three to their prior sizes. |

`GetRegistryDiagnostics` is the tool for proving no handles leaked across a mount cycle:

```csharp
var before = BrowserRuntime.GetRegistryDiagnostics();

var application = BrowserRuntime.CreateApp(new App());
application.Mount("#app");
application.Unmount();

var after = BrowserRuntime.GetRegistryDiagnostics();
// after.JsNodes == before.JsNodes, and likewise for the listener maps and .NET listeners.
```

## `BrowserApplication`

```csharp
[SupportedOSPlatform("browser")]
public sealed class BrowserApplication
{
    public bool IsMounted { get; }
    public ComponentInstance? RootInstance { get; }
    public ApplicationConfiguration Config { get; }

    public BrowserApplication Component(string name, IComponentDefinition definition);
    public IComponentDefinition? Component(string name);
    public BrowserApplication Directive(string name, IDirective directive);
    public IDirective? Directive(string name);
    public BrowserApplication Provide<T>(InjectionKey<T> key, T value);
    public BrowserApplication Provide(string key, object? value);
    public BrowserApplication Use(IPlugin<int> plugin, object? options = null);

    public ComponentInstance? Mount(string selector);
    public ComponentInstance? Mount(int containerHandle);
    public void Unmount();
}
```

The constructor is `internal`. `BrowserRuntime.CreateApp` is the only way to obtain one.

### Configuring an application before mount

All five registration members return `this`, so the whole configuration reads as one chain. Calling
`Component`, `Directive`, `Provide`, or `Use` after `Mount` produces a dev warning and does not
affect the rendered tree. Setting a `Config` handler after mount does not warn, but `WarnHandler` is
only installed as the warning sink at `Mount` — assign it beforehand or it is never consulted.

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

var application = BrowserRuntime.CreateApp(new App());

application.Config.ErrorHandler = (exception, instance, info) =>
    Console.Error.WriteLine(
        $"[viu] <{instance?.Definition.Name}> failed during {info}: {exception}");
application.Config.WarnHandler = message => Console.WriteLine($"[viu warn] {message}");

application
    .Component("ElapsedDisplay", new ElapsedDisplay())
    .Directive("focus", new Directive { Mounted = static (_, _, _, _) => { } })
    .Provide(Theme.Key, "dark")
    .Use(new AnalyticsPlugin(), options: "verbose");

application.Mount("#app");

await Task.Delay(Timeout.Infinite);
```

### `Component` and `Directive`

The counterparts to [`app.component`](https://vuejs.org/api/application.html#app-component) and
[`app.directive`](https://vuejs.org/api/application.html#app-directive). Registering a name makes it
resolvable by descendants — including through `<component :is="name">`.

The single rule most likely to surprise you: **the one-argument getters are exact-name lookups, while
name-form matching happens only at render time — and it is directional, not case-insensitive.** The
registries are ordinal dictionaries; render-time resolution probes exactly three spellings in order:
the raw name, its camelCase form (hyphens removed, the next letter uppercased), then the PascalCase
form of that. Nothing is ever lowercased or re-hyphenated.

| Call | Result |
| --- | --- |
| `app.Component("MyChild", definition)` | Registers under the literal key `"MyChild"`. |
| `app.Component("MyChild")` | Returns the definition — exact match. |
| `app.Component("mychild")` | Returns `null` — the getter does not normalize. |
| A template referencing `my-child` | **Resolves.** Camelize gives `myChild`, capitalize gives `MyChild`. |
| A template referencing `mychild` | **Does not resolve.** No hyphen, so camelize is a no-op and the last probe is `Mychild`. |

Both two-argument forms throw `ArgumentException` on a null or empty name and `ArgumentNullException`
on a null definition or directive. A duplicate name, or a registration made after `Mount`, warns in
dev. See [Dynamic Components & Registration](../guide/components/dynamic-components.md) for the
resolution rules in full and [Custom Directives](../guide/reusability/custom-directives.md) for
writing an `IDirective`.

### `Provide`

The counterpart to [`app.provide`](https://vuejs.org/api/application.html#app-provide), and the final
fallback in the inject lookup chain — an `Inject` that finds no ancestor provider lands here.

```csharp
public static class Theme
{
    public static readonly InjectionKey<string> Key = new("theme");
}

application.Provide(Theme.Key, "dark");
```

`InjectionKey<T>` identity is **reference identity**. It is deliberately a class rather than a record,
because record value equality would make every same-typed key collide. Two keys constructed with the
same `Name` are different keys — always declare them `static readonly`. A string-keyed overload
exists for interop with untyped code. Full rules live in
[Provide / Inject](../guide/components/provide-inject.md).

Viu has no `app.config.globalProperties`. That API depends on a JavaScript `Proxy`, which does not
exist under AOT compilation; typed app-level provide plus `Inject` is the sanctioned replacement.

### `Use`

The counterpart to [`app.use`](https://vuejs.org/api/application.html#app-use). Installs a plugin
exactly once per plugin **instance** — a repeat `Use` of the same instance is deduplicated with a dev
warning. Plugins are explicit objects; nothing is ever discovered by reflection or assembly scanning.

Note that `Install` receives the **wrapped `Application<int>`**, not the `BrowserApplication`:

```csharp
using Assimalign.Viu.RuntimeCore;

internal sealed class AnalyticsPlugin : IPlugin<int>
{
    public void Install(Application<int> application, object? options)
    {
        application.Component("analytics-beacon", new AnalyticsBeacon());
        application.Provide(Analytics.Key, new AnalyticsClient(options as string));
    }
}
```

### `Mount`

`Mount(string selector)` resolves the selector through `BrowserRuntime.QuerySelector` and forwards to
`Mount(int containerHandle)`. A null or empty selector throws `ArgumentException`; a selector matching
nothing throws `BrowserDomException`.

**On the first mount the container is unconditionally cleared.** `Mount` calls `setElementText(handle,
"")`, wiping any markup already inside `#app` and releasing the handles of its children. This is
upstream parity for a non-hydrating client mount, and it is the concrete reason Viu cannot adopt
server-rendered HTML today.

A second `Mount` on an already-mounted application warns, no-ops, and returns the existing instance.
The returned `ComponentInstance?` is the root instance, also available afterwards as `RootInstance`.

### `Unmount`

Runs component teardown lifecycles, removes the rendered DOM, and releases every JS-side handle and
DOM listener the application created. In buffered mode the teardown mutations commit through the
command buffer before the buffered operations detach from the ambient scheduler and dispatch seams.

There are no unmount cleanup callbacks — Vue's `app.onUnmount` has no counterpart. Use
`Lifecycle.OnUnmounted` inside a component instead.

## `ApplicationConfiguration`

```csharp
public sealed class ApplicationConfiguration
{
    public Action<Exception, ComponentInstance?, string>? ErrorHandler { get; set; }
    public Action<string>? WarnHandler { get; set; }
    public bool Performance { get; set; }
}
```

The counterpart to [`app.config`](https://vuejs.org/api/application.html#app-config). Reached through
`BrowserApplication.Config`, which is the same instance as the wrapped `Application<int>.Config`.

- **`ErrorHandler`** — receives `(exception, instance, info)` for any error no ancestor
  `Lifecycle.OnErrorCaptured` hook stopped. **When set, it is the terminal sink and the error is not
  rethrown. When null, an unhandled error rethrows to the host with its original stack.** Both halves
  matter: installing a handler converts a loud crash into a silent report.
- **`WarnHandler`** — intercepts dev warnings while the app is mounted. It receives **only the
  message string** — no instance, no component trace — because the underlying warning seam is
  message-based. It is installed as the global sink on `Mount` and restored on `Unmount`.
- **`Performance`** — settable, but toggling it has **no effect**. The instrumentation ships with the
  devtools work, which does not exist yet.

An error handler that swallows a render failure:

```csharp
var failing = new FailingComponent();
var application = BrowserRuntime.CreateApp(failing);

Exception? seen = null;
application.Config.ErrorHandler = (exception, instance, info) => seen = exception;

application.Mount("#app");   // does not throw

// seen is the InvalidOperationException the render function raised;
// instance was application.RootInstance; info was the string "render function".
```

DOM **event handler** exceptions do not reach `ErrorHandler` yet. The event invoker registry still
routes them to a placeholder `Debug.WriteLine` sink, which is invisible in a Release WebAssembly
build. Wiring the two together is a roadmap item — see
[Event Handling](../guide/essentials/event-handling.md).

## `Application<TNode>`

The platform-agnostic application shell, the port of upstream's `createAppAPI(render)`. Create one
with `Renderer<TNode>.CreateApplication`; `BrowserApplication` is a thin wrapper over
`Application<int>`.

```csharp
public sealed class Application<TNode>
    where TNode : notnull
{
    public bool IsMounted { get; }
    public ComponentInstance? RootInstance { get; }
    public ApplicationConfiguration Config { get; }

    public Application<TNode> Component(string name, IComponentDefinition definition);
    public IComponentDefinition? Component(string name);
    public Application<TNode> Directive(string name, IDirective directive);
    public IDirective? Directive(string name);
    public Application<TNode> Provide<T>(InjectionKey<T> key, T value);
    public Application<TNode> Provide(string key, object? value);
    public Application<TNode> Use(IPlugin<TNode> plugin, object? options = null);

    public ComponentInstance? Mount(TNode container);
    public void Unmount();
}
```

The semantics are identical to `BrowserApplication`'s with one difference: **`Mount` takes a `TNode`,
not a selector.** Selector resolution is RuntimeDom's job. Mounting with root props:

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.RuntimeCore;

internal sealed class Greeter : IComponentDefinition
{
    public string? Name => "Greeter";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
    [
        new ComponentPropertyDefinition("greeting") { DefaultValue = "hi" },
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => () => VirtualNodeFactory.Element(
            "div", properties.Get<string>("greeting") ?? string.Empty);
}

// Root props are supplied at application creation, not at mount.
var application = renderer.CreateApplication(
    new Greeter(), VirtualNodeFactory.Properties(("greeting", "hello")));

application.Mount(container);
```

## `IPlugin<TNode>`

```csharp
public interface IPlugin<TNode>
    where TNode : notnull
{
    void Install(Application<TNode> application, object? options);
}
```

The counterpart to Vue's object-form `Plugin`. `Install` runs exactly once per plugin instance.

A stale XML doc comment on `BrowserApplication.Use` references an `IVuePlugin<TNode>`. **That type
does not exist** — the real interface is `Assimalign.Viu.RuntimeCore.IPlugin<TNode>`.

## Renderers

You only touch these directly when building a custom renderer over a node type other than the DOM, or
when driving a render tree outside an application shell.

### `RendererFactory` and `Renderer<TNode>`

```csharp
public static class RendererFactory
{
    public static Renderer<TNode> CreateRenderer<TNode>(RendererOptions<TNode> options)
        where TNode : notnull;
}

public sealed class Renderer<TNode>
    where TNode : notnull
{
    public void Render(VirtualNode? node, TNode container);
    public RenderEffect<TNode> CreateRenderEffect(Func<VirtualNode> renderFunction, TNode container);
    public Application<TNode> CreateApplication(
        IComponentDefinition rootComponent,
        VirtualNodeProperties? rootProperties = null);
}
```

`RendererFactory.CreateRenderer` is the only way to construct a `Renderer<TNode>`, and the renderer
has exactly three public members — the whole mount/patch/unmount pipeline is private.

`Render` mounts on the first call for a given container, patches against the previous tree on
subsequent calls, and unmounts everything when `node` is null. Critically, **it always drains the pre-
and post-flush scheduler queues before returning**, so lifecycle hooks, directive hooks, and template
refs are all observable immediately after a direct `Render` call. Reactive updates, by contrast, wait
for a flush.

### `RendererOptions<TNode>`

The platform node operations a renderer is built over — ten required, four optional.

```csharp
public sealed class RendererOptions<TNode>
{
    public required Action<TNode, TNode, TNode?> Insert { get; init; }
    public required Action<TNode> Remove { get; init; }
    public required Func<string, string?, TNode> CreateElement { get; init; }
    public required Func<string, TNode> CreateText { get; init; }
    public required Func<string, TNode> CreateComment { get; init; }
    public required Action<TNode, string> SetText { get; init; }
    public required Action<TNode, string> SetElementText { get; init; }
    public required Func<TNode, TNode?> ParentNode { get; init; }
    public required Func<TNode, TNode?> NextSibling { get; init; }
    public required PatchPropertyDelegate<TNode> PatchProperty { get; init; }

    public Func<string, TNode?>? QuerySelector { get; init; }
    public Func<TNode, TNode>? CloneNode { get; init; }
    public InsertStaticContentDelegate<TNode>? InsertStaticContent { get; init; }
}
```

- **`Insert` argument order** — it is `(child, parent, anchor)`, the upstream order. The browser
  bridge's own `insert` is `(parent, child, anchor)`, and `BrowserNodeOperations` swaps them. If you
  are wiring your own ops against an existing tree API, check this first.
- **`default(TNode)` means "no node"** — for a value-type `TNode` such as the browser's `int` handle,
  `default` is the reserved absent sentinel. Your platform must never issue it as a real node.
- **Only `InsertStaticContent` among the optional ops is consumed today** — `QuerySelector`,
  and `CloneNode` are declared but never called by the current renderer. Scoped CSS was removed on
  2026-09-14; no scope-stamping operation exists. Use
  [CSS Modules](../guide/scaling-up/sfc-css-features.md#css-modules) for component-specific classes.
  Mounting a `Static` vnode without `InsertStaticContent` throws
  `NotSupportedException` with an explicit contract message.

An inert `int`-handle renderer — the pattern for exercising the application surface with no browser
present:

```csharp
using Assimalign.Viu.RuntimeCore;

var renderer = RendererFactory.CreateRenderer(new RendererOptions<int>
{
    Insert = static (_, _, _) => { },
    Remove = static _ => { },
    CreateElement = static (_, _) => 1,
    CreateText = static _ => 1,
    CreateComment = static _ => 1,
    SetText = static (_, _) => { },
    SetElementText = static (_, _) => { },
    ParentNode = static _ => 0,
    NextSibling = static _ => 0,
    PatchProperty = static (_, _, _, _, _, _) => { },
});

var application = renderer.CreateApplication(new App());
```

### `RenderEffect<TNode>`

```csharp
public sealed class RenderEffect<TNode> : IDisposable
    where TNode : notnull
{
    public bool IsActive { get; }
    public void Stop();
    public void Unmount();
    public void Dispose();
}
```

A root-level reactive render binding, created by `Renderer<TNode>.CreateRenderEffect`. It mounts
immediately inside a tracked `ReactiveEffect`; a later mutation enqueues a `SchedulerJob` rather than
re-running synchronously.

- **`Stop()`** — detaches tracking and leaves the rendered tree in the container.
- **`Unmount()` / `Dispose()`** — also tear the tree down.
- **A throwing first render calls `Stop()` and then rethrows**, so a failed mount leaves no live
  subscriptions behind.

## The startup sequence

The single clearest explanation of how the pieces fit is the ordered path from page load to first
paint:

1. The browser loads `index.html`. The WebAssembly SDK has already rewritten the
   `<link rel="preload" id="webassembly">` and empty `<script type="importmap">` placeholders and
   fingerprinted `main#[.{fingerprint}].js`.
2. The module script runs `main.js`: `import { dotnet } from './_framework/dotnet.js'`, then
   `const { runMain } = await dotnet.create()`, then `await runMain()`.
3. `runMain` enters the managed top-level statements in `Program.cs`.
4. `await BrowserRuntime.InitializeAsync()` caches a `Task` in a static field and runs the real
   initialization.
5. Initialization calls `JSHost.ImportAsync("Assimalign.Viu.RuntimeDom",
   "/_content/Assimalign.Viu.RuntimeDom/viu-dom.js", ct)` — the module **name** doubles as the
   `[JSImport]` module key.
6. It then invokes the JS `initialize()` export, which awaits the dotnet runtime, resolves the
   assembly exports, and binds
   `exports.Assimalign.Viu.RuntimeDom.BrowserEventDispatch.DispatchBrowserEvent`. **Until this
   resolves, the JS listener's null check silently swallows events.**
7. `BrowserRuntime.CreateApp(root)` verifies initialization, then builds `RendererOptions<int>` from
   the browser node operations — whose static constructor fires here, installing the ambient
   directive and transition operations — and wraps the resulting `Application<int>` in a
   `BrowserApplication`.
8. `.Mount("#app")` calls `QuerySelector`, which reaches `document.querySelector` and registers the
   result, returning a handle. **Handle 0 is never a valid node.**
9. `Mount(int)` sees the app is not yet mounted, folds the foreign container handle into the buffered
   allocator (a no-op in direct mode), and clears the container — destroying any existing markup and
   releasing its child handles.
10. The wrapped `Application<int>.Mount(containerHandle)` renders the tree through the node
    operations, and `await Task.Delay(Timeout.Infinite)` keeps the WASM main loop alive because
    rendering is reactive from here.

### Initialization traps

- **`InitializeAsync` caches failure permanently** — a faulted task is returned by every later call.
- **Calling is not awaiting** — `CreateApp`, `CreateRenderer`, `QuerySelector`, and
  `GetRegistryDiagnostics` all throw `InvalidOperationException("BrowserRuntime.InitializeAsync()
  must complete before using the DOM bridge.")` unless the cached task completed successfully.
- **Handle 0 is the reserved no-node sentinel** — JS handles start at 1. Never fabricate one.
- **The first `Mount` always clears the container** — which is why hydration is impossible today.
- **The JS side resolves exports by literal string** — renaming the assembly or namespace, or
  trimming away `BrowserEventDispatch`, breaks all event dispatch at startup with **no compile-time
  error**. See [AOT & Trimming](../guide/best-practices/aot-and-trimming.md).
- **Consumers need `[assembly: SupportedOSPlatform("browser")]`** or every `BrowserRuntime` and
  `BrowserApplication` call raises CA1416. Projects on the Viu SDK get it emitted automatically
  unless `ViuImplicitBrowserPlatform=false` — see the
  [MSBuild Reference](msbuild-reference.md).

## `Scheduler`

The batched job scheduler that turns reactive writes into a single coalesced update pass. It lives in
`Assimalign.Viu.RuntimeCore` and is entirely static — and, like everything else here, not thread-safe.

```csharp
public static class Scheduler
{
    public static bool IsFlushing { get; }
    public static bool IsFlushPending { get; }
    public static void QueueJob(SchedulerJob job);
    public static void QueuePostFlushCallback(SchedulerJob callback);
    public static Task NextTick();
    public static void FlushPreFlushCallbacks();
    public static void FlushPostFlushCallbacks();
}
```

Jobs queued within one synchronous turn coalesce into a single flush posted to the current
`SynchronizationContext` — falling back to the thread pool when there is none, which on
single-threaded browser WebAssembly still dispatches on the main thread.

`NextTick()` is the counterpart to [`nextTick`](https://vuejs.org/api/general.html#nexttick). It
returns the current flush's completion `Task`, and **returns `Task.CompletedTask` when nothing is
queued — so awaiting it does not yield.** It resolves only after post-flush callbacks and any work
those callbacks themselves queued have all drained.

```csharp
count.Value++;
await Scheduler.NextTick();
// The DOM now reflects the new count; Mounted/Updated hooks have run.
```

Two behaviors worth knowing before you debug a flush:

- **A throwing job clears the queue, resolves `NextTick` so awaiters do not hang, and rethrows.**
- **The recursion limit is 100 executions of one job per flush chain**, after which an
  `InvalidOperationException` is thrown — it names the job's `Name` and `Identifier` when they are
  set. That is the diagnostic for a watcher or render function that writes the state it reads.

### `SchedulerJob`

```csharp
public sealed class SchedulerJob
{
    public SchedulerJob(Action callback);
    public int? Identifier { get; init; }
    public string? Name { get; init; }
    public bool IsPreFlush { get; init; }
    public bool AllowRecurse { get; set; }
    public bool IsDisposed { get; set; }
}
```

`Identifier` is a component uid, which is what makes parents update before their children. The
ordering rule has an exception that is easy to state wrongly:

| Job shape | Sort position |
| --- | --- |
| Render job with an `Identifier` | By uid, ascending — parents before children. |
| Render job with a null `Identifier` | **Last.** |
| Pre-flush job with a null `Identifier` | **First.** |
| Equal-id post-flush callbacks | Stable insertion order — this is what makes `OnMounted` fire child-before-parent. |

`IsPreFlush` is init-only; `AllowRecurse` and `IsDisposed` remain settable after construction.

## Not yet implemented

The following Vue application APIs have no counterpart in Viu, and none of them is a naming
difference — they are genuinely absent from the codebase.

| Vue API | Status in Viu |
| --- | --- |
| `createSSRApp` / `hydrate` | **Absent.** No hydration entry point exists, and `Mount` unconditionally clears its container. |
| `app.mixin` | **Absent**, and permanently so — Viu has no Options API. Use [Composables](../guide/reusability/composables.md). |
| `app.version` | **Absent.** |
| `app.runWithContext` | **Absent.** |
| `app.onUnmount` cleanup callbacks | **Absent.** Use `Lifecycle.OnUnmounted` inside a component. |
| `app.config.globalProperties` | **Deliberately excluded** — it requires a `Proxy`, which AOT forbids. Use app-level `Provide` plus `Inject`. |
| `app.config.performance` | Property exists and is settable, but **inert**. |
| `app.config.compilerOptions` | **Absent** — there is no runtime compiler. Templates compile at build time only. |
| Devtools integration | **Absent.** No hooks, no devtools surface anywhere. |

Also absent from the surrounding runtime: functional components, `defineAsyncComponent`, and the
`Teleport`, `KeepAlive`, and `Suspense` built-ins, which exist only as marker objects that throw
`NotSupportedException` when rendered — see
[KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md).

## See also

- [Component API](component.md) — `IComponentDefinition`, `ComponentInstance`, and the setup contract.
- [Render Functions & VirtualNode](render-function.md) — building the tree an application mounts.
- [Provide / Inject](../guide/components/provide-inject.md) — the full injection lookup chain.
- [Quick Start](../guide/quick-start.md) — the project, `index.html`, and `main.js` around this API.
- [Differences from Vue 3](../roadmap/vue-differences.md) — the naming map and behavioral divergences.
- [Project Status](../roadmap/status.md) — what is built, partial, marker-only, and absent.
