# Guide

The teaching path through Viu, from a first mounted component to the SDK, testing, and AOT constraints.

> **Status:** Partial. Most chapters document implemented behavior; Built-ins and the Scaling Up
> chapters carry explicit gaps. See [Project Status](../roadmap/status.md) for the area-by-area truth.

## How to read this guide

Read [Introduction](introduction.md) first — it explains *why* Viu's APIs are shaped the way they are,
and every later chapter assumes it. Then work [Quick Start](quick-start.md) to get something on screen.
After that, read [Essentials](essentials/index.md) in order; the nine chapters build on each other and
together cover everything needed to write a real component.

The chapters after Essentials are reference-shaped and can be read out of order as you need them.

### If you already know Vue

Read [Differences from Vue 3](../roadmap/vue-differences.md) **before** anything else. Viu is a port of
Vue 3.5, not a framework inspired by it, so almost everything you know transfers — but the spelling
changes and a handful of behaviors deliberately diverge. That page is the complete naming map plus every
intentional divergence, and reading it first will save you from a class of surprises the guide otherwise
only warns about chapter by chapter.

The four you are most likely to trip on:

- **`Reactive.Reference(value)` is `ref()`, the type it returns is `Reference<T>`, and `.Value` is
  `.value`** — capital `V`, and there is no type named `Ref` anywhere in the library.
- **`Setup` returns the render function** — there is no `this`, no Options API, and no mixins, because
  C# has no `Proxy` to build a component instance proxy from.
- **A `WatchOptions` you construct yourself defaults to `WatchFlushMode.Sync`.** `ViuWatch.Watch` with
  *no* options object matches [Vue's `pre`](https://vuejs.org/guide/essentials/watchers.html) default,
  but passing an options object without setting `Flush` silently opts you back out of pre-flush timing.
  (`Reactive.Watch`, the standalone reactivity layer, defaults to `Sync` throughout.)
- **There is no runtime template compilation** — `.viu` files compile at build time through a Roslyn
  source generator, and that is the only path.

### If you already know .NET

Start at [Introduction](introduction.md) and read [Essentials](essentials/index.md) straight through in
order. Viu's model will feel unfamiliar for about two chapters and then click: state lives in reactive
cells rather than in fields you mutate and re-read, and the framework re-runs a render closure for you
when a cell that closure read has changed. You do not need to know Vue to follow the guide, but every
page names the upstream Vue counterpart so you can read
[vuejs.org](https://vuejs.org/guide/introduction.html) for the conceptual background.

## What a component looks like

Two authorings of the same idea. First, hand-written C# implementing `IComponentDefinition` — this is
what the one shipping example uses, and it is the form the runtime actually consumes:

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

internal sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        // Setup runs exactly once per instance. State lives in the closure the render function captures.
        var count = Reactive.Reference(0);

        void Increment() => count.Value++;

        // The returned delegate IS the render function; it re-runs when a ref it read has changed.
        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", "counter")),
            VirtualNodeFactory.Element(
                "span",
                VirtualNodeFactory.Properties(("class", "count")),
                VirtualNodeFactory.Text(count.Value.ToString())),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("type", "button"), ("onClick", (Action)Increment)),
                VirtualNodeFactory.Text("+")));
    }
}
```

Second, a `.viu` single-file component. Blocks are `@template { … }`, `@script { … }`, and
`@style scoped { … }` — an `@`-block container rather than
[Vue's tag-based SFC](https://vuejs.org/guide/scaling-up/sfc.html), though the markup inside `@template`
is standard Vue template syntax with C# expressions:

```viu
@template {
    <div>{{ Message }}</div>
}

@script {
    public string Message = "Hello";
}

