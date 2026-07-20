# Props & Fallthrough Attributes

How a component declares the inputs it accepts, how it reads them, and what happens to the
attributes it did not declare.

> **Status:** Implemented.

A parent passes data down by writing props onto a component vnode. Viu splits that prop bag in two:
names the component **declared** become its `ComponentProperties`, and everything left over becomes
its **fallthrough attributes**, which land on the rendered root element. This is the same split Vue
performs in [Props](https://vuejs.org/guide/components/props.html) and
[Fallthrough Attributes](https://vuejs.org/guide/components/attrs.html) — the difference is that Viu
computes it from metadata you write down rather than from a runtime-reflected object.

## Declaring props

Props are declared by returning a list of `ComponentPropertyDefinition` from
`IComponentDefinition.Properties`:

```csharp
IReadOnlyList<ComponentPropertyDefinition>? Properties => null;
```

`Properties` is a default interface member, so a component with no props simply omits it. The
declaration is **precomputed metadata, not discovered state**. Vue can inspect a `props` option at
runtime because JavaScript objects are introspectable; Viu cannot, because the framework is built to
run AOT-compiled and trimmed, where reflection over user types is forbidden. So the prop table is a
plain list you (or the source generator) hand to the runtime, and `ComponentPropertyResolution`
consults it directly — no `Type.GetProperties`, no attribute scanning, no dynamic activation. See
[AOT & Trimming](../best-practices/aot-and-trimming.md) for the full constraint.

Here is a real component — the elapsed-time display from the stopwatch example — declaring two props
and one emit:

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
                VirtualNodeFactory.Properties(("class", "meter-value")),
                VirtualNodeFactory.Text(properties.Get<string>("text") ?? "00:00:00")),
            VirtualNodeFactory.Element(
                "span",
                VirtualNodeFactory.Properties(("class", "status-pill")),
                VirtualNodeFactory.Text(properties.Get<bool>("running") ? "Running" : "Paused")),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(
                    ("class", "secondary"),
                    ("type", "button"),
                    ("onClick", (Action)(() => context.Emit("reset")))),
                VirtualNodeFactory.Text("Reset")));
}
```

The parent passes them by name on the component vnode:

```csharp
VirtualNodeFactory.Component(display, VirtualNodeFactory.Properties(
    ("text", elapsedText.Value),
    ("running", isRunning.Value),
    ("onReset", (Action)Reset)))
