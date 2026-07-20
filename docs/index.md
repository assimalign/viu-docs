# Viu

Viu is a C#/.NET re-implementation of Vue.js 3 that runs in the browser on WebAssembly.

> **Status:** Partial. The rendering stack, reactivity, and the template/`.viu` compiler are
> implemented, but the class the `.viu` generator emits is not yet mountable, scoped CSS and
> `v-bind()` in CSS stop at the compiler, and Router, Store, SSR, and DevTools do not exist. See
> [Project status](roadmap/status.md).

Viu ports Vue 3.5 to C# rather than taking inspiration from it. The reactivity engine is a port of
[`@vue/reactivity`](https://vuejs.org/guide/extras/reactivity-in-depth.html) — the same
dependency/subscriber link graph, the same version counters, the same global-version fast path. The
renderer is a port of `@vue/runtime-core`, including block trees, `PatchFlags`, and a true
longest-increasing-subsequence keyed diff. The template language is Vue's, compiled by a port of
`@vue/compiler-core` and `@vue/compiler-dom`. What changes is the host: there is no JavaScript
`Proxy`, no `new Function`, and no `this`-proxy, so reactivity is reference-first, templates are
compiled ahead of time by Roslyn source generators, and `Setup` returns a render closure instead of
exposing a magic `this`. At runtime there is no JavaScript framework — only your compiled .NET code
and a thin DOM bridge.

## A component, end to end

A `.viu` file is Viu's counterpart to a [Vue SFC](https://vuejs.org/guide/scaling-up/sfc.html), with
one deliberate divergence: blocks use an `@`-block container rather than HTML-like tags. Block
*semantics* follow the Vue SFC spec unchanged.

```viu
@template {
    <div class="counter">
        <p>Count is {{ count }}</p>
        <button @click="count++">Increment</button>
    </div>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> count = Reactive.Reference(0);
}

@style scoped {
    .counter button { font-weight: 600; }
}
```

Expressions inside `{{ }}` and directive values are **C#, not JavaScript** — they are parsed with
Roslyn. The compiler classifies `count` as a reference binding and inserts the `.Value` access for
you in both read and write positions, so `{{ count }}` emits `_toDisplayString(_ctx.count.Value)` and
`@click="count++"` emits `__event => (_ctx.count.Value++)`.

Three rules govern the container, and every one of them is enforced by column position:

- **Column 0 is structural** — at the top level a line starting with `@` opens a block; inside a
  block a line starting with `}` closes it. Nothing else is inspected.
- **Block bodies must be indented** — a `}` written flush-left inside CSS or C# will close the block
  early. This is documented behavior, not a bug.
- **Option values must be double-quoted** — `lang="scss"`, never `lang=scss`.

The application bootstrap is three lines:

```csharp
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

using MyApp; // the Counter component defined below

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new Counter()).Mount("#app");

// Keep the WASM main loop alive; rendering is reactive from here.
await Task.Delay(Timeout.Infinite);
```

`BrowserRuntime.InitializeAsync` loads the DOM bridge module and **must be awaited** before anything
else — merely calling it is not enough, and `CreateApp` throws `InvalidOperationException` if the
bridge is not ready. `BrowserApplication` is the counterpart to Vue's
[`createApp()`](https://vuejs.org/api/application.html#createapp) and chains the same way:
`.Component(name, definition)`, `.Directive(name, directive)`, `.Provide(key, value)`, `.Use(plugin)`.

### The hand-written equivalent

`IComponentDefinition` is the runtime component contract, and it is the path the shipping demo uses
today — the `.viu` generator does not yet emit it (see [What does not exist yet](#what-does-not-exist-yet)).
`Setup` runs **once** per instance and *returns* the render function — the returned closure is the
proxy-free realization of Vue's state object.

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

public sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var count = Reactive.Reference(0);

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", "counter")),
            VirtualNodeFactory.Element("p", $"Count is {count.Value}"),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", (Action)(() => count.Value++))),
                "Increment"));
    }
}
```

There is no Options API, no `data`/`methods`/`computed` block, and no mixins — the composition model
is the only model. Note the whole-word naming rule that runs through every signature:
`Reactive.Reference<T>` for Vue's [`ref()`](https://vuejs.org/api/reactivity-core.html#ref), `.Value`
for `.value`, `ComponentProperties` for `props`, `ComponentAttributes` for `attrs`.

## What works today

| Area | State |
| --- | --- |
| Reactivity — `Reference<T>`, `Computed<T>`, `EffectScope`, `Watch` | Implemented |
| `[Reactive]` source generator and `ReactiveList<T>`/`ReactiveDictionary<TKey,TValue>`/`ReactiveSet<T>` | Implemented |
| `VirtualNode`, `Renderer<TNode>`, scheduler, LIS keyed diff | Implemented |
| Component model — props, emits, slots, provide/inject, lifecycle | Implemented |
| Browser DOM bridge, delegated events, `v-show` | Implemented |
| `v-model` runtime directives | Implemented (the *template-compiled* form does not round-trip yet — hand-written works) |
| Template compiler and `.viu` source generator | Implemented (emitted class is not yet mountable) |
| CSS Modules | Implemented |
| Scoped CSS and `v-bind()` in CSS | Compile-time only — the runtime never stamps `data-v-<hash>` and never calls `ApplyCssVariables()`, so neither takes effect in the browser yet |
| `Transition` and `TransitionGroup` | Implemented |
| In-memory test renderer (`ViuTest`) | Implemented |
| MSBuild SDK and shared-framework packaging | Implemented |

## What does not exist yet

Documentation is worthless if it describes a framework that isn't there, so this site marks every gap
inline. The load-bearing absences:

- **Router, Store, ServerRenderer, and DevTools** — absent from disk entirely. No project, no source,
  no solution entry. Nothing about routing, state stores, SSR, or hydration works today.
- **`KeepAlive`, `Teleport`, and `Suspense`** — marker objects only. Rendering any of them throws
  `NotSupportedException`. See [KeepAlive, Teleport & Suspense](guide/built-ins/deferred-built-ins.md)
  for the workarounds available now.
- **`.viu`-to-runtime wiring** — the generator compiles a `.viu` file into a partial class carrying a
  `Render` method, `ScopeId`, and `ExtractedStyles`, and this is proven by the generator and
  compiled-render test suites. The glue that makes that class a mountable `IComponentDefinition` has
  not landed, and no shipping example project compiles a `.viu` file. The `.viu` examples across this
  site describe the intended authoring experience; the hand-written `IComponentDefinition` path is
  what runs end to end today.
- **Scoped CSS and `v-bind()` in CSS stop at the compiler** — selectors are rewritten and bundled
  correctly, but `RendererOptions<TNode>.SetScopeId` is never invoked (so no element carries
  `data-v-<hash>` and scoped rules match nothing) and the generated `ApplyCssVariables()` is never
  called (so `v-bind()` custom properties are never applied). CSS Modules is the one style feature
  that works end to end. See [SFC CSS Features](guide/scaling-up/sfc-css-features.md).
- **Template-compiled `v-model` and inline `v-on` handlers do not complete the round trip** — both
  compile, and both have a working hand-written equivalent, but the last hop between the emitted
  delegate shape and the runtime is unwired. See
  [Built-in Directives](api/built-in-directives.md).
- **No `dotnet new` template and no public NuGet feed** — projects are hand-authored and packages
  come from a repo-local feed. See [Quick Start](guide/quick-start.md).
- **No runtime template compilation, ever** — WASM has no `new Function`, so build-time source
  generation is the only path. This is a design decision, not a gap.

The full wave-by-wave breakdown lives in [Project status](roadmap/status.md).

## Guide

**Getting started**

- [Guide](guide/index.md) — how to read this documentation, and where each audience should start.
- [Introduction](guide/introduction.md) — what Viu is, what it is not, and the five founding
  divergences from Vue.
- [Quick Start](guide/quick-start.md) — from nothing to a running app in the browser.

**Essentials**

- [Essentials](guide/essentials/index.md) — section overview and reading order.
- [Components](guide/essentials/components.md) — `IComponentDefinition`, `Setup`, and the render
  closure.
- [Reactivity Fundamentals](guide/essentials/reactivity-fundamentals.md) — references and the
  `[Reactive]` source generator.
- [Computed Properties](guide/essentials/computed.md) — `Reactive.Computed<T>`, caching, and
  ownership.
- [Template Syntax](guide/essentials/template-syntax.md) — interpolation, bindings, and C#
  expressions.
- [Conditional & List Rendering](guide/essentials/conditional-and-list.md) — `v-if`, `v-for`, and
  keying.
- [Event Handling](guide/essentials/event-handling.md) — `v-on`, modifiers, and `BrowserEvent`.
- [Form Input Bindings](guide/essentials/form-bindings.md) — `v-model` across every input type.
- [Watchers](guide/essentials/watchers.md) — `ViuWatch` versus `Reactive.Watch`, and the flush-mode
  divergence.
- [Lifecycle Hooks & Template Refs](guide/essentials/lifecycle-and-template-refs.md) — hook
  registration and reaching rendered nodes.

**Components in depth**

- [Components In-Depth](guide/components/index.md) — section overview.
- [Props & Fallthrough Attributes](guide/components/props.md)
- [Component Events](guide/components/events.md)
- [Component v-model](guide/components/v-model.md)
- [Slots](guide/components/slots.md)
- [Provide / Inject](guide/components/provide-inject.md)
- [Dynamic Components & Registration](guide/components/dynamic-components.md)

**Reusability**

- [Composables](guide/reusability/composables.md) — factoring stateful logic; Viu's replacement for
  mixins.
- [Custom Directives](guide/reusability/custom-directives.md) — `IDirective` and its seven hooks.

**Built-ins**

- [Transition & TransitionGroup](guide/built-ins/transition.md) — the two implemented built-in
  components.
- [KeepAlive, Teleport & Suspense](guide/built-ins/deferred-built-ins.md) — **not yet implemented**;
  what exists and what to do instead.

**Scaling up**

- [Single-File Components (.viu)](guide/scaling-up/single-file-components.md) — the `@`-block format
  in full.
- [SFC CSS Features](guide/scaling-up/sfc-css-features.md) — scoped styles, CSS Modules, and
  `v-bind()`.
- [The Viu SDK & Build](guide/scaling-up/sdk-and-build.md) — `Assimalign.Viu.Sdk` and the MSBuild
  pipeline.
- [Testing](guide/scaling-up/testing.md) — the DOM-free in-memory renderer.

**Best practices**

- [AOT & Trimming](guide/best-practices/aot-and-trimming.md) — why reflection is forbidden and what
  that shapes.
- [Performance](guide/best-practices/performance.md) — the interop boundary as the budget.

## API Reference

- [API Reference](api/index.md) — index of every documented type.
- [Reactivity API: Core](api/reactivity-core.md)
- [Reactivity API: Utilities & Advanced](api/reactivity-utilities.md)
- [Reactive Collections](api/reactive-collections.md)
- [Component API](api/component.md)
- [Application API](api/application.md)
- [Render Functions & VirtualNode](api/render-function.md)
- [Built-in Directives](api/built-in-directives.md)
- [MSBuild Reference](api/msbuild-reference.md)
- [Compiler Diagnostics](api/diagnostics.md) — the `VIU####` and `VUER####` catalogs.

## Examples

- [Examples](examples/index.md) — what ships in the repository today.
- [Stopwatch](examples/stopwatch.md) — the one working demo, built from `VirtualNodeFactory` calls.

## Roadmap

- [Project Status](roadmap/status.md) — area-by-area: built, partial, marker-only, absent.
- [Differences from Vue 3](roadmap/vue-differences.md) — the naming map and the behavioral
  divergences.

## Coming from Vue?

Start with [Differences from Vue 3](roadmap/vue-differences.md). Most of Viu is a mechanical rename
away from what you already know — `ref()` becomes `Reactive.Reference<T>`, `.value` becomes `.Value`,
`props` becomes `Properties` — but a handful of behaviors genuinely differ and will bite you
otherwise. The two worth knowing before you write a line: **`Reactive.Watch` defaults to
`WatchFlushMode.Sync`, not `pre`** — the standalone reactivity layer has no scheduler, so inside a
component use `ViuWatch`, which defaults to `WatchFlushMode.Pre` on the runtime scheduler exactly as
Vue does — and **there is no identity-swapping proxy**, so a `[Reactive]` instance *is* the reactive
object and deep traversal stops at un-annotated plain CLR objects.

The source lives at [github.com/assimalign/viu](https://github.com/assimalign/viu).
