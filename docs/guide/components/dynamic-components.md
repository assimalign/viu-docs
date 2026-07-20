# Dynamic Components & Registration

How `<component :is>` picks a component at render time, how names are registered on an application,
and the exact rules that decide whether a name resolves.

> **Status:** Implemented. `<component :is>`, the resolution rules, and name registration all ship and
> are covered by tests; functional and async components do not exist at all — see
> [Not yet implemented](#not-yet-implemented).

Viu ports Vue's [`<component :is>` special element](https://vuejs.org/api/built-in-special-elements.html#component)
and [`app.component()` registration](https://vuejs.org/api/application.html#app-component) faithfully,
including upstream's element-tag fallback. The C# spelling is `DynamicComponents.ResolveDynamicComponent`
and `Application<TNode>.Component`, but the semantics — and the surprises — are Vue's.

## `<component :is>` in a template

Three template forms reach the dynamic-component path. All are the counterparts of the same
upstream constructs.

```viu
@template {
    <!-- bound: the component changes whenever `viewName` changes -->
    <component :is="viewName"></component>

    <!-- static: still routed through dynamic resolution, with a constant name -->
    <component is="foo"></component>

    <!-- the `vue:` prefix on a plain element: resolves the component `MyComp` -->
    <div is="vue:MyComp"></div>
}
```

- **`<component>` / `<Component>` with `is`** — compiles the `is` expression into a
  `_resolveDynamicComponent(...)` call used as the vnode tag, wrapped in a block. This holds whether
  `is` is bound (`:is`) or a static attribute (`is="foo"`); a static attribute simply becomes a
  constant string expression.
- **`is="vue:Name"` on any other tag** — the `vue:` prefix is deliberately retained from upstream and
  is *not* renamed to `viu:`. The tag is rewritten to `Name` and then resolved like any other
  component reference, through `_resolveComponent`. This is a compile-time rewrite, not a dynamic one.
- **Everything else** — an uppercase-initial tag, or any tag the compiler classifies as a component,
  resolves by name to a `_component_<sanitized>` local via `_resolveComponent`.

The compiler's emitted C# for the bound form is small enough to read directly:

```csharp
// template: <component :is="viewName"></component>
return _createBlock(_openBlock(), _resolveDynamicComponent(_ctx.viewName));
```

```csharp
// template: <MyButton :kind="kind" />
var _component_MyButton = _resolveComponent("MyButton");

return _createBlock(_openBlock(), _component_MyButton, _createProps(("kind", _ctx.kind)),
    null, 8 /* PROPS */, ["kind"]);
```

Note the difference in shape: a *named* component is resolved once into a local in the render
preamble, while a *dynamic* component is resolved on every render, because its identity is an
expression. See [Template Syntax](../essentials/template-syntax.md) for how `_ctx.` prefixing and
`.Value` insertion work on the expression itself.

## The runtime behind it

`DynamicComponents` in `Assimalign.Viu.RuntimeCore` is the runtime the compiled call lands on. It is
public API, so hand-written render functions can use it directly.

```csharp
public static class DynamicComponents
{
    public static object? ResolveDynamicComponent(object? source);
    public static VirtualNode DynamicComponent(
        object? source,
        VirtualNodeProperties? properties = null,
        ComponentSlots? slots = null);
}
```

`ResolveDynamicComponent` is the port of upstream's `resolveDynamicComponent`. Its contract is a
three-way switch on what you hand it:

| `source` | Result | Vnode `DynamicComponent` builds |
| --- | --- | --- |
| An `IComponentDefinition` | The same instance, unchanged | `VirtualNodeType.Component` |
| A non-empty `string` that is registered | The registered `IComponentDefinition` | `VirtualNodeType.Component` |
| A non-empty `string` that is *not* registered | The string itself, used as an element tag | `VirtualNodeType.Element` |
| `null` or `""` | `null` | `VirtualNodeType.Comment` (a placeholder) |

The unregistered-string row is the one that catches people. It is not an error — `:is="'div'"` is a
perfectly normal way to render a plain `<div>` dynamically, so the string falls through to being a
tag name. `RenderHelpers._resolveDynamicComponent` is a thin forward to this method.

```csharp
DynamicComponents.ResolveDynamicComponent(definition).ShouldBeSameAs(definition);
DynamicComponents.ResolveDynamicComponent("div").ShouldBe("div");   // unregistered -> element tag

DynamicComponents.DynamicComponent(definition).Type.ShouldBe(VirtualNodeType.Component);
DynamicComponents.DynamicComponent("span").Type.ShouldBe(VirtualNodeType.Element);
DynamicComponents.DynamicComponent(null).Type.ShouldBe(VirtualNodeType.Comment);
```

### A hand-written dynamic host

Because `Setup` returns the render closure, switching components is just switching what a captured
reference holds. Cross-reference [Components](../essentials/components.md) for the `Setup` contract.

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

public sealed class TabHost : IComponentDefinition
{
    public string? Name => "TabHost";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var current = Reactive.Reference("tab-home");

        return () => VirtualNodeFactory.Element(
            "section",
            null,
            new VirtualNode?[]
            {
                VirtualNodeFactory.Element(
                    "button",
                    VirtualNodeFactory.Properties(("onClick", (Action)(() => current.Value = "tab-home"))),
                    "Home"),
                VirtualNodeFactory.Element(
                    "button",
                    VirtualNodeFactory.Properties(("onClick", (Action)(() => current.Value = "tab-settings"))),
                    "Settings"),

                // Resolved against the app registry on every render.
                DynamicComponents.DynamicComponent(current.Value),
            });
    }
}
```

Props and slots ride along through the optional parameters — `DynamicComponent(current.Value, props,
slots)` builds a component vnode carrying both, and falls back to an element vnode with just the
props when the name resolves to a tag. See [Slots](./slots.md) for how to build a `ComponentSlots`.

### Changing `is` replaces the tree

This is a behavioral contract worth stating outright, because it is not an optimization detail:
changing `is` **fully unmounts the old subtree and mounts a new one**. The vnode's `ComponentType`
(or `ElementTag`) changes with the resolved value, which fails the renderer's same-type check, so
there is no patch path between the two.

```csharp
var isValue = Reactive.Reference<object?>(componentA);
var host = new TestComponent
{
    SetupFunction = (_, _) => () => DynamicComponents.DynamicComponent(isValue.Value),
};

_renderer.Render(VirtualNodeFactory.Component(host), _container);
_events.ShouldBe(["A:mounted"]);

isValue.Value = componentB;
_pump.RunUntilIdle();

// Full replace — no lifecycle bleed, no state carried across.
_events.ShouldBe(["A:mounted", "A:unmounted", "B:mounted"]);
```

Practically: **any state inside the outgoing component is gone.** Vue's answer to that is
`<KeepAlive>`, which Viu does not implement — see
[KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md) for what exists and the
workarounds. Hoist state you need to survive a swap into a
[composable](../reusability/composables.md) or an app-level
[provide](./provide-inject.md).

## Registering components by name

Registration is explicit and chainable. There is no assembly scanning and no convention-based
discovery anywhere in Viu — reflection is forbidden under AOT, so every name you can resolve is a
name someone registered by hand.

```csharp
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

var focus = Directive.FromFunction((element, binding, node, previousNode) =>
{
    // `element` is an int node handle on the browser, not a DOM object.
});

BrowserRuntime.CreateApp(new App())
    .Component("TabHome", new TabHome())
    .Component("TabSettings", new TabSettings())
    .Directive("focus", focus)
    .Mount("#app");
```

`Application<TNode>.Component(name, definition)` and `Directive(name, directive)` both return the
application for chaining; `BrowserApplication` mirrors them. Both guard the name with
`ArgumentException.ThrowIfNullOrEmpty` — so a null name throws `ArgumentNullException` and an empty
one throws `ArgumentException` — and a null definition or directive throws `ArgumentNullException`.
Both also warn in dev when you register a duplicate name or register *after* `Mount`; the warning
goes to the `RuntimeWarnings` sink, which defaults to `Debug.WriteLine` and is therefore silent in a
Release build. See the
[Application API](../../api/application.md) for the full surface, and
[Custom Directives](../reusability/custom-directives.md) for the directive side.

### The lookup rules — getter versus render time

This is the rule most likely to send someone debugging. **The one-argument getters are exact-name
lookups; name-form matching happens only at render time.** The registries are ordinal
(case-sensitive) dictionaries, and render-time resolution probes exactly three forms in order.

| Step | Probe | Example (`my-widget` at the call site) |
| --- | --- | --- |
| 1 | The raw name | `my-widget` |
| 2 | Its camelCase form (hyphens removed, next letter uppercased) | `myWidget` |
| 3 | The PascalCase form of step 2 | `MyWidget` |

So the matching is directional, not case-insensitive:

| Registered as | Referenced in a template | Resolves? |
| --- | --- | --- |
| `MyWidget` | `MyWidget` | Yes — raw hit |
| `MyWidget` | `my-widget` | Yes — camelize then capitalize |
| `myWidget` | `my-widget` | Yes — camelize hit |
| `my-widget` | `MyWidget` | **No** — the probe never lowercases or re-hyphenates |
| `MyWidget` | `mywidget` | **No** — no hyphen, so camelize is a no-op and step 3 probes `Mywidget` |

And the getters never do any of this:

```csharp
var app = BrowserRuntime.CreateApp(new App());
app.Component("MyChild", new MyChild());

app.Component("MyChild");   // the definition
app.Component("my-child");  // null — the getter is an exact-name lookup
// ...but a template writing <my-child /> resolves it fine.
```

### The warning asymmetry

`_resolveComponent` and `_resolveDynamicComponent` behave differently on a miss, and the difference
is deliberate upstream parity rather than an oversight:

- **`RenderHelpers._resolveComponent(name)` warns** — `Failed to resolve component: {name}` — and
  returns the raw name. A named component reference that does not resolve is virtually always a bug.
- **`DynamicComponents.ResolveDynamicComponent(source)` does not warn** — upstream calls
  `resolveAsset(..., warnMissing: false)`, because falling through to an element tag is a normal,
  supported path. A typo in `:is` therefore fails *silently*, rendering an unknown element instead of
  your component.

If a `<component :is>` renders nothing recognizable, check the registered name first; nothing will
have told you.

### Built-in tags

`<Teleport>`, `<Suspense>`, and `<KeepAlive>` are recognized by the compiler and resolve to built-in
marker tags rather than registry lookups — but rendering any of them throws
`NotSupportedException`. `<BaseTransition>` and the DOM `<Transition>` / `<TransitionGroup>` resolve
to real, working components. See [Transition & TransitionGroup](../built-ins/transition.md) and
[KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md).

## Not yet implemented

- **Functional components** — `ShapeFlags.FunctionalComponent` is declared in `Assimalign.Viu.Shared`
  for bit-parity with `@vue/shared`, but the component vnode factory always sets
  `ShapeFlags.StatefulComponent` and there is no functional-component code path. Every component is a
  `IComponentDefinition` with a `Setup`.
- **Async components** — there is no `defineAsyncComponent` equivalent anywhere in `RuntimeCore`, and
  no loading/error/delay/timeout handling. Load data inside `Setup` into a reference and render a
  loading branch with `v-if` instead; see
  [Conditional & List Rendering](../essentials/conditional-and-list.md).
- **`app.mixin`, `app.version`, `app.runWithContext`** — absent. `Application<TNode>` exposes only
  `Component`, `Directive`, `Provide`, `Use`, `Mount`, `Unmount`, `Config`, `IsMounted`, and
  `RootInstance`.

See [Project Status](../../roadmap/status.md) for area-by-area coverage and
[Differences from Vue 3](../../roadmap/vue-differences.md) for the full naming map.