```

or, in a template, with the ordinary `v-bind` shorthand:

```viu
@template {
    <ElapsedDisplay :text="elapsed" :running="isRunning" @reset="Reset" />
}
```

> **Aspirational.** That template compiles — `:text` and `:running` become the `text` and `running`
> vnode props and `@reset` becomes an `onReset` prop, exactly as the C# above writes them by hand.
> But the `.viu` generator emits only `Render`, `RenderCacheSize`, `ScopeId`, `ExtractedStyles`,
> `ApplyCssVariables`, and CSS-module accessors into the partial class. It does **not** yet emit the
> `IComponentDefinition` implementation that binds `Render` to a `Setup` closure, and no end-to-end
> `.viu` example project ships in the Viu repo — so the hand-written C# form is the working path
> today. See [Single-File Components (.viu)](../scaling-up/single-file-components.md) and
> [Project Status](../../roadmap/status.md).

## `ComponentPropertyDefinition`

One definition describes one prop. `Name` is a constructor parameter and `KebabName` is derived from
it; every remaining member is an `init`-only property, so definitions are written as object
initializers inside a collection expression.

| Member | Type | Meaning |
| --- | --- | --- |
| `Name` | `string` | The camelCase prop name. Required; throws `ArgumentException` when null or empty. |
| `KebabName` | `string?` | The kebab-case equivalent, auto-derived — **not** settable. Null when it equals `Name`. |
| `DefaultValue` | `object?` | The value applied when the parent omits the prop. |
| `DefaultFactory` | `Func<object?>?` | A per-instance default factory. **Wins over `DefaultValue`.** |
| `Required` | `bool` | Omitting the prop produces a dev warning. It is a warning, not an error. |
| `Validator` | `Func<object?, bool>?` | Returning `false` produces a dev warning naming the component and prop. |

- **`KebabName` is derived, never declared** — the constructor runs `Name` through
  `StyleAndClassNormalization.Hyphenate` and stores the result only when it differs, so
  `new ComponentPropertyDefinition("modelValue")` gets `KebabName == "model-value"` while
  `new ComponentPropertyDefinition("label")` gets `null`. Both spellings resolve to the same
  declaration at patch time, matching Vue's camelCase/kebab-case equivalence.
- **Use `DefaultFactory` for reference and collection defaults** — a `DefaultValue` holding a
  `List<string>` would be shared by every instance of the component. `DefaultFactory` runs once per
  instance instead. It is Viu's counterpart to Vue's function-valued `default`.
- **Defaults are applied conservatively** — a default lands on the first resolve, or when the parent
  has just withdrawn a prop it previously supplied. A `DefaultFactory` is never re-run while its
  default is already in place, because a fresh instance every pass would spuriously re-render the
  child.
- **`Required` and `Validator` only warn** — neither throws, and a failed validator does not stop the
  value from being applied. Warnings go through the runtime warning sink, which
  `ApplicationConfiguration.WarnHandler` can intercept while the app is mounted.

```csharp
public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
[
    new ComponentPropertyDefinition("label") { DefaultValue = "fallback" },
    new ComponentPropertyDefinition("items") { DefaultFactory = () => new List<string>() },
    new ComponentPropertyDefinition("amount") { Required = true },
    new ComponentPropertyDefinition("currency") { Validator = value => value is "USD" or "EUR" },
];
```

The warnings those last two produce read exactly:

```text
Missing required prop: "amount" on component <PriceTag>.
Invalid prop: custom validator check failed for prop "currency" on component <PriceTag>.
```

The component name in a warning comes from `ComponentInstance.DisplayName`, which falls back to the
C# type name when `IComponentDefinition.Name` is null — so name your components if you want readable
diagnostics.

## Reading props

`Setup` receives the instance's `ComponentProperties` as its first argument. Two read forms are
available:

```csharp
object? raw = properties["text"];          // untyped, null when absent
string? text = properties.Get<string>("text");   // typed
bool running = properties.Get<bool>("running");
bool hasLabel = properties.Contains("label");
```

`ComponentProperties` is the port of Vue's `shallowReactive` props object. Reads **track per prop
name** — one dependency cell per name that was actually read — so a parent patch that changes one
prop triggers exactly the effects that read that prop. A child re-renders only when a prop it used
changed; a prop it ignores can churn freely.

`Get<T>` is the convenience path, and its failure mode is worth memorizing:

```csharp
public T? Get<T>(string name) => this[name] is T typed ? typed : default;
```

| Situation | `properties["x"]` | `properties.Get<int>("x")` | `properties.Get<string>("x")` |
| --- | --- | --- | --- |
| Prop absent | `null` | `0` | `null` |
| Prop present, matching type | the value | the value | the value |
| Prop present, **different type** | the value | `0` | `null` |

- **There is no cast exception** — `Get<T>` returns `default` both when the prop is absent and when
  it is present but of another type. A parent that passes `("count", "3")` where the child reads
  `Get<int>("count")` silently sees `0`. When that distinction matters, read the indexer and pattern
  match, or use `Contains` to separate "absent" from "wrong type".
- **Both casings resolve** — the declared-prop lookup is keyed by `Name` *and* `KebabName`, so a
  parent may write `("modelValue", x)` or `("model-value", x)` and the child reads `"modelValue"`
  either way. Always read by the camelCase `Name`; that is the key the value is stored under.

## Props are one-way

`ComponentProperties` exposes a `Set` method, and it is a trap for anyone who assumes it works:

```csharp
public void Set(string name, object? value)
    => RuntimeWarnings.Warn(
        $"Attempting to mutate prop \"{name}\" on component <{_componentName}>. Props are readonly — "
        + "use an emit to ask the owner to change it.");
