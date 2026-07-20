# Component API

Reference for every type in Viu's component contract — `IComponentDefinition`, the props and emits
metadata, the setup context, slots, `ComponentInstance`, and `Lifecycle`.

> **Status:** Partial. The component contract itself is fully implemented; three `Lifecycle` hooks
> register but are never invoked. See [Project status](../roadmap/status.md).

All types on this page live in `Assimalign.Viu.RuntimeCore` unless noted. `SlotFlags` lives in
`Assimalign.Viu.Shared`. Nothing in this assembly is thread-safe — Viu assumes the single-threaded
browser event loop.

## `IComponentDefinition`

The Viu component contract. The counterpart of Vue's
[`setup()`](https://vuejs.org/api/composition-api-setup.html) plus the `props`, `emits`, `name`, and
`inheritAttrs` options — collapsed into one interface, because C# has no `Proxy` and therefore no
`this`-proxy to hang an Options API on.

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

| Member | Default | Vue counterpart | Notes |
| --- | --- | --- | --- |
| `Name` | `null` | `name` | Display name used in dev warnings. When null, warnings fall back to the definition's C# type name. |
| `Properties` | `null` | [`props`](https://vuejs.org/guide/components/props.html) | Precomputed metadata. Null declares no props, so every vnode prop falls through as an attribute. |
| `Emits` | `null` | [`emits`](https://vuejs.org/guide/components/events.html) | Declared events' handler props are excluded from attribute fallthrough. |
| `InheritAttributes` | `true` | [`inheritAttrs`](https://vuejs.org/guide/components/attrs.html) | When false, undeclared attributes are not applied to the root element — forward them yourself from `context.Attributes`. |
| `Setup` | — | `setup(props, context)` | The only required member. Runs **once** per instance and **returns** the render function. |

Only `Setup` must be implemented; the other four are default interface members.

### The `Setup` contract

- **Runs exactly once per instance** — with the instance current and inside its `EffectScope`. It is
  not re-entered on update.
- **Returns the render function** — `Func<VirtualNode?>`. That delegate re-executes on every update.
  There is no `Render` member on the interface.
- **The closure is the state object** — refs and computeds captured by the returned lambda are what
  Vue would have exposed through the `this`-proxy. There is no `this`, no `data`/`methods`/`computed`
  options, and no Options API anywhere in Viu.
- **Registration is synchronous** — `Lifecycle.*`, `DependencyInjection.Provide`/`Inject`, and
  `ViuWatch.*` bind to `ComponentInstance.Current`, so they must be called during `Setup`, not inside
  the returned render function.

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
        new ComponentPropertyDefinition("start") { DefaultValue = 0 },
    ];

    public IReadOnlyList<ComponentEmitDefinition>? Emits =>
    [
        new ComponentEmitDefinition("change"),
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        // Runs once. Everything below is captured by the returned render function.
        var count = Reactive.Reference(properties.Get<int>("start"));

        void Increment()
        {
            count.Value++;
            context.Emit("change", count.Value);
        }

        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(("onClick", (Action)Increment)),
            $"count is {count.Value}");
    }
}
```

Mutating `count.Value` schedules one re-render of the returned closure; `Setup` never runs again.

## `ComponentProperties`

The instance's shallow-reactive props — the port of Vue's `props` object. Reads track **per prop
name**, so a parent patch that changes one value triggers exactly the effects that read it.

```csharp
public sealed class ComponentProperties
{
    public object? this[string name] { get; }
    public T? Get<T>(string name);
    public bool Contains(string name);
    public void Set(string name, object? value);
}
```

- **`this[name]`** — returns `null` for an absent prop; it never throws.
- **`Get<T>(name)`** — returns `default` when the prop is absent **and** when it holds a value of a
  different type. There is no cast exception; a type mismatch is indistinguishable from a miss.
- **`Contains(name)`** — use this to tell "absent" from "present but `null`/default".
- **`Set(name, value)`** — does **not** set anything. It only emits the one-way-data-flow dev
  warning, matching Vue's refusal to let a child mutate its own props.

Instances are constructed only by the runtime and handed to `Setup`.

## `ComponentPropertyDefinition`

Precomputed metadata for one declared prop — written by hand or emitted by the `.viu` source
generator, never discovered by reflection (the AOT contract forbids it).

```csharp
public sealed class ComponentPropertyDefinition
{
    public ComponentPropertyDefinition(string name);

    public string Name { get; }
    public string? KebabName { get; }
    public object? DefaultValue { get; init; }
    public Func<object?>? DefaultFactory { get; init; }
    public bool Required { get; init; }
    public Func<object?, bool>? Validator { get; init; }
}
```

- **`Name`** — the camelCase name. Props resolve by either `Name` or `KebabName`.
- **`KebabName`** — auto-derived by hyphenation; `null` when it would equal `Name`.
- **`DefaultValue`** / **`DefaultFactory`** — `DefaultFactory` wins when both are set, and is invoked
  per instance rather than shared, so reference-typed defaults are never shared across instances. It
  is not re-run while its default is already in place; it runs again only when the parent withdraws a
  prop it had previously supplied.
- **`Required`** — a missing required prop produces a dev warning; it is not an exception.
- **`Validator`** — returning `false` produces a dev warning naming the component and the prop. The
  value is still applied.

```csharp
public IReadOnlyList<ComponentPropertyDefinition>? Properties =>
[
    new ComponentPropertyDefinition("label") { DefaultValue = "fallback" },
    new ComponentPropertyDefinition("items") { DefaultFactory = () => new List<string>() },
    new ComponentPropertyDefinition("amount") { Required = true },
    new ComponentPropertyDefinition("currency") { Validator = value => value is "USD" or "EUR" },
];
```

See [Props & Fallthrough Attributes](../guide/components/props.md) for the resolution rules in full.

## `ComponentEmitDefinition`

Metadata for one declared emitted event.

```csharp
public sealed class ComponentEmitDefinition
{
    public ComponentEmitDefinition(string name);

    public string Name { get; }
    public Func<object?[], bool>? Validator { get; init; }
}
```

- **`Name`** — the event name as emitted, e.g. `"change"`, `"item-selected"`, `"update:modelValue"`.
- **`Validator`** — receives the whole payload array; `false` produces a dev warning.

Declaring an event has a second effect: its handler prop (`onChange` for `"change"`) is removed from
attribute fallthrough, so it will not also land on the root element.

## `ComponentSetupContext`

The second argument to `Setup` — the port of Vue's
[setup context](https://vuejs.org/api/composition-api-setup.html#setup-context).

```csharp
public sealed class ComponentSetupContext
{
    public ComponentAttributes Attributes { get; }
    public ComponentSlots? Slots { get; }

    public void Emit(string eventName, params object?[] arguments);
    public void Expose(object? exposed);
}
```

- **`Attributes`** — note the whole-word name. Viu spells this `Attributes`, not `attrs`.
- **`Slots`** — **nullable**. It is `null` when the parent passed no slot content, so always
  null-check or pass it straight to `VirtualNodeFactory.RenderSlot`, which accepts null.
- **`Emit`** — dispatches to the matching `onXxx` handler prop. Handler props must be `Action`,
  `Action<object?>`, or `Action<object?[]>`; any other delegate shape produces a dev warning and is
  **not invoked**.
- **`Expose`** — restricts what a parent template ref sees. After exposing, only the exposed object is
  surfaced; without it a component ref receives the `ComponentInstance` itself.

```csharp
public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    var input = Reactive.Reference<object?>(null);

    context.Expose(new { Focus = (Action)(() => { /* … */ }) });

    return () => VirtualNodeFactory.Element(
        "input",
        VirtualNodeFactory.Properties(("ref", input)));
}
```

## `ComponentAttributes`

The instance's live fallthrough attributes: undeclared vnode props, minus declared emits' handler
props, minus the reserved names. The owner replaces the contents on every parent patch, so the same
object always reflects the latest values — cache the object, not a snapshot of its entries.

```csharp
public sealed class ComponentAttributes
{
    public int Count { get; }
    public object? this[string name] { get; }
    public bool Contains(string name);
    public Dictionary<string, object?>.Enumerator GetEnumerator();
}
```

Forwarding attributes manually, with `InheritAttributes` turned off:

```csharp
public sealed class Field : IComponentDefinition
{
    public bool InheritAttributes => false;

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        return () =>
        {
            var forwarded = new VirtualNodeProperties(context.Attributes.Count + 1);
            forwarded.Set("class", "field__input");

            foreach (var attribute in context.Attributes)
            {
                forwarded.Set(attribute.Key, attribute.Value);
            }

            return VirtualNodeFactory.Element(
                "label",
                VirtualNodeFactory.Element("input", forwarded));
        };
    }
}
```

## `ComponentSlots`

A component's slots object — a name-to-`Slot` map plus the stability flag Vue keeps on the hidden `_`
property.

```csharp
public sealed class ComponentSlots
{
    public ComponentSlots();
    public ComponentSlots(SlotFlags flag);