@style scoped {
    .box { color: red; }
}
```

> **Not yet mountable.** The format, the block parser, the Roslyn generator, and the CSS pipeline are
> implemented and test-pinned, but the generator emits a **partial-class scaffold** — the runtime
> adapter that turns it into an `IComponentDefinition` does not exist yet, and no shipping example
> compiles a `.viu` file. Everything below about the format is real; a `.viu` component you write
> today cannot yet be mounted. See
> [Single-File Components (.viu)](scaling-up/single-file-components.md) and
> [Project Status](../roadmap/status.md).

Column 0 is structural in a `.viu` file: at the top level a line starting with `@` opens a block, and
inside a block a line starting with `}` closes it. Block content must be indented.
[Single-File Components (.viu)](scaling-up/single-file-components.md) is the authoritative specification.

## Getting Started

- **[Introduction](introduction.md)** — what Viu is, what it deliberately is not, and the five founding
  divergences from Vue that explain every API you will meet.
- **[Quick Start](quick-start.md)** — the complete consumer project file by file, from `csproj` through
  `wwwroot/index.html` to a mounted component in the browser.

## Essentials

Read these nine in order. [Essentials](essentials/index.md) is the section landing page.

- **[Components](essentials/components.md)** — `IComponentDefinition.Setup` runs once and returns
  `Func<VirtualNode?>`; the single most important divergence from Vue, and the shape every other
  chapter assumes.
- **[Reactivity Fundamentals](essentials/reactivity-fundamentals.md)** — `Reactive.Reference<T>`, the
  `[Reactive]` source generator, and how Viu tracks state without a JavaScript `Proxy`.
- **[Computed Properties](essentials/computed.md)** — `Reactive.Computed<T>`, caching and subscriber-driven
  cleanup, and the three read-only shapes with two different failure modes.
- **[Template Syntax](essentials/template-syntax.md)** — interpolation and bindings, and the headline
  rule that markup is Vue's verbatim while expression bodies are C#.
- **[Conditional & List Rendering](essentials/conditional-and-list.md)** — `v-if`/`v-else-if`/`v-else`
  and `v-for`, keying, and the keyed longest-increasing-subsequence reconciliation that keys enable.
- **[Event Handling](essentials/event-handling.md)** — `v-on`, modifiers, the `BrowserEvent` payload,
  and the delegate-shape rules that fail silently when you get them wrong.
- **[Form Input Bindings](essentials/form-bindings.md)** — `v-model` across every input type and across
  a component boundary.
- **[Watchers](essentials/watchers.md)** — `ViuWatch.Watch` and `WatchEffect`, and the flush-mode
  divergence to internalize before it bites you.
- **[Lifecycle Hooks & Template Refs](essentials/lifecycle-and-template-refs.md)** — every `Lifecycle`
  hook with its real status, and how to reach a rendered element or child component.

## Components In-Depth

Assumes [Essentials > Components](essentials/components.md). [Components In-Depth](components/index.md)
is the section landing page.

- **[Props & Fallthrough Attributes](components/props.md)** — declaring props as precomputed
  `ComponentPropertyDefinition` metadata, reading them, and how undeclared attributes fall through.
- **[Component Events](components/events.md)** — `context.Emit`, declared `ComponentEmitDefinition`s, and
  the `onXxx` prop naming that connects child to parent.
- **[Component v-model](components/v-model.md)** — the `modelValue` prop plus `onUpdate:modelValue`
  handler pair that is the whole mechanism; there is no `defineModel` equivalent.
- **[Slots](components/slots.md)** — named and scoped slots, fallback content, and the `SlotFlags`
  performance rule.
- **[Provide / Inject](components/provide-inject.md)** — typed `InjectionKey<T>` dependency injection,
  and Viu's sanctioned replacement for `app.config.globalProperties`.
- **[Dynamic Components & Registration](components/dynamic-components.md)** — `<component :is>`, and the
  split between exact-name registration lookup and render-time resolution, which probes the raw,
  camelCase, and PascalCase forms in that order. The matching is directional, not case-insensitive.

## Reusability

- **[Composables](reusability/composables.md)** — factoring stateful logic into `Use*` functions, plus
  `EffectScope` and the teardown contract composable authors depend on. This is Viu's replacement for
  mixins, which do not exist and never will.
- **[Custom Directives](reusability/custom-directives.md)** — `IDirective`, its seven hooks, and the
  warning that on the browser the `element` argument is an `int` node handle rather than a DOM object.

## Built-ins

> This subsection contains unimplemented material. Read
> [KeepAlive, Teleport & Suspense](built-ins/deferred-built-ins.md) before designing around any of them.

- **[Transition & TransitionGroup](built-ins/transition.md)** — the two built-in components that are
  actually implemented, including the C#-specific hook contract where the `done` callback is always
  passed and must always be invoked.
- **[KeepAlive, Teleport & Suspense](built-ins/deferred-built-ins.md)** — **not yet implemented.** All
  three exist only as marker objects that throw `NotSupportedException` when rendered. The page documents
  the inert scaffolding so nobody mistakes it for support, and gives the workarounds available today.

## Scaling Up

Every chapter in this subsection ends with a "Not yet implemented" tail, because the tooling story is the
least finished part of Viu. Read those tails before committing to a build or test strategy.

- **[Single-File Components (.viu)](scaling-up/single-file-components.md)** — the authoritative `.viu`
  format specification: `@`-block containers, the column-0 structural rule, what the generator emits, and
  the eight parse error codes. Gaps: no `lang="scss"`/`"less"` pre-processor, and no shipped end-to-end
  `.viu` example project.
- **[SFC CSS Features](scaling-up/sfc-css-features.md)** — `@style scoped`, CSS Modules, and `v-bind()`
  in CSS, plus how the bundle reaches the page. Gaps: **`scoped` and `v-bind()` are compile-time only**
  — the renderer never stamps `data-v-<hash>` and never calls `ApplyCssVariables()`, so only CSS
  Modules works end to end; plus no SCSS/LESS, no camelCase style-key normalization, and the
  utility-first CSS engine is entirely unbuilt.
- **[The Viu SDK & Build](scaling-up/sdk-and-build.md)** — `Assimalign.Viu.Sdk`, the shared framework,
  and every consumer-settable MSBuild property. Gaps: no `dotnet new` templates, no public NuGet feed,
  and no hot-reload or dev-loop story.
- **[Testing](scaling-up/testing.md)** — `ViuTest.Mount` and the DOM-free `TestRenderer`, both of which
  ship and are exercised by the framework's own test suite. Gaps: no `shallowMount`, no `setProps`, and
  no browser end-to-end harness.

## Best Practices

- **[AOT & Trimming](best-practices/aot-and-trimming.md)** — the hard constraint that explains the shape
  of nearly every API in this guide: no reflection, no dynamic code generation, no assembly scanning.
  Read this and a dozen earlier "why is it like that?" questions answer themselves.
- **[Performance](best-practices/performance.md)** — where rendering cost actually lives on WebAssembly
  (the JS-interop boundary, not .NET allocations), the opt-in command buffer, and how to measure.

## Beyond the guide

- **[API Reference](../api/index.md)** — signature-level lookup organized by assembly. The guide teaches;
  the API pages are for looking things up once you know what you are looking for.
- **[Examples](../examples/index.md)** — an honest index of what runnable code exists. There is exactly
  one shipping example application, the [Stopwatch](../examples/stopwatch.md), and it is the best
  available reference for the hand-written render-function style.
- **[Project Status](../roadmap/status.md)** — what is built, what is partial, what is a marker that
  throws, and what does not exist on disk at all. Router, Store, SSR, and DevTools are in the last group.
- **[Differences from Vue 3](../roadmap/vue-differences.md)** — the complete naming map and every
  intentional behavioral divergence.

## A note on how these docs are written

This guide describes the developer experience Viu is being built toward, and it does not pretend that
experience is finished. Anything not yet implemented is labelled inline where it appears, carries a
`> **Status:**` callout at the top of its page, and links to [Project Status](../roadmap/status.md).
Where a chapter shows an aspirational form — most often a `.viu` component, since no shipping example
compiles one yet — it says so at the point of use. Code that is marked as working is grounded in the
real API and the repository's own tests.

The source lives at [github.com/assimalign/viu](https://github.com/assimalign/viu).