```

**`Set` does not set anything.** It emits the one-way-data-flow dev warning and returns. The method
exists only so the mistake is diagnosable rather than a compile error against a read-only API — the
parent owns the value, and the child asks for a change by emitting. Viu has no equivalent of Vue's
dev-mode props proxy, so this method *is* the enforcement point.

To let a child drive a value, declare an emit and call `context.Emit(...)` — see
[Component Events](./events.md), or [Component v-model](./v-model.md) for the `modelValue` /
`update:modelValue` pairing that makes it two-way.

## Fallthrough attributes

Every prop on the component vnode that is **not** a declared prop, **not** a declared emit's handler
prop, and **not** a reserved name becomes a fallthrough attribute. That is Vue's `$attrs`, spelled
`ComponentAttributes` and reached through `ComponentSetupContext.Attributes` — note the whole-word
name, **not** `Attrs`.

```csharp
public sealed class ComponentAttributes
{
    public int Count { get; }
    public object? this[string name] { get; }
    public bool Contains(string name);
    public Dictionary<string, object?>.Enumerator GetEnumerator();
}
```

It is a **live view**: the owner replaces its contents on every parent patch, so the same object
always reflects the latest values. Unlike `ComponentProperties`, reads are **not** tracked — reading
an attribute inside a render does not subscribe you to it.

### Automatic fallthrough

`IComponentDefinition.InheritAttributes` (Vue's `inheritAttrs`, default `true`) controls whether the
runtime merges the attributes onto the rendered root:

```csharp
bool InheritAttributes => true;
```

The merge happens after the render function returns, and only when all three conditions hold:

| Condition | Why |
| --- | --- |
| `InheritAttributes` is `true` | The component opted in (the default). |
| `Attributes.Count > 0` | There is something to merge. |
| The normalized root is a `VirtualNodeType.Element` vnode | Only a single element root can carry them. |

When they hold, the root is cloned with the attributes merged in through
`VirtualNodeFactory.MergeProperties`, which follows Vue's `mergeProps` rules rather than blindly
overwriting:

- **`class`** — strings concatenate space-separated. A root with `class="btn"` receiving
  `class="danger"` renders `class="btn danger"`.
- **`style`** — strings join with `";"`; dictionaries merge later-wins.
- **`onX` handlers** — chain into a multicast delegate via `Delegate.Combine`, so the root's own
  handler *and* the parent's both run.
- **Everything else** — later-wins, meaning the fallthrough attribute overwrites the root's value.

If the root is a fragment, a text node, or a component vnode, nothing is merged and the attributes
are simply dropped. Viu emits **no** warning in that case, where Vue warns about extraneous
non-prop attributes — so a mis-targeted `class` on a multi-root component fails silently. Handle it
explicitly with `InheritAttributes => false` and a manual forward.

### Manual fallthrough

Turn the automatic merge off and place the attributes yourself when the root is not the element that
should receive them:

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.RuntimeCore;

internal sealed class LabeledInput : IComponentDefinition
{
    public string? Name => "LabeledInput";

    // The wrapper <label> is the root, but id/placeholder/onInput belong on the <input>.
    public bool InheritAttributes => false;

    public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
    [
        new ComponentPropertyDefinition("label") { Required = true },
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => () =>
        {
            var inputProperties = new VirtualNodeProperties(context.Attributes.Count + 1);
            inputProperties.Set("type", "text");
            foreach (var (name, value) in context.Attributes)
            {
                inputProperties.Set(name, value);
            }

            return VirtualNodeFactory.Element(
                "label",
                VirtualNodeFactory.Properties(("class", "field")),
                VirtualNodeFactory.Element("span", properties.Get<string>("label") ?? string.Empty),
                VirtualNodeFactory.Element("input", inputProperties));
        };
}
```

Because `Attributes` is a live view, rebuilding the bag inside the render closure — rather than
capturing it once in `Setup` — is what keeps forwarded values current across patches.

## Reserved prop names

Three names are reserved. `ComponentPropertyResolution` skips them entirely, so they never become
declared props and never become fallthrough attributes, and the renderer never patches them to the
platform:

| Name | Handling |
| --- | --- |
| `"key"` | Extracted onto `VirtualNode.Key` at vnode creation; drives keyed reconciliation. |
| `"ref"` | Extracted onto `VirtualNode.Reference` as a `TemplateReference`. |
| Anything starting with `"onVnode"` | A `VirtualNodeHook` — six recognized names, from `onVnodeBeforeMount` to `onVnodeUnmounted`. |

The subtlety worth knowing: `"key"` and `"ref"` are extracted onto the vnode **but remain in the
prop bag**. If you enumerate `VirtualNode.Properties` yourself you will still see them; the runtime
filters them at every consumption point instead of removing them at creation. A `"ref"` value must be
an `IReference<object?>` or an `Action<object?>` — string template refs are deliberately not ported,
and any other value produces a dev warning and is treated as no ref. See
[Lifecycle Hooks & Template Refs](../essentials/lifecycle-and-template-refs.md).

## The `"value"` prop is special-cased

`"value"` is the one prop name the renderer treats out of band, in two places, for upstream parity:

- **On mount it is patched last.** The mount loop skips `"value"` while patching every other prop,
  then patches it after the loop finishes. This matters because the correct interpretation of a
  value depends on state that must already be in place — an `<input>`'s `type`, and a `<select>`'s
  mounted `<option>` children.
- **On a full prop diff it is always re-patched, with no equality skip.** Every other prop is
  compared against the previous vnode and skipped when equal. `"value"` is written unconditionally,
  because the *live* platform value can drift from the vnode value — a user typing into an input
  changes the DOM without changing the previous vnode, so an equality check against the vnode would
  wrongly conclude nothing needs writing.
- **Under `PatchFlags.Props` it is force-patched too.** In the targeted dynamic-props path the guard
  is `!Equals(previousValue, nextValue) || string.Equals(name, "value", StringComparison.Ordinal)`,
  so a compiler-marked dynamic `value` never gets skipped either.

On the browser, `"value"` also lands differently depending on the tag: `BrowserPropertyPatcher` sets
it as an IDL **property** only on `input`, `textarea`, and `select`, and as an **attribute**
everywhere else (including `progress`). Null becomes the empty string rather than removing anything.

## Vue counterparts

| Vue | Viu | Note |
| --- | --- | --- |
| `props` option | `IComponentDefinition.Properties` | Precomputed metadata, never reflected. |
| `props.foo` | `properties["foo"]` / `properties.Get<T>("foo")` | Tracked per name. |
| `inheritAttrs` | `IComponentDefinition.InheritAttributes` | Same default (`true`). |
| `$attrs` / `useAttrs()` | `ComponentSetupContext.Attributes` | Whole-word `Attributes`, not `Attrs`. |
| `mergeProps` | `VirtualNodeFactory.MergeProperties` | Same class/style/handler rules. |
| `default: () => []` | `DefaultFactory` | Wins over `DefaultValue`. |
| `defineProps` | — | No equivalent; see below. |

## Not yet implemented

- **No `defineProps` / macro-declared props.** The `.viu` source generator emits only `Render`,
  `RenderCacheSize`, `ScopeId`, `ExtractedStyles`, `ApplyCssVariables`, and CSS-module accessors into
  the partial class. A prop table in a single-file component is therefore hand-written C# in the
  `@script` block or a sibling partial, exactly as shown above. See
  [Single-File Components (.viu)](../scaling-up/single-file-components.md).
- **No prop type declarations and no coercion.** `ComponentPropertyDefinition` carries no `Type`, so
  there is no runtime type check, no Vue-style Boolean casting (an absent boolean prop is `null`, not
  `false`, unless you give it a `DefaultValue`), and no type-based dev warning. `Validator` is the
  only per-value check available.
- **No extraneous-attribute warning.** When fallthrough cannot apply because the root is not a single
  element, the attributes are dropped without a diagnostic.
- **No `useAttrs()`-style standalone accessor.** Attributes are reachable only through the
  `ComponentSetupContext` handed to `Setup`, or through `ComponentInstance.Attributes`.

Related reading: [Components](../essentials/components.md) for the `Setup`-returns-render model,
[Component Events](./events.md) for the emit half of the contract,
[Component API](../../api/component.md) for the full signatures, and
[Differences from Vue 3](../../roadmap/vue-differences.md) for the naming map.
