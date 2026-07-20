# Components

How a Viu component is declared, what `Setup` returns, and why there is no `this`.

> **Status:** Partial. The `IComponentDefinition` contract described here is fully implemented and is
> what the shipping example runs on; the `.viu` generator path shown below compiles but is not yet
> mountable. See [Project status](../../roadmap/status.md).

Every other page in this guide assumes the shape described here. Viu's component model is the single
largest divergence from [Vue's](https://vuejs.org/guide/essentials/component-basics.html), and it is
a divergence forced by the language: C# has no `Proxy`, so there is no `this`-proxy to hang state on,
and AOT/trimming forbids the reflection an options object would need.

## The rule

`IComponentDefinition.Setup` runs **exactly once per component instance** and **returns** the render
function. State lives in refs and computeds that the returned closure captures. The closure is Viu's
proxy-free realization of what upstream calls the setup state object.

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

Only `Setup` is required — the other four are default interface members, so the smallest possible
component implements one method.

| Member | Vue counterpart | Notes |
| --- | --- | --- |
| `Name` | `name` | Display name used in warnings. Null falls back to the C# type name. |
| `Properties` | [`props`](https://vuejs.org/guide/components/props.html) | Precomputed `ComponentPropertyDefinition` metadata, never reflected. |
| `Emits` | [`emits`](https://vuejs.org/guide/components/events.html) | Declared events; their handler props are excluded from fallthrough. |
| `InheritAttributes` | `inheritAttrs` | Defaults to `true`. |
| `Setup` | [`setup(props, context)`](https://vuejs.org/api/composition-api-setup.html) | Runs once, returns `Func<VirtualNode?>`. |

Read carefully what is **absent** from that interface:

- **No `Render` member** — the render function is the *return value* of `Setup`, not a separate
  method you override.
- **No `this`** — a render function reaches state through the variables it closed over, never
  through an instance proxy. `_ctx` in generated code is the component's partial class, not a proxy.
- **No Options API** — there is no `data`, `methods`, `computed`, `watch`, or `mixins` option, and
  there never will be. Never write a Viu component in an Options-API shape.
- **No `app.config.globalProperties`** — deliberately excluded, because it requires a `Proxy`. The
  sanctioned replacement is typed app-level provide plus inject; see
  [Provide / Inject](../components/provide-inject.md).

The lifecycle consequence matters: `Setup` runs once, so anything registered inside it
(`Lifecycle.OnMounted`, `ViuWatch.Watch`, `DependencyInjection.Provide`) must be registered
**synchronously during that single call**. The returned render function, by contrast, re-executes on
every update — put no registration there.

## A component, hand-written

This is the full C# authoring path — no build-time compilation involved. `Setup` closes over a ref,
declares a method, registers a hook, and returns the render closure.

```csharp
using System;
using System.Collections.Generic;
using System.Diagnostics;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

internal sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
    [
        new ComponentPropertyDefinition("start") { DefaultValue = 0 },
    ];

    public IReadOnlyList<ComponentEmitDefinition>? Emits { get; } =
    [
        new ComponentEmitDefinition("changed"),
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        // Runs exactly once per instance. Everything here is captured by the closure below.
        var start = properties.Get<int>("start");
        var count = Reactive.Reference(start);

        void Increment()
        {
            count.Value++;
            context.Emit("changed", count.Value);
        }

        Lifecycle.OnMounted(() => Debug.WriteLine("Counter mounted at " + start));

        // The render function. Re-executes on every update; reads of count.Value are tracked.
        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(
                ("type", "button"),
                ("class", "counter"),
                ("onClick", (Action)Increment)),
            $"Count: {count.Value}");
    }
}
```

Mounting it in the browser:

```csharp
using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();
BrowserRuntime.CreateApp(new Counter()).Mount("#app");
```

Two behaviors worth internalizing:

- **`Setup` never re-runs.** Writing `count.Value = 5` re-executes the render closure; it does not
  re-enter `Setup`. `setupRuns` stays at 1 for the life of the instance.
- **Updates are batched.** A ref write does not re-render synchronously — it queues a scheduler job
  that flushes on the next tick. A direct `Renderer<TNode>.Render` call, by contrast, drains the
  pre- and post-flush queues before returning.

A larger worked version of this shape — parent and child, props, emits, and a timer driven by
lifecycle hooks — is the [Stopwatch example](../../examples/stopwatch.md), the one application in the
repository that actually ships and runs. It defines two components, `StopwatchApplication` and
`ElapsedDisplay`, both hand-written `IComponentDefinition` implementations.

## The same component as a `.viu` file

A [single-file component](../scaling-up/single-file-components.md) expresses the same thing through
the template compiler. Note the container: `.viu` uses **@-blocks**, not Vue's HTML-like
`<template>` / `<script>` tags. Block *semantics* follow the
[Vue SFC spec](https://vuejs.org/api/sfc-spec.html) unchanged; only the container differs.

```viu
@template {
    <button type="button" class="counter" @click="Increment">
        Count: {{ Count }}
    </button>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count = Reactive.Reference(0);

    public void Increment() => Count.Value++;
}
```

Column 0 is structural in a `.viu` file: at the top level a line starting with `@` opens a block, and
inside a block a line starting with `}` closes it. **Block bodies must therefore be indented** — CSS
or C# written flush-left will close its own block early.

The `SingleFileComponentGenerator` compiles that file into one `partial class Counter`. Its
`@template` becomes a `Render` method built from the same `VirtualNodeFactory` calls the hand-written
version writes by hand — reached through the `_`-prefixed `RenderHelpers` aliases — and the `@script`
C# is merged verbatim into the class body under a `#line` map:

```csharp
// <auto-generated/>
#nullable enable

using static global::Assimalign.Viu.RuntimeCore.RenderHelpers;
using static global::Assimalign.Viu.RuntimeDom.DomRenderHelpers;

namespace Demo
{
    partial class Counter
    {
        internal const int RenderCacheSize = 0;

        internal static object? Render(Counter _ctx, object?[] _cache)
        {
            return _createElementBlock(_openBlock(), "button", /* … */,
                _toDisplayString(_ctx.Count.Value), 1 /* TEXT */);
        }

        // @script members merged here, under #line directives back to Counter.viu
    }
}
```

Two details are load-bearing. First, because the generator classified `Count` as a
`Reference<int>`, the template's `{{ Count }}` emitted `_ctx.Count.Value` — ref unwrapping is a
compile-time decision, not a runtime one. Second, generated member names are reserved: do not
re-declare `Render`, `RenderCacheSize`, `ScopeId`, `ExtractedStyles`, or `ApplyCssVariables` in a
sibling partial.

> **Status:** Partial. The generator emits the compiled `Render`, the merged `@script`, and the style
> constants today. What it does **not** yet emit is the wiring that makes the generated partial an
> `IComponentDefinition` — no `Setup` implementation is generated, and `ApplyCssVariables()` is
> emitted but never called. Until that lands, `.viu` components compile but are not yet mountable on
> their own; the hand-written `IComponentDefinition` path above is the one that runs end to end. See
> [Project status](../../roadmap/status.md).

## `ComponentSetupContext`

The second argument to `Setup` is upstream's `SetupContext`.

```csharp
public sealed class ComponentSetupContext
{
    public ComponentAttributes Attributes { get; }
    public ComponentSlots? Slots { get; }
    public void Emit(string eventName, params object?[] arguments);
    public void Expose(object? exposed);
}
```

- **`Attributes`** — the live fallthrough attributes, spelled as a whole word, **not `Attrs`**. It is
  a `ComponentAttributes`, replaced in place on every parent patch, so the same object always
  reflects current values. See [Props & Fallthrough Attributes](../components/props.md).
- **`Slots`** — **nullable**; it is `null` when the parent passed no slot content, so always test
  before indexing. See [Slots](../components/slots.md).
- **`Emit`** — dispatches a declared event to the parent's `onXxx` handler prop. Handlers must be
  `Action`, `Action<object?>`, or `Action<object?[]>`; any other delegate shape warns and is *not*
  invoked. See [Component Events](../components/events.md).
- **`Expose`** — narrows what a parent's template ref receives. Without it, a component ref falls
  back to the `ComponentInstance` itself. See
  [Lifecycle Hooks & Template Refs](lifecycle-and-template-refs.md).

## `ComponentInstance`

`ComponentInstance` is the runtime state behind a mounted component — upstream's
`ComponentInternalInstance`. You rarely construct anything with it, but you will read it.

| Member | Purpose |
| --- | --- |
| `ComponentInstance.Current` | The active instance (upstream `getCurrentInstance()`). Non-null only during `Setup`, a render, or a hook. |
| `Parent` / `Root` | Tree position. `DependencyInjection.Inject` walks from `Parent`, never from the instance itself. |
| `Scope` | The instance's `EffectScope`. Effects and watchers created in `Setup` join it and are torn down on unmount. |
| `IsMounted` | Whether the first mount has completed. |
| `Exposed` | Whatever `context.Expose(...)` surfaced, or null. |
| `Subtree` | The last rendered `VirtualNode` tree — note the whole-word spelling, not `subTree`. |

Because `Scope` exists, a composable that creates effects inside `Setup` needs no explicit cleanup:
the scope stops with the component. Computeds are the documented exception — they are never owned by
a scope. See [Composables](../reusability/composables.md).

## Naming: whole words

Viu's public names are PascalCase whole-word renames of Vue's abbreviations. This is mechanical, and
knowing the rule saves guessing:

| Vue | Viu |
| --- | --- |
| `props` | `Properties` |
| `attrs` | `Attributes` |
| `subTree` | `Subtree` |
| `vnode` / `VNode` | `VirtualNode` |
| `ref()` | `Reactive.Reference<T>` |
| `.value` | `.Value` |

There is exactly one documented exception: the `_`-prefixed lowercase render helpers — the members of
`RenderHelpers` (`_createElementBlock`, `_toDisplayString`, `_renderList`, `_openBlock`, …) and of
`DomRenderHelpers` (`_vShow`, `_vModelText`, `_withModifiers`, `_withKeys`, …). Those names *are* the
upstream `helperNameMap` contract that generated render bodies bind to by name through the two
`using static` directives, so renaming them would break parity with the compiler port. They are
generated-code surface — do not call them by hand; use `VirtualNodeFactory` instead. Full detail in
[Render Functions & VirtualNode](../../api/render-function.md).

One practical consequence of `Name` being optional: the runtime's internal display name is
`Definition.Name ?? Definition.GetType().Name`, so an unnamed component still appears in dev
warnings — but by its C# type name, which may not be the name you use in templates. Set `Name`
whenever the two differ. (`ComponentInstance.DisplayName` is `internal`; you observe it only through
warning text, not by reading the property.)

## Not yet implemented

- **Functional components** — `ShapeFlags.FunctionalComponent` exists in `Assimalign.Viu.Shared`, but
  the component vnode factory always sets `StatefulComponent`. There is no functional code path.
- **Async components** — there is no `defineAsyncComponent` equivalent anywhere.
- **`app.mixin`, `app.version`, `app.runWithContext`** — absent. `Application<TNode>` exposes only
  `Component`, `Directive`, `Provide`, `Use`, `Mount`, `Unmount`, `Config`, `IsMounted`, and
  `RootInstance`.
- **`KeepAlive`, `Teleport`, `Suspense`** — marker objects only; rendering one throws
  `NotSupportedException`. See [KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md).
- **SSR and hydration** — no server renderer, no `createSSRApp`, no hydration path.

Continue with [Reactivity Fundamentals](reactivity-fundamentals.md) for what goes *inside* `Setup`,
or [Differences from Vue 3](../../roadmap/vue-differences.md) if you are arriving from Vue.
