# API Reference

Lookup reference for Viu's public types, organized by the assembly that ships them.

> **Status:** Partial. See [Project Status](../roadmap/status.md) for area-by-area coverage.

These pages are for looking something up once you know it exists. The [Guide](../guide/index.md) is the
teaching path — it introduces each concept in order and explains why the API is shaped the way it is.
If you are coming from Vue, read [Differences from Vue 3](../roadmap/vue-differences.md) first: Viu's
public names are PascalCase, whole-word renames of Vue's camelCase functions, and a handful of
behaviors diverge deliberately.

## Pages by assembly

Viu ships as a set of small assemblies with a flat namespace each — the namespace is always identical
to the assembly name, regardless of which physical folder a file lives in. Knowing which assembly a
type comes from tells you which page documents it.

### `Assimalign.Viu.Reactivity`

The port of [`@vue/reactivity`](https://vuejs.org/api/reactivity-core.html). Depends on nothing else in
the framework and can be used standalone.

| Page | Covers |
| --- | --- |
| [Reactivity API: Core](reactivity-core.md) | `Reactive.Reference<T>`, `Reactive.ShallowReference<T>`, `Reactive.CustomReference<T>`, `Reactive.Computed<T>`, `Reactive.Effect`, `Reactive.EffectScope`, and all seven `Watch`/`WatchEffect` overloads |
| [Reactivity API: Utilities & Advanced](reactivity-utilities.md) | `Reactive.IsRef`, `IsReactive`, `IsReadonly`, `Unref`, `ToRef`, `ToRaw`, `MarkRaw`, `TriggerReference`, `StartBatch`/`EndBatch`, plus `Dependency`, `Subscriber`, `ReactiveTraversal`, and the `[Reactive]` source generator |
| [Reactive Collections](reactive-collections.md) | `ReactiveList<T>`, `ReactiveDictionary<TKey, TValue>`, `ReactiveSet<T>` and their exact trigger granularity |

### `Assimalign.Viu.RuntimeCore`

The port of [`@vue/runtime-core`](https://vuejs.org/api/composition-api-setup.html) — the virtual DOM,
the component model, the scheduler, and the platform-agnostic `Renderer<TNode>`.

| Page | Covers |
| --- | --- |
| [Component API](component.md) | `IComponentDefinition`, `ComponentPropertyDefinition`, `ComponentEmitDefinition`, `ComponentProperties`, `ComponentAttributes`, `ComponentSetupContext`, `ComponentSlots`, `ComponentInstance`, `Lifecycle` |
| [Application API](application.md) | `BrowserRuntime`, `BrowserApplication`, `Application<TNode>`, `ApplicationConfiguration`, `IPlugin<TNode>`, `RendererFactory`, `Renderer<TNode>`, `RendererOptions<TNode>`, `Scheduler` |
| [Render Functions & VirtualNode](render-function.md) | `VirtualNodeFactory`, `VirtualNode`, `VirtualNodeProperties`, `PatchFlags`, `ShapeFlags`, and the `RenderHelpers` compiler contract |

### `Assimalign.Viu.RuntimeDom`

The port of [`@vue/runtime-dom`](https://vuejs.org/api/application.html#createapp) — the browser
bridge, `patchProp`, the invoker-pattern event registry, and the DOM built-in directives. It has no
page of its own because its surface splits cleanly:

- **`BrowserRuntime` and `BrowserApplication`** — documented in [Application API](application.md),
  since they are what an app author actually calls to bootstrap.
- **`DomRenderHelpers`, `_vShow`, and the five `_vModel*` directives** — documented in
  [Built-in Directives](built-in-directives.md).
- **`CssVariables`** — documented in
  [SFC CSS Features](../guide/scaling-up/sfc-css-features.md).

### The Syntax cluster

The build-time compiler libraries target `netstandard2.0` because they load into Roslyn:
`Assimalign.Viu.Syntax` plus its five language libraries — `Assimalign.Viu.Syntax.Css`, `.Html`,
`.JavaScript`, `.SingleFileComponent`, and `.Templates` — and `Assimalign.Viu.Tooling.Css`, the
shared style-compilation core the generator and the `ViuBundleCss` MSBuild task both call. You never
reference any of them directly — the SDK wires them in as analyzers. What you observe from them is
the template language and the diagnostics they emit.

| Page | Covers |
| --- | --- |
| [Built-in Directives](built-in-directives.md) | Every `v-*` directive, its shorthand, its compile target, and its status |
| [Compiler Diagnostics](diagnostics.md) | The `VIU*` and `VUER*` diagnostic IDs, the `.viu` parse error codes, the CSS error codes, and the template compiler catalog |

### The SDK

| Page | Covers |
| --- | --- |
| [MSBuild Reference](msbuild-reference.md) | Every `Viu*` MSBuild property, item, and target a consumer can set or observe |

### Assemblies with no page of their own

- **`Assimalign.Viu.Shared`** — the flag enums (`PatchFlags`, `ShapeFlags`, `SlotFlags`) and the
  normalization helpers are documented where you meet them, in
  [Render Functions & VirtualNode](render-function.md) and
  [Template Syntax](../guide/essentials/template-syntax.md).
- **`Assimalign.Viu.Testing`** — the in-memory `TestRenderer` and the `ViuTest.Mount` wrappers are
  documented as a workflow in [Testing](../guide/scaling-up/testing.md) rather than as a type list.
- **`Assimalign.Viu.Tooling.Css`** — a build-time implementation detail shared by the `.viu` generator
  and the `ViuBundleCss` MSBuild task; what it produces is documented in
  [SFC CSS Features](../guide/scaling-up/sfc-css-features.md).

## What the assemblies look like together

Three assemblies cooperate in every Viu app: `Assimalign.Viu.Reactivity` holds the state,
`Assimalign.Viu.RuntimeCore` defines the component and builds the virtual nodes, and
`Assimalign.Viu.RuntimeDom` puts them on the page. A hand-written component touches all three.

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

public sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties =>
    [
        new ComponentPropertyDefinition("start") { DefaultValue = 0 }
    ];

    public IReadOnlyList<ComponentEmitDefinition>? Emits =>
    [
        new ComponentEmitDefinition("change")
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        // State lives in refs the returned closure captures. There is no `this`.
        var count = Reactive.Reference(properties.Get<int>("start"));
        var label = Reactive.Computed(() => $"Clicked {count.Value} times");

        Lifecycle.OnMounted(() => Console.WriteLine("Counter mounted."));

        void Increment()
        {
            count.Value++;
            context.Emit("change", count.Value);
        }

        // Setup runs once and RETURNS the render function.
        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(("onClick", (Action)Increment)),
            label.Value);
    }
}
```

Two details in that snippet are load-bearing and recur across every reference page. `Setup` returns
`Func<VirtualNode?>` rather than exposing a `Render` member, because there is no `this`-proxy to hang
state on — see [Components](../guide/essentials/components.md). And the click handler is cast
explicitly to `Action` because DOM event handlers must be `Action` or `Action<BrowserEvent>` — the
event registry dispatches by pattern-matching those two shapes and never reflects. Any other
delegate shape compiles fine (the prop value is `object?`) but throws `NotSupportedException` when
the event fires; the throw is caught and routed to the runtime's error sink rather than escaping
into the JavaScript listener, so a wrong delegate shape shows up as a reported error at first
click, not at build time.

Mounting it is the browser assembly's job:

```csharp
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

using MyApp;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new Counter())
    .Mount("#app");