    public SlotFlags Flag { get; set; }
    public int Count { get; }
    public Slot? this[string name] { get; set; }
    public bool Contains(string name);
    public bool TryGetSlot(string name, [NotNullWhen(true)] out Slot? slot);
}
```

Setting the indexer to `null` removes the slot. The default `Flag` is `SlotFlags.Stable`.

### `Slot`

```csharp
public delegate VirtualNode?[]? Slot(object? properties);
```

A single named slot: a plain delegate producing vnodes on demand and capturing its defining render
context. `properties` carries the child-supplied scope for a scoped slot; a non-scoped slot ignores
it. Returning `null` or an empty array renders nothing — which is what triggers fallback content.

```csharp
var slots = new ComponentSlots
{
    ["default"] = _ => [VirtualNodeFactory.Element("span", "provided")],
};

var child = new Card();   // the component defined in the next snippet

// Only "default" is supplied, so the child's "header" outlet renders its fallback.
var node = VirtualNodeFactory.Component(child, null, slots);
```

Consuming them inside the child, with fallback content:

```csharp
public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    return () => VirtualNodeFactory.Element(
        "div",
        VirtualNodeFactory.RenderSlot(
            context.Slots, "header", null, () => [VirtualNodeFactory.Element("h1", "fb-header")]),
        VirtualNodeFactory.RenderSlot(
            context.Slots, "default", null, () => [VirtualNodeFactory.Element("em", "fb-default")]));
}
```

A scoped slot receives whatever the child passes as the third argument:

```csharp
// Child:
VirtualNodeFactory.RenderSlot(context.Slots, "default", row);

