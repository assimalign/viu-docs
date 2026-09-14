# Introduction

What Viu is, what it deliberately is not, and the architectural decisions that shape every API you
will meet in this guide.

> **Status:** Partial. The rendering stack, reactivity, template compiler, and `.viu` pipeline are
> implemented; Router, Store, SSR, and DevTools are not. See
> [Project status](../roadmap/status.md) for area-by-area coverage.

## What Viu is

Viu is a C#/.NET re-implementation of [Vue.js 3](https://vuejs.org) that runs in the browser on
WebAssembly. It is a **port, not an inspiration**. The reactivity engine, the virtual-node model,
the renderer, the scheduler, the component model, the template language, and the single-file
component format are all translated from the upstream `vuejs/core` sources, function by function,
with the upstream semantics treated as the specification.

Everything a Vue app does at runtime through `new Function` and JavaScript `Proxy`, Viu does at
build time through Roslyn source generators and statically-analyzable C#. There is no JavaScript
framework at runtime — the only JavaScript Viu ships is a small leaf-applier module that turns
opcodes into DOM calls.

| Viu library | Upstream counterpart | Status |
| --- | --- | --- |
| `Assimalign.Viu.Shared` | [`@vue/shared`](https://github.com/vuejs/core/tree/main/packages/shared) | Implemented |
| `Assimalign.Viu.Reactivity` | [`@vue/reactivity`](https://github.com/vuejs/core/tree/main/packages/reactivity) | Implemented |
| `Assimalign.Viu.RuntimeCore` | [`@vue/runtime-core`](https://github.com/vuejs/core/tree/main/packages/runtime-core) | Implemented |
| `Assimalign.Viu.RuntimeDom` | [`@vue/runtime-dom`](https://github.com/vuejs/core/tree/main/packages/runtime-dom) | Implemented |
| `Assimalign.Viu.Syntax.Templates` | `@vue/compiler-core` + `@vue/compiler-dom` | Implemented |
| `Assimalign.Viu.Syntax.SingleFileComponent` | `@vue/compiler-sfc` (container only) | Implemented |
| `Assimalign.Viu.Syntax` / `.Css` / `.Html` / `.JavaScript` | shared parser primitives, plus the CSS, HTML, and JS parsers the compilers sit on | Implemented |
| `Assimalign.Viu.Tooling.Css` | the ordinary component-style / CSS-modules compiler and style bundler shared by the generator and the build task | Implemented |
| `Assimalign.Viu.Testing` | `@vue/test-utils` + `@vue/runtime-test` | Implemented |
| `Assimalign.Viu.Sdk` | Vite + `@vitejs/plugin-vue` | Implemented |
| — | [`vue-router`](https://router.vuejs.org) | Not present |
| — | [`pinia`](https://pinia.vuejs.org) | Not present |
| — | `@vue/server-renderer` | Not present |
| — | vue-devtools | Not present |

Public names are PascalCase, whole-word renames of Vue's camelCase. Abbreviations are not used:
`Ref` is `Reference`, `Dep` is `Dependency`, `props` is `Properties`, `attrs` is `Attributes`.

| Vue 3 | Viu |
| --- | --- |
| [`ref()`](https://vuejs.org/api/reactivity-core.html#ref) | `Reactive.Reference<T>(value)`, returning `Reference<T>` |
| `.value` | `.Value` |
| [`computed()`](https://vuejs.org/api/reactivity-core.html#computed) | `Reactive.Computed<T>(getter)`, returning `Computed<T>` |
| [`reactive(obj)`](https://vuejs.org/api/reactivity-core.html#reactive) | the `[Reactive]` attribute plus a source generator |
| [`watch()`](https://vuejs.org/api/reactivity-core.html#watch) | `ViuWatch.Watch` in components, `Reactive.Watch` standalone |
| [`h()`](https://vuejs.org/api/render-function.html#h) | `VirtualNodeFactory.Element` / `.Component` / `.Fragment` |
| [`createApp()`](https://vuejs.org/api/application.html#createapp) | `BrowserRuntime.CreateApp` |
| [`provide()`](https://vuejs.org/api/composition-api-dependency-injection.html) / `inject()` | `DependencyInjection.Provide` / `Inject` |
| `props` / `attrs` | `ComponentProperties` / `ComponentAttributes` |

The full mapping lives in [Differences from Vue 3](../roadmap/vue-differences.md).

## A first look

A `.viu` single-file component, the intended authoring format:

```viu
@template {
    <button class="counter" type="button" @click="Increment()">
        Clicked {{ Count }} times
    </button>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count = new Reference<int>(0);

    public void Increment() => Count.Value++;
}

@style {
    .counter { font-variant-numeric: tabular-nums; }
}
```

And the whole browser bootstrap:

```csharp
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new Counter()).Mount("#app");

// Keep the WASM main loop alive; rendering is reactive from here.
await Task.Delay(Timeout.Infinite);
```

Two things in that first example are worth stating plainly before you build on them.

- **The `.viu` compiler is real; the runtime binding is not finished.** The generator compiles
  `@template` into an `internal static object? Render(Counter _ctx, object?[] _cache)` method,
  merges `@script` into the partial class under a `#line` map, and compiles `@style` into
  the `ExtractedStyles` constant. It does **not** emit an `IComponentDefinition`
  implementation, so today you supply the `Setup` bridge yourself in a sibling partial (shown
  below). See [Single-File Components](scaling-up/single-file-components.md).
- **No shipping example compiles a `.viu` file yet.** The compilation path is proven by generator
  tests that feed `.viu` source as strings and compile the output in-process. The one working
  demo, [the stopwatch](../examples/stopwatch.md), is written entirely with hand-authored
  `VirtualNodeFactory` calls.

The hand-written bridge, using only implemented APIs:

```csharp
using System;

using Assimalign.Viu.RuntimeCore;

// Illustrative: the generator does not emit this today, so you write it by hand.
public partial class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var cache = new object?[RenderCacheSize];
        return () => RenderHelpers.NormalizeRoot(Render(this, cache));
    }
}
```

## The five founding divergences

Every surprising thing in Viu's API traces back to one of five decisions. Each is forced by C# or
by WebAssembly, not chosen for taste.

### 1. C# has no `Proxy`, so reactivity is reference-first

Vue's `reactive()` returns a `Proxy` that intercepts every property access. C# has no equivalent,
and building one would require reflection, which AOT forbids. So Viu inverts the emphasis:
`Reference<T>` is the primary primitive, and object reactivity is compiled rather than intercepted.

```csharp
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(0);
var doubled = Reactive.Computed(() => count.Value * 2);

count.Value = 21;
// doubled.Value is 42 — the getter re-runs lazily on the next read.
```

For objects, you annotate a `partial class` and the `Assimalign.Viu.Reactivity.Generators`
incremental generator emits the per-property `Dependency` tracking:

```csharp
using Assimalign.Viu.Reactivity;

[Reactive]
public partial class TodoItem
{
    public partial string Title { get; set; }
    public partial bool Done { get; set; }
}
```

Vue's proxied `Array`, `Map`, and `Set` become the first-class `ReactiveList<T>`,
`ReactiveDictionary<TKey, TValue>`, and `ReactiveSet<T>`.

Two consequences follow that Vue developers will not expect. There is **no identity swap** — a
`[Reactive]` instance *is* the reactive object, so `Reactive.ToRaw(obj)` hands back the same
instance and reads through it still track. And deep traversal is reflection-free: it descends only
through `IReference` cells and `IReactiveTraversable` values, so a plain un-annotated CLR object is
a **leaf** and a deep watch never sees a mutation inside it. See
[Reactivity Fundamentals](essentials/reactivity-fundamentals.md).

### 2. WASM has no `new Function`, so there is no runtime template compilation

Vue can compile a template string in the browser. Viu cannot, and never will — dynamic code
generation is unavailable under WebAssembly and banned by the AOT constraint. **Build-time source
generators are the only path from a template to a render function.**

This is not a limitation with a workaround; it is the shape of the framework. It also removes a
class of upstream behavior: Vue evaluates constant interpolations with `new Function` to stringify
them at compile time, so Viu treats no interpolation or dynamic `v-bind` as constant. Only static
text, static attributes, and compiler-injected literals — `v-if` branch keys, `v-model` modifier
objects — reach the higher constant tiers.

The markup syntax inside `@template` is Vue's verbatim. What changes is the **expression body**,
which is C#, parsed and validated with Roslyn's `SyntaxFactory.ParseExpression`:

```viu
@template {
    <p>{{ Items.Where(x => x.Active).Count() }} active</p>
    <input :value="Name" @input="OnInput($event)" />
}
```

There are no template literals, no spread, no `undefined`, no `typeof`, and no `JSON`, `Date`, or
`parseInt` — the global allow-list names .NET types (`Math`, `Convert`, `String`, `DateTime`,
`TimeSpan`, `Guid`, `Uri`, `Enumerable`, `CultureInfo`, the numeric types, and similar). Vue's
`$`-prefixed spellings are still what you write; the compiler substitutes them for legal C#
identifiers. See [Template Syntax](essentials/template-syntax.md).

### 3. No `this`-proxy, so `Setup` returns the render function

Vue's Options API and its `this` binding both depend on a component instance proxy. Viu has none.
`IComponentDefinition.Setup` runs **exactly once per instance** and *returns* the render function;
the closure it returns is the proxy-free realization of Vue's state object.

```csharp
public interface IComponentDefinition
{
    string? Name => null;
    IReadOnlyList<ComponentPropertyDefinition>? Properties => null;
    IReadOnlyList<ComponentEmitDefinition>? Emits => null;
    bool InheritAttributes => true;

    Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context);
}
```

A complete component, adapted from the working stopwatch demo:

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.RuntimeCore;

internal sealed class ElapsedDisplay : IComponentDefinition
{
    public string? Name => "ElapsedDisplay";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
    [
        new ComponentPropertyDefinition("text") { DefaultValue = "00:00:00" },
        new ComponentPropertyDefinition("running") { DefaultValue = false },
    ];

    public IReadOnlyList<ComponentEmitDefinition>? Emits { get; } =
    [
        new ComponentEmitDefinition("reset"),
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", "meter")),
            VirtualNodeFactory.Element(
                "strong",
                VirtualNodeFactory.Text(properties.Get<string>("text") ?? "00:00:00")),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(
                    ("type", "button"),
                    ("onClick", (Action)(() => context.Emit("reset")))),
                VirtualNodeFactory.Text("Reset")));
}
```

Because there is no proxy, several Vue features are **deliberately absent and will not be added**:
the Options API, mixins, and `app.config.globalProperties`. Cross-cutting state goes through typed
[provide / inject](components/provide-inject.md) instead, and reusable logic goes through
[composables](reusability/composables.md). Note also that props and emits are **precomputed
metadata** rather than attributes discovered by reflection — that is the AOT constraint showing
through the component contract. See [Components](essentials/components.md).

### 4. `.viu` uses an `@`-block container

A `.viu` file is Viu's `.vue`, with one deliberate container change decided on 2026-07-17: blocks
are wrapped in `@name { … }` rather than HTML-like `<template>` / `<script>` / `<style>` tags. Block
options preserve CSS Modules (`module` and `module="name"`) and `lang`. Scoped CSS was removed
on 2026-09-14; use ordinary component styles or CSS Modules.

The parser is line-oriented and **column 0 is structural**: at the top level a line whose first
character is `@` opens a block, and inside a block a line whose first character is `}` closes it.
Nothing else is inspected, which is why braces inside C#, CSS, or markup never terminate a block —
and why **block content must be indented**. A CSS rule written flush-left will close its block
early.

```viu
@style {
    .box .inner { color: red; }
}
```

The block compiles as ordinary global CSS. Viu does not rewrite its selectors or stamp component
scope attributes. CSS Modules provide deterministic component-specific class names. See
[Single-File Components](scaling-up/single-file-components.md) and
[SFC CSS Features](scaling-up/sfc-css-features.md).

### 5. The interop boundary is the performance budget

Every crossing between .NET and JavaScript costs more than the work on either side, so the whole
browser layer is designed to minimize crossings.

- **Nodes cross as `int` handles** — never as `JSObject` proxies. `0` is the reserved "no node"
  sentinel and real handles start at 1. This is a measured decision recorded in the RuntimeDom
  ADR.
- **All decision logic runs .NET-side** — the class/style normalization, the property-versus-
  attribute tree, `v-model` and `v-show` semantics. The JavaScript module is a dumb leaf applier so
  every operation stays expressible as a single opcode.
- **Patches can batch into a command buffer** — opt in with
  `BrowserRuntime.CreateApp(root, properties, useCommandBuffer: true)` and a whole flush becomes one
  binary frame and one `apply` call. It is behaviorally invisible: buffered and direct produce
  byte-identical DOM.
- **Events funnel through one delegated dispatcher** — exactly one JS listener per
  `(element, eventName, capture)` triple, and every live event reaches .NET through the single
  `[JSExport]` entry point `BrowserEventDispatch.DispatchBrowserEvent`. Re-rendered handlers are
  pure .NET delegate swaps costing zero interop.

The event payload that crosses is a flat snapshot, `BrowserEvent`, not a live wrapper — which is
why `StopPropagation()` and `PreventDefault()` are **deferred intents**: they set flags returned as
a bitmask that the JS listener applies after the synchronous dispatch. Calling them from an async
continuation is too late. See [Event Handling](essentials/event-handling.md).

## Two hard constraints

### AOT and trimming safety

Shipping libraries set `<IsAotCompatible>true</IsAotCompatible>`, and the rule behind it is
absolute: **no reflection, no dynamic code generation, no assembly scanning.** This is not a
preference that bends for convenience; it is the reason the API looks the way it does.

| Vue does this at runtime | Viu does this instead | Because |
| --- | --- | --- |
| `reactive(obj)` proxies an object | `[Reactive]` + a Roslyn generator | no `Proxy`, no reflection |
| compiles templates in the browser | compiles them at build time | `new Function` is unavailable |
| discovers props from an options object | precomputed `IReadOnlyList<ComponentPropertyDefinition>` | no reflection over members |
| `toRef(obj, "key")` by string key | `Reactive.ToRef(getter, setter)` by delegate | string keys are not trim-safe |
| resolves plugins and components dynamically | explicit registration on the app | no assembly scanning |

See [AOT & Trimming](best-practices/aot-and-trimming.md).

### One thread, one event loop

Viu targets the browser's single-threaded JavaScript event-loop model, and **nothing in Viu is
thread-safe — by design.** The reactivity engine's tracking state, the batch depth, the scheduler
queues, `ComponentInstance.Current`, `EffectScope.Current`, and the browser runtime's handle and
listener registries are all plain ambient statics with no synchronization.

This is what makes the hot paths cheap, and it is sanctioned rather than accidental. The practical
rule: do not touch reactive state, the renderer, or the scheduler from a background thread or a
continuation that may resume on one. `await` inside a component is fine on the browser's single
thread; introducing real parallelism is not supported.

## What does not exist yet

Documentation here describes an intended end-state developer experience, and anything not built is
labelled inline. The absences worth knowing before you start:

- **Router, Store, ServerRenderer, and DevTools** — absent from disk entirely. No project, no
  source, no references anywhere in the tree. There is no `Assimalign.Viu.Router` to install and no
  SSR or hydration path of any kind; `Mount` clears its container before the first render and there
  is no hydrating variant, so server-rendered markup cannot be adopted.
- **`Teleport`, `KeepAlive`, and `Suspense`** — marker objects only. Rendering any of them throws
  `NotSupportedException`. Surrounding scaffolding exists but is inert: the `ShapeFlags` bits are
  declared and never set, and `Lifecycle.OnActivated` / `OnDeactivated` store hooks that nothing
  invokes. See [KeepAlive, Teleport & Suspense](built-ins/deferred-built-ins.md) for the
  workarounds available today.
- **Async components** — there is no `defineAsyncComponent` equivalent.
- **`dotnet new` templates and a public NuGet feed** — neither exists. Consumer projects are
  hand-authored against `<Project Sdk="Assimalign.Viu.Sdk">`, and the only distribution today is a
  repo-local package feed.
- **Editor tooling and hot reload** — no language server, no TextMate grammar, no hot-reload
  metadata.

`Transition` and `TransitionGroup` **are** implemented — the two DOM built-in components Viu ships.
Both render over `BaseTransition` in `Assimalign.Viu.RuntimeCore`, which is public and usable on its
own as the platform-agnostic, CSS-free state machine; `<component :is>` also resolves, through
`DynamicComponents`. See [Transition & TransitionGroup](built-ins/transition.md),
[Dynamic Components](components/dynamic-components.md), and
[Project status](../roadmap/status.md) for the complete accounting.

## Where to go next

- **[Quick Start](quick-start.md)** — get a Viu app running in the browser, file by file.
- **[Essentials](essentials/index.md)** — the nine chapters that cover building a real component,
  meant to be read in order.
- **[Differences from Vue 3](../roadmap/vue-differences.md)** — start here if you already know Vue;
  it is the naming map plus the behavioral divergences that will otherwise bite you.
- **[API Reference](../api/index.md)** — exact signatures for every public type.