await Task.Delay(Timeout.Infinite);
```

The same component authored as a [single-file component](../guide/scaling-up/single-file-components.md)
is written differently, because the `@script` block is a **partial-class body**, not a setup body —
state is declared as fields and properties, not as locals:

```viu
@template {
    <button @click="Increment()">Clicked {{ Count }} times</button>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count = Reactive.Reference(0);

    public void Increment() => Count.Value++;
}
```

Note the container: `.viu` blocks are `@template { … }` and `@script { … }`, not `<template>` and
`<script>` tags, and column 0 is structural. See
[Single-File Components (.viu)](../guide/scaling-up/single-file-components.md) for the full format.

> **Not yet implemented:** that `.viu` file does not currently produce a runnable component. The
> generator emits a `partial class` named for the file, carrying
> `internal static object? Render(<ClassName> _ctx, object?[] _cache)` and
> `internal const int RenderCacheSize`, and merges the `@script` members into the same class under
> a `#line` map — but nothing wires that `Render` into `IComponentDefinition.Setup`, so a `.viu`
> component cannot be mounted yet. The hand-written `Setup`-returns-a-closure form above is the only
> path that runs today. See
> [Single-File Components (.viu)](../guide/scaling-up/single-file-components.md#not-yet-implemented)
> and [Project Status](../roadmap/status.md).

## Naming conventions

Every signature on every reference page follows the same two rules. Knowing them lets you guess a
member name correctly most of the time.

### Abbreviations are spelled out

The rule applies to types, members, parameters, and locals alike.

| Abbreviated | Viu spelling | Where you see it |
| --- | --- | --- |
| `Ref` | `Reference` | `Reactive.Reference<T>`, `IReference<T>`, `ShallowReference<T>` |
| `Dep` | `Dependency` | `Dependency.Track()`, `IReactiveObject.GetDependency(string)` |
| `Sub` | `Subscriber` | `Subscriber`, the base class of `ReactiveEffect` and `Computed<T>` |
| `Ops` | `Operations` | `TestNodeOperationLog` |
| `Prev` | `Previous` | the `previousNode` parameter of `DirectiveHook` |
| `Prop` / `Props` | `Property` / `Properties` | `ComponentProperties`, `VirtualNodeProperties`, `ComponentPropertyDefinition` |

The same instinct governs the renames of Vue's own vocabulary, which is why a Vue developer's muscle
memory needs one substitution per name:

| Vue | Viu |
| --- | --- |
| `props` | `Properties` |
| `attrs` | `Attributes` (`ComponentSetupContext.Attributes`, `ComponentAttributes`) |
| `subTree` | `Subtree` (`ComponentInstance.Subtree`) |
| `vnode` | `VirtualNode` |
| `.value` | `.Value` |

[Differences from Vue 3](../roadmap/vue-differences.md) carries the complete map.

### Exactly seven acronyms stay acronyms

`DOM`, `HTML`, `CSS`, `SSR`, `AOT`, `JSON`, `WASM`. Nothing else is treated as an acronym. **`SFC` is
deliberately not on the list**, so identifiers spell out `SingleFileComponent` in full — hence
`Assimalign.Viu.Syntax.SingleFileComponent`, `SingleFileComponentErrorCode`, and the MSBuild property
`ViuBundleSingleFileComponentCss`. Prose may still write "single-file component (SFC)"; identifiers
may not.

### The `_`-prefixed helpers are a deliberate exception

`RenderHelpers` and `DomRenderHelpers` expose public members with a leading underscore —
`_createElementBlock`, `_renderList`, `_withModifiers`, `_vShow`, `_Fragment`, and the rest. These are
not a naming slip and not an app-facing API. They are the by-name contract that generated render
bodies bind to through `using static`, ported directly from Vue's own codegen identifiers, so their
spelling is fixed by upstream rather than by Viu's conventions. Write `VirtualNodeFactory.Element(…)`
in hand-written components; leave the underscore names to the compiler.

## Rules that apply on every page

These four cut across the whole API, so each reference page assumes them rather than repeating them.

| Rule | What it means for you |
| --- | --- |
| **`WatchOptions.Flush` defaults to `WatchFlushMode.Sync`** — Vue's [`watch`](https://vuejs.org/api/reactivity-core.html#watch) defaults to `pre` | Inside a component call `ViuWatch.Watch`, which injects the scheduler that makes `Pre`/`Post` work; standalone `Reactive.Watch` delivers synchronously |
| **Change detection is `EqualityComparer<T>.Default`**, not [`Object.is`](https://vuejs.org/api/reactivity-core.html#ref) | `NaN` is self-equal as in Vue, but `+0.0` and `-0.0` compare *equal*, which Vue's `Object.is` does not |
| **Nothing is thread-safe** | Ambient tracking state is plain static state, matching the single-threaded browser event loop. This is a design decision, not a gap |
| **No reflection, ever** | Props and emits are precomputed metadata rather than discovered attributes; handler delegates are restricted to specific shapes; there is no runtime template compilation. See [AOT & Trimming](../guide/best-practices/aot-and-trimming.md) |

## What has no API page, and why

Some Vue APIs a reader will search for have no Viu counterpart to document.

- **Router, Store, server rendering, and DevTools** — `Assimalign.Viu.Router`,
  `Assimalign.Viu.Store`, `Assimalign.Viu.ServerRenderer`, and `Assimalign.Viu.DevTools` do not exist
  on disk: no folder, no project, no source. They are roadmap items only. See
  [Project Status](../roadmap/status.md).
- **Teleport, KeepAlive, and Suspense** — `RenderHelpers._Teleport`, `._KeepAlive`, and `._Suspense`
  exist as marker objects, and rendering any of them throws `NotSupportedException`. They are covered
  honestly, with workarounds, in
  [KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md).
- **The Options API, mixins, and `app.config.globalProperties`** — deliberately omitted, because all
  three require a component instance proxy that C# under AOT cannot provide. Typed provide/inject is
  the sanctioned replacement; see [Provide / Inject](../guide/components/provide-inject.md).
- **A generated XML-doc API reference** — planned, but no generation pipeline exists yet. These pages
  are hand-written, so treat the source at
  [github.com/assimalign/viu](https://github.com/assimalign/viu) as authoritative if the two ever
  disagree.

New to Viu? Start with [Quick Start](../guide/quick-start.md), then read the
[stopwatch example](../examples/stopwatch.md) — the one shipping demo, and the best reference for the
hand-written render-function style shown above.
