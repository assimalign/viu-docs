# Components In-Depth

The component contract surface — props, events, `v-model`, slots, provide/inject, and dynamic
resolution — as Viu spells it in C#.

> **Status:** Partial. Five of the six chapters document shipping behavior;
> [Component v-model](v-model.md) is `Partial` — a template-authored component `v-model` does not yet
> reach the child's emit handler, so the hand-written prop/emit pair is the working path. The
> per-chapter "Not yet implemented" tails and [Project status](../../roadmap/status.md) record the
> rest of the gaps.

## Before you start

These chapters assume you have read [Essentials > Components](../essentials/components.md) and are
comfortable with the one rule everything here rests on:

- **`Setup` runs exactly once per instance and returns the render function** — `IComponentDefinition`
  has no `Render` member, no `this`-proxy, and no Options API. State lives in the refs and computeds
  that the returned `Func<VirtualNode?>` closure captures.
- **Declarations are precomputed metadata, not discovered attributes** — props and emits are
  `IReadOnlyList<ComponentPropertyDefinition>` and `IReadOnlyList<ComponentEmitDefinition>` you
  return from the definition, because AOT and trimming forbid reflection over the type.
- **Everything is a plain object** — a component definition is never activated reflectively. Today
  that means you write `new MyComponent()` yourself; the generated-factory path the AOT contract
  anticipates does not exist yet (the `.viu` generator emits no `IComponentDefinition`).

If you are coming from Vue, [Differences from Vue 3](../../roadmap/vue-differences.md) is the
fastest way to load the naming map before you read further.

## The contract, in one interface

Everything these chapters cover hangs off five members. This is the whole of
`IComponentDefinition` — four default interface members plus the one you must write:

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