// Parent:
["default"] = scope => [VirtualNodeFactory.Element("span", ((Row)scope!).Title)],
```

### `SlotFlags`

Declared in `Assimalign.Viu.Shared`.

```csharp
public enum SlotFlags
{
    Stable = 1,
    Dynamic = 2,
    Forwarded = 3,
}
```

| Value | Meaning |
| --- | --- |
| `Stable` | The default. The slot's shape never changes, so a parent-only re-render does **not** force the child to re-render. Safe because a slot's reactive reads are still tracked by the consuming child. |
| `Dynamic` | The slot set can change structurally (`v-if`, `v-for`, or a dynamic slot name), so a parent re-render must force the child to update. |
| `Forwarded` | The slots were passed through from another component. Resolved to `Stable` or `Dynamic` at vnode creation, against the forwarding component's own slot stability. |

`PatchFlags.DynamicSlots` on the component vnode forces the child update regardless of this flag.
See [Slots](../guide/components/slots.md).

## `ComponentInstance`

A mounted component's runtime state — the port of Vue's `ComponentInternalInstance`. The public
surface is read-only observation; everything the renderer mutates is internal.

```csharp
public sealed class ComponentInstance
{
    public static ComponentInstance? Current { get; }

    public int Uid { get; }
    public IComponentDefinition Definition { get; }
    public ComponentInstance? Parent { get; }
    public ComponentInstance Root { get; }
    public EffectScope Scope { get; }
    public ComponentProperties Properties { get; }
    public ComponentAttributes Attributes { get; }
    public ComponentSlots? Slots { get; }
    public object? Exposed { get; }
    public VirtualNode VirtualNode { get; }
    public VirtualNode? Subtree { get; }
    public bool IsMounted { get; }
    public bool IsUnmounted { get; }
}
```

| Member | Vue counterpart | Notes |
| --- | --- | --- |
| `Current` | `getCurrentInstance()` | The active-instance stack top. Non-null only during `Setup`, a render, or a lifecycle/directive hook — and restored correctly when one of those throws. |
| `Uid` | `uid` | Monotonic creation id. Also the scheduler job id, which is what makes parents update before children. |
| `Definition` | the component object | The `IComponentDefinition` this instance was created from. |
| `Parent` / `Root` | `parent` / `root` | Tree links. `Root` is the instance itself for an application root. |
| `Scope` | `scope` | The instance's `EffectScope` (`Assimalign.Viu.Reactivity`). Watchers and effects created in `Setup` join it and stop on unmount. |
| `Properties` | `props` | Same object handed to `Setup`. |
| `Attributes` | `attrs` | Same object exposed as `context.Attributes`. |
| `Slots` | `slots` | Nullable, as on the setup context. |
| `Exposed` | `exposed` | Whatever `context.Expose` surfaced, or `null`. |
| `VirtualNode` | `vnode` | The component vnode that created this instance. |
| `Subtree` | `subTree` | The vnode the render function last produced. |
| `IsMounted` / `IsUnmounted` | `isMounted` / `isUnmounted` | Lifecycle state. |

Note the whole-word naming: `Properties` not `props`, `Attributes` not `attrs`, `Subtree` not
`subTree`, `VirtualNode` not `vnode`. See
[Differences from Vue 3](../roadmap/vue-differences.md) for the full naming map.

## `Lifecycle`

Composition API lifecycle registration — the port of Vue's
[lifecycle hooks](https://vuejs.org/api/composition-api-lifecycle.html). Every method binds to
`ComponentInstance.Current`, so all of them must be called during `Setup`; with no active instance a
dev warning fires and the registration is ignored.

```csharp
public static class Lifecycle
{
    public static void OnBeforeMount(Action hook);
    public static void OnMounted(Action hook);
    public static void OnBeforeUpdate(Action hook);
    public static void OnUpdated(Action hook);
    public static void OnBeforeUnmount(Action hook);
    public static void OnUnmounted(Action hook);
    public static void OnErrorCaptured(Func<Exception, ComponentInstance?, string, bool> hook);
    public static void OnServerPrefetch(Func<Task> hook);
    public static void OnActivated(Action hook);
    public static void OnDeactivated(Action hook);
}
```

| Hook | Vue counterpart | Fires | Status |
| --- | --- | --- | --- |
| `OnBeforeMount` | `onBeforeMount` | Synchronously, before the subtree is inserted. Parent before child. | Implemented |
| `OnMounted` | `onMounted` | Post-flush, after insertion. **Child before parent.** | Implemented |
| `OnBeforeUpdate` | `onBeforeUpdate` | Synchronously, before the subtree is patched. | Implemented |
| `OnUpdated` | `onUpdated` | Post-flush, after the patch. | Implemented |
| `OnBeforeUnmount` | `onBeforeUnmount` | Synchronously, before teardown. | Implemented |
| `OnUnmounted` | `onUnmounted` | Post-flush, after teardown. | Implemented |
| `OnErrorCaptured` | `onErrorCaptured` | On a descendant error. Return `false` to **stop** propagation. | Implemented |
| `OnActivated` | `onActivated` | Never — registration works and the hook is stored, but nothing invokes it because `KeepAlive` does not exist. | Registered, never invoked |
| `OnDeactivated` | `onDeactivated` | Never, for the same reason. | Registered, never invoked |
| `OnServerPrefetch` | `onServerPrefetch` | Never — the hook is stored, but there is no server renderer to await it. | Registered, never invoked |

Hooks run in registration order with the instance current, wrapped in error handling that routes
through the `OnErrorCaptured` chain.

```csharp
public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    var events = new List<string>();

    Lifecycle.OnBeforeMount(() => events.Add("beforeMount"));
    Lifecycle.OnMounted(() => events.Add("mounted"));
    Lifecycle.OnBeforeUpdate(() => events.Add("beforeUpdate"));
    Lifecycle.OnUpdated(() => events.Add("updated"));
    Lifecycle.OnBeforeUnmount(() => events.Add("beforeUnmount"));
    Lifecycle.OnUnmounted(() => events.Add("unmounted"));

    Lifecycle.OnErrorCaptured((exception, instance, info) =>
    {
        Console.Error.WriteLine($"{info}: {exception.Message}");
        return false;   // handled here — do not propagate to ancestors or the app handler
    });

    return static () => VirtualNodeFactory.Element("span", "c");
}
```

Mounting a parent whose subtree contains a child produces exactly this order — `beforeMount` parent
first, `mounted` child first:

```text
parent:beforeMount
child:beforeMount
child:mounted
parent:mounted
```

The `mounted` inversion comes from the scheduler: post-flush callbacks with equal ids keep insertion
order, and children are queued after their parents.

`OnActivated`, `OnDeactivated`, and `OnServerPrefetch` are listed here because they compile and
register cleanly — which is exactly why their inertness must be documented. See
[KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md).

## Behavior notes

These are the traps that belong with the API rather than the guide.

- **`ComponentProperties.Set` never sets** — it exists only to emit the one-way-data-flow dev
  warning. To change a prop, emit an event and let the parent change it.
- **`Get<T>` collapses two failures into one** — `default` is returned both when the prop is absent
  and when it holds a value of another type. Use `Contains` when the distinction matters.
- **Reserved prop names are never patched to the platform** — `"key"`, `"ref"`, and any name starting
  with `"onVnode"`. `"key"` and `"ref"` are extracted onto `VirtualNode.Key` and
  `VirtualNode.Reference` at vnode creation, but they **remain in the prop bag**, so a manual scan of
  props will still see them.
- **A `"ref"` prop must be an `IReference<object?>` or an `Action<object?>`** — string template refs
  are intentionally not ported, because they would require a component instance proxy. Any other
  value produces a dev warning and is treated as no ref.
- **A component ref falls back to the instance** — with no `Expose` call, a component `ref` receives
  the `ComponentInstance` itself. With `Expose`, only the exposed object is surfaced.
- **`OnErrorCaptured` returns `false` to stop propagation** — this inverts the intuitive reading.
  Returning `true`, or letting the error escape, lets it continue to ancestors and the app handler.
- **The error walk starts at `Parent`** — an instance's own `OnErrorCaptured` hooks never capture its
  own errors, only a descendant's.
- **`ApplicationConfiguration.ErrorHandler` changes the terminal behavior** — when it is **set**, it
  is the terminal sink: the error is delivered to it and **not** rethrown. When it is **null**, an
  error no `OnErrorCaptured` stopped rethrows to the host with its original stack. Both halves matter
  when deciding whether a failure will be visible.
- **Setup and render errors carry an `info` string** — the runtime passes `"setup function"`,
  `"render function"`, `"{kind} hook"` (e.g. `"Mounted hook"`), `"event handler for \"{name}\""`,
  `"directive hook"`, `"template ref function"`, `"watcher callback"`, and `"watcher getter"`.
- **Warnings identify unnamed components by C# type name** — set `Name` on any definition you expect
  to debug.
- **A direct `Renderer<TNode>.Render` call drains the scheduler before returning** — lifecycle hooks,
  directive hooks, and template refs are observable immediately after it. Reactive updates, by
  contrast, wait for a flush.

## Not yet implemented

- **Functional components** — `ShapeFlags.FunctionalComponent` exists in `Assimalign.Viu.Shared`, but
  the component vnode factory always sets `StatefulComponent`. There is no functional-component path.
- **Async components** — there is no `defineAsyncComponent` equivalent anywhere.
- **`app.mixin`** — mixins are not ported and will not be; compose with
  [composables](../guide/reusability/composables.md) instead.
- **`app.config.globalProperties`** — deliberately excluded, because it requires a `Proxy`. The
  sanctioned replacement is typed app-level provide plus inject; see
  [Provide / Inject](../guide/components/provide-inject.md).
- **`onRenderTracked` / `onRenderTriggered`** — no debug hooks exist.
- **SSR and hydration** — `OnServerPrefetch` registers, but there is no server renderer.

## See also

- [Components](../guide/essentials/components.md) — the guide chapter this page is the reference for.
- [Props & Fallthrough Attributes](../guide/components/props.md)
- [Component Events](../guide/components/events.md)
- [Slots](../guide/components/slots.md)
- [Lifecycle Hooks & Template Refs](../guide/essentials/lifecycle-and-template-refs.md)
- [Application API](application.md) — `Application<TNode>`, `ApplicationConfiguration`, plugins.
- [Render Functions & VirtualNode](render-function.md) — `VirtualNodeFactory` and `RenderHelpers`.
- [Reactivity API: Core](reactivity-core.md) — `Reference<T>`, `Computed<T>`, `EffectScope`.