| Member | Upstream Vue counterpart | Covered in |
| --- | --- | --- |
| `Name` | [`name`](https://vuejs.org/api/options-misc.html#name) | [Essentials > Components](../essentials/components.md) |
| `Properties` | [`props`](https://vuejs.org/api/options-state.html#props) | [Props & Fallthrough Attributes](props.md) |
| `InheritAttributes` | [`inheritAttrs`](https://vuejs.org/api/options-misc.html#inheritattrs) | [Props & Fallthrough Attributes](props.md) |
| `Emits` | [`emits`](https://vuejs.org/api/options-state.html#emits) | [Component Events](events.md) |
| `Setup` | [`setup(props, ctx)`](https://vuejs.org/api/composition-api-setup.html) | [Essentials > Components](../essentials/components.md) |

And the second `Setup` argument, `ComponentSetupContext`, is upstream's
[`SetupContext`](https://vuejs.org/api/composition-api-setup.html#setup-context) — note the
whole-word member names, `Attributes` rather than `attrs`:

```csharp
public sealed class ComponentSetupContext
{
    public ComponentAttributes Attributes { get; }
    public ComponentSlots? Slots { get; }
    public void Emit(string eventName, params object?[] arguments);
    public void Expose(object? exposed);
}
```

`Slots` is nullable — it is `null` when the parent passed no slot content at all, which is not the
same as passing an empty `ComponentSlots`.

## A component that uses the whole surface

The following `DataCard` declares props with three kinds of default, declares two emitted events
(one with a validator), renders a named slot with fallback content plus a default slot, keeps local
reactive state, and exposes a handle to its parent. Every API it touches is documented in one of the
chapters below.

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp.Components;

public sealed record DataCardHandle(Action Collapse);

public sealed class DataCard : IComponentDefinition
{
    // Precomputed metadata: allocated once for the definition, not per instance.
    private static readonly ComponentPropertyDefinition[] PropertyDefinitions =
    [
        new ComponentPropertyDefinition("title") { Required = true },
        new ComponentPropertyDefinition("collapsed") { DefaultValue = false },
        new ComponentPropertyDefinition("tags") { DefaultFactory = () => new List<string>() },
    ];

    private static readonly ComponentEmitDefinition[] EmitDefinitions =
    [
        new ComponentEmitDefinition("update:collapsed"),
        new ComponentEmitDefinition("tag-selected")
        {
            Validator = arguments => arguments.Length == 1 && arguments[0] is string,
        },
    ];

    public string? Name => "DataCard";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties => PropertyDefinitions;

    public IReadOnlyList<ComponentEmitDefinition>? Emits => EmitDefinitions;

    public bool InheritAttributes => true;

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        // Setup body runs once. Local state lives here; the returned closure re-reads it per render.
        var interactions = Reactive.Reference(0);

        context.Expose(new DataCardHandle(() => context.Emit("update:collapsed", true)));

        return () =>
        {
            // Prop reads inside the render closure track per prop name.
            var title = properties.Get<string>("title") ?? "Untitled";
            var collapsed = properties.Get<bool>("collapsed");

            var toggle = VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(
                    ("class", "card-toggle"),
                    ("onClick", (Action)(() =>
                    {
                        interactions.Value++;
                        context.Emit("update:collapsed", !collapsed);
                    }))),
                collapsed ? "Expand" : "Collapse");

            var header = VirtualNodeFactory.Element(
                "header",
                VirtualNodeFactory.Properties(("class", "card-header")),
                VirtualNodeFactory.RenderSlot(
                    context.Slots,
                    "header",
                    title,
                    () => [VirtualNodeFactory.Element("h2", title)]),
                VirtualNodeFactory.Element("small", $"{interactions.Value} interactions"),
                toggle);

            return VirtualNodeFactory.Element(
                "article",
                VirtualNodeFactory.Properties(("class", collapsed ? "card card-collapsed" : "card")),
                header,
                collapsed
                    ? VirtualNodeFactory.Comment("collapsed")
                    : VirtualNodeFactory.Element(
                        "section",
                        null,
                        VirtualNodeFactory.RenderSlot(context.Slots, "default")));
        };
    }
}
```

Consuming it from a parent's render function shows the other half of every contract — props in,
handler props for emitted events, slot content, and one undeclared attribute that falls through to
the card's root element:

```csharp
var collapsed = Reactive.Reference(false);

var slots = new ComponentSlots
{
    ["header"] = title => [VirtualNodeFactory.Element("h2", $"Report: {title}")],
    ["default"] = _ => [VirtualNodeFactory.Element("p", "Body content.")],
};

var card = VirtualNodeFactory.Component(
    new DataCard(),
    VirtualNodeFactory.Properties(
        ("title", "Quarterly"),
        ("collapsed", collapsed.Value),
        // Emitted "update:collapsed" is handled by the "onUpdate:collapsed" prop.
        ("onUpdate:collapsed", (Action<object?>)(value => collapsed.Value = value is true)),
        // Undeclared, so it falls through onto <article> because InheritAttributes is true.
        ("data-testid", "report-card")),
    slots);
```

Four things in that pair are worth naming now, because each has a chapter of its own:

- **The `("title", …)` entry resolves against a declaration** — declared props resolve by camelCase
  or kebab-case; anything undeclared becomes a fallthrough attribute instead. See
  [Props & Fallthrough Attributes](props.md).
- **`"onUpdate:collapsed"` is the handler prop for the emitted `"update:collapsed"` event** — the
  mapping is mechanical, and handler delegates must be `Action`, `Action<object?>`, or
  `Action<object?[]>` or they are not invoked. See [Component Events](events.md).
- **A `collapsed` prop plus an `update:collapsed` emit *is* a `v-model` binding** — there is no
  `defineModel` equivalent; the pair is the whole mechanism. See [Component v-model](v-model.md).
- **`ComponentSlots` entries are plain `Slot` delegates** taking the child-supplied scope object.
  See [Slots](slots.md).

## The same component as a `.viu` file

`.viu` single-file components are the *intended* authoring surface, but they are not yet a working
one — read the callout below before writing any. Sketched as a `.viu` file, the card looks like this:

```viu
@template {
    <article :class="CardClass">
        <header class="card-header">
            <slot name="header" :title="Title">
                <h2>{{ Title }}</h2>
            </slot>
            <button class="card-toggle" @click="Toggle()">{{ ToggleLabel }}</button>
        </header>
        <section v-if="!Collapsed">
            <slot></slot>
        </section>
    </article>
}

@script {
using Assimalign.Viu.Reactivity;

    public Reference<string> Title { get; } = Reactive.Reference("Untitled");

    public Reference<bool> Collapsed { get; } = Reactive.Reference(false);

    public string CardClass => Collapsed.Value ? "card card-collapsed" : "card";

    public string ToggleLabel => Collapsed.Value ? "Expand" : "Collapse";

    public void Toggle() => Collapsed.Value = !Collapsed.Value;
}
```

The members are refs rather than plain properties on purpose. `ScriptBlockAnalyzer` classifies a
`@script` member as `BindingType.SetupReference` — the one classification the template compiler
unwraps — only when its declared type is `Reference<T>`, `ShallowReference<T>`, `CustomReference<T>`,
`Computed<T>`, or `IReference<T>`. So `{{ Title }}` compiles to `_ctx.Title.Value`, while a plain
`public string Title { get; set; }` would compile to a bare `_ctx.Title` that no effect ever tracks.
The leading `using` directive is hoisted out of the class body into the generated file's using
region, which is why it sits flush against column 1.

> **Not yet runnable.** A `.viu` file cannot be mounted today. The generator emits `Render`,
> `RenderCacheSize`, `ScopeId`, `ExtractedStyles`, `ApplyCssVariables`, and CSS-module accessors into
> a `partial class`, and merges `@script` verbatim under a `#line` map — but that class does **not**
> implement `IComponentDefinition` and emits no `Setup`, and it derives no `Properties` or `Emits`.
> The runtime adapter that would join the compiled `Render` to the component runtime is unbuilt, so
> the hand-written C# above is the whole story today. A second join is open even once it lands: the
> `@click="Toggle()"` above compiles to `_withHandler(__event => { _ctx.Toggle(); })`, which binds
> the `Action<object?>` overload, and the DOM event invoker dispatches only `Action` and
> `Action<BrowserEvent>`. That is the same delegate-shape mismatch — at a different join — that
> [Component v-model](v-model.md) documents for compiled component `v-model`. Handlers written by
> hand in C#, like the explicit `(Action)` cast in the render function above, are unaffected. See
> [Single-File Components (.viu)](../scaling-up/single-file-components.md) and
> [Project status](../../roadmap/status.md).

## In this section

- **[Props & Fallthrough Attributes](props.md)** — declaring props with
  `ComponentPropertyDefinition` (defaults, factory defaults, `Required`, `Validator`), reading them
  through `ComponentProperties`, and how undeclared attributes reach the root element via
  `InheritAttributes` and `ComponentSetupContext.Attributes`.
- **[Component Events](events.md)** — `ComponentSetupContext.Emit`, declaring events with
  `ComponentEmitDefinition`, the `emit` name to `onXxx` handler-prop mapping, and the three delegate
  shapes a handler prop may take.
- **[Component v-model](v-model.md)** *(Partial)* — how `v-model` on a component compiles to a
  `modelValue` prop plus an `onUpdate:modelValue` handler, named bindings such as `v-model:title`,
  multiple bindings on one component, and reading the generated `*Modifiers` prop. The compiled
  write-back does not yet reach the child's emit handler; write the prop/emit pair by hand.
- **[Slots](slots.md)** — `<slot>` outlets, named and scoped slots, fallback content, the `Slot`
  delegate and `ComponentSlots`, and the `SlotFlags` stability rule that decides whether a
  parent-only re-render forces the child to re-render.
- **[Provide / Inject](provide-inject.md)** — `DependencyInjection.Provide` and `Inject` with typed
  `InjectionKey<T>` singletons, app-level provide, and why this is the sanctioned replacement for
  Vue's `app.config.globalProperties`.
- **[Dynamic Components & Registration](dynamic-components.md)** — `<component :is>`,
  `DynamicComponents.ResolveDynamicComponent`, name-based registration through
  `Application<TNode>.Component`, and the split between the exact-name one-argument getter and
  render-time resolution, which probes the raw name, its camelCase form, and that form's PascalCase
  — directional matching, not case-insensitive matching.

## Related reading

- **[Essentials > Event Handling](../essentials/event-handling.md)** — native DOM listeners obey a
  *different* delegate rule from component emits (`Action` or `Action<BrowserEvent>`), and confusing
  the two is a silent failure.
- **[Essentials > Lifecycle Hooks & Template Refs](../essentials/lifecycle-and-template-refs.md)** —
  `Lifecycle` hook registration inside `Setup`, and reaching a child through a `ref` prop, where a
  component ref receives `context.Expose`'s argument or falls back to the `ComponentInstance` itself.
- **[Reusability > Composables](../reusability/composables.md)** — factoring `Setup` state into
  reusable `Use*` functions, the composition-only replacement for mixins.
- **[Component API](../../api/component.md)** — the flat reference for every type named here.

## Not yet implemented

None of the following works today. Some are absent outright; others have declared scaffolding —
enum members, marker objects — that is never set, never read, or throws. Do not design around any of
it, and do not read the scaffolding as partial support.

- **Functional components** — `ShapeFlags.FunctionalComponent` exists in `Assimalign.Viu.Shared`, but
  the component vnode factory always sets `StatefulComponent`; there is no functional code path.
- **Async components** — there is no `defineAsyncComponent` equivalent anywhere in
  `Assimalign.Viu.RuntimeCore`.
- **`app.mixin`** — mixins are deliberately excluded. `Application<TNode>` exposes only `Component`,
  `Directive`, `Provide`, `Use`, `Mount`, `Unmount`, `Config`, `IsMounted`, and `RootInstance`.
- **`app.config.globalProperties`** — deliberately excluded, because it requires a `Proxy` that C#
  under AOT cannot provide. Use typed app-level provide plus inject instead.
- **`KeepAlive`, `Teleport`, and `Suspense`** — marker objects only; rendering one throws
  `NotSupportedException`. See [KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md).
- **String template refs** — a `"ref"` prop must be an `IReference<object?>` or an `Action<object?>`;
  a string produces a dev warning and is treated as no ref.
