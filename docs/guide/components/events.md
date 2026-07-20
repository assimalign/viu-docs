# Component Events

How a child component raises an event with `Emit`, how it declares that event, and how a parent
handles it.

> **Status:** Implemented.

Viu's component events are a port of Vue's [component events](https://vuejs.org/guide/components/events.html).
A child raises an event by name; the runtime turns that name into a prop name and invokes whatever
delegate the parent passed under it. The whole mechanism is `ComponentSetupContext.Emit` plus a
naming rule — there is no event bus, no `$emit` on a `this`-proxy, and the dispatch itself is a
`switch` over delegate types rather than a reflective invoke.

## Emitting an event

`ComponentSetupContext` is the second argument to `IComponentDefinition.Setup`. Its `Emit` method
takes the event name and a payload:

```csharp
public void Emit(string eventName, params object?[] arguments);
```

Because `Setup` runs exactly once and returns the render function, you capture `context` in the
closure and call `Emit` from wherever the event originates — a DOM handler, a watcher callback, a
lifecycle hook:

```csharp
using System;
using System.Collections.Generic;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

public sealed class StepButton : IComponentDefinition
{
    public string? Name => "StepButton";

    public IReadOnlyList<ComponentEmitDefinition>? Emits =>
    [
        new ComponentEmitDefinition("step"),
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var pressed = Reactive.Reference(0);

        void OnClick(BrowserEvent browserEvent)
        {
            pressed.Value++;
            context.Emit("step", pressed.Value);
        }

        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(("onClick", (Action<BrowserEvent>)OnClick)),
            $"stepped {pressed.Value}x");
    }
}
```

Note the two different delegate worlds already visible in that snippet: the native `onClick` prop
takes an `Action<BrowserEvent>`, while the `"step"` event the parent handles takes one of three
other shapes. That distinction is the single easiest thing to get wrong, and it is spelled out in
[Native DOM events versus component events](#native-dom-events-versus-component-events) below.

## Declaring events

Declare the events a component raises by returning a list of `ComponentEmitDefinition` from
`IComponentDefinition.Emits`. Like `Properties`, this is precomputed metadata rather than something
discovered by scanning the type, because reflection is unavailable under AOT and trimming.

```csharp
public sealed class ComponentEmitDefinition
{
    public ComponentEmitDefinition(string name);
    public string Name { get; }
    public Func<object?[], bool>? Validator { get; init; }
}
```

Declaring is optional but strongly recommended:

- **Undeclared events still dispatch** — if `Emits` is `null` or empty, no declaration check runs at
  all and every `Emit` call is routed normally.
- **Declared events are validated** — once `Emits` is non-empty, emitting a name that is *not* in the
  list produces a dev warning. `StepButton` above declares only `"step"`, so a stray
  `context.Emit("reset")` warns: `Component <StepButton> emitted event "reset" but it is not declared
  in the Emits option.`
- **Declared events are excluded from attribute fallthrough** — a declared event's handler prop
  (`onStep`, and its `onStepOnce` variant) is removed from `ComponentSetupContext.Attributes`, so it
  never lands on the root element as a stray attribute. See
  [Props & Fallthrough Attributes](./props.md). **This exclusion does not camelize.**
  `ComponentInstance.IsDeclaredEmitHandlerName` runs `ToHandlerPropertyName` over the declared name
  only, so declaring `"limit-reached"` produces the exclusion key `onLimit-reached` — and the
  `onLimitReached` prop the parent actually passes is *not* excluded, so it falls through onto the
  root element. Declare in camelCase (`"limitReached"`) if you need the exclusion; the emit-side
  camelization retry below is unaffected either way.
- **The declaration lookup is exact and ordinal** — the name you emit must match the name you
  declared character for character. Declaring `"itemSelected"` and emitting `"item-selected"` warns
  as undeclared, even though the *handler* lookup would still find `onItemSelected`.

### Validators

`ComponentEmitDefinition.Validator` is a `Func<object?[], bool>` that receives the entire payload
array, not a single argument. Returning `false` produces the dev warning
`Invalid event arguments: event validation failed for event "{name}".` — it does not throw, and it
does not suppress the dispatch.

```csharp
public IReadOnlyList<ComponentEmitDefinition>? Emits =>
[
    new ComponentEmitDefinition("submit")
    {
        Validator = arguments => arguments is [string email, ..] && email.Contains('@'),
    },
    new ComponentEmitDefinition("cancel"),
];
```

## The name mapping

An emitted event name is converted to a handler prop name by `ComponentInstance.ToHandlerPropertyName`,
which is upstream's `toHandlerKey`: prefix `on`, then upper-case the first character of the event
name. If that lookup misses, the runtime retries with the name camelized first, so a kebab-case event
matches a camelCase handler exactly as it does in Vue.

| Emitted name | Handler prop tried first | Fallback after camelization | Once variant |
|---|---|---|---|
| `change` | `onChange` | `onChange` | `onChangeOnce` |
| `item-selected` | `onItem-selected` | `onItemSelected` | `onItemSelectedOnce` |
| `update:modelValue` | `onUpdate:modelValue` | `onUpdate:modelValue` | `onUpdate:modelValueOnce` |
| `close` | `onClose` | `onClose` | `onCloseOnce` |

Both name-mapping helpers are memoized in a static cache, so the conversion cost is paid once per
distinct event name for the lifetime of the process.

## Handler delegate shapes

**This is the constraint that fails silently if you get it wrong.** `ComponentInstance` dispatches an
emit by pattern-matching the stored delegate against exactly three shapes. Anything else produces a
dev warning and the handler is **not invoked**:

| Handler type | Receives | Use when |
|---|---|---|
| `Action` | nothing | The event is a pure notification (`cancel`, `close`) |
| `Action<object?>` | `arguments[0]`, or `null` if the payload is empty | The event carries one value — the common case |
| `Action<object?[]>` | the whole payload array | The event carries several values |
| *anything else* | — | **never** — warns and does nothing |

The warning text names the offending delegate's runtime type name and then lists the three supported
shapes. It goes to `RuntimeWarnings`, which is a `Debug.WriteLine` trace unless the application
installed an `ApplicationConfiguration.WarnHandler` — meaning in a Release WASM build you see nothing
at all. Cast deliberately at the call site:

```csharp
// Correct — an explicit cast pins the delegate type.
VirtualNodeFactory.Component(
    child,
    VirtualNodeFactory.Properties(
        ("onStep",   (Action<object?>)(value => total.Value += (int)(value ?? 0))),
        ("onMove",   (Action<object?[]>)(arguments => Move((int)arguments[0]!, (int)arguments[1]!))),
        ("onCancel", (Action)(() => open.Value = false))));
```

In a template, prefer a **method reference** over an inline expression for component events. A method
group binds cleanly — `void OnStep(object? value)` target-types to `Action<object?>`, and
`void OnCancel()` to `Action` — whereas an inline value expression such as `@step="total++"` is
emitted by the compiler as `__event => (…)` and target-types through
`RenderHelpers._withHandler(Func<object?, object?>)`, which is not one of the three shapes the emit
dispatcher recognises.

## Payload behavior

`Emit` takes `params object?[]`, and the three handler shapes unpack it differently:

```csharp
context.Emit("change");            // Action → invoked. Action<object?> → receives null.
context.Emit("change", 42);        // Action<object?> → receives 42 (boxed int).
context.Emit("move", 3, 4);        // Action<object?[]> → receives new object?[] { 3, 4 }.
                                   // Action<object?> → receives only 3; the 4 is dropped.
```

Payload values are boxed into `object?`, so a handler unboxes to the type it expects. Nothing checks
that type for you — a wrong cast throws inside the handler, and that exception is caught and routed
through the [error pipeline](#errors-inside-a-handler) below rather than propagating directly. Note
that "routed" is not "swallowed": if no `OnErrorCaptured` hook stops it and no
`ApplicationConfiguration.ErrorHandler` is set, `ComponentErrorHandling` rethrows it with its
original stack — at which point it *does* surface at the caller of `Emit`.

## Once handlers

A prop named `onXxxOnce` fires **exactly once per component instance, across every re-render**. The
instance tracks which once-handlers have already fired in a private set, so replacing the delegate on
a later render does not re-arm it.

```csharp
VirtualNodeFactory.Component(
    dialog,
    VirtualNodeFactory.Properties(
        ("onOpenOnce", (Action)(() => Analytics.Track("dialog-first-open")))));
```

The once channel is independent of the plain channel: if both `onOpen` and `onOpenOnce` are present,
`Emit("open")` invokes `onOpen` on every emit and `onOpenOnce` on the first one only. The once name
is derived from whichever handler name the lookup resolved to, so a kebab-case event finds
`onItemSelectedOnce` after the camelization retry.

## A parent and child, end to end

The child owns nothing about the parent's state — it reports, the parent decides.

```csharp
using System;
using System.Collections.Generic;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

public sealed class QuantityPicker : IComponentDefinition
{
    public string? Name => "QuantityPicker";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties =>
    [
        new ComponentPropertyDefinition("quantity") { DefaultValue = 0 },
        new ComponentPropertyDefinition("max") { DefaultValue = 10 },
    ];

    public IReadOnlyList<ComponentEmitDefinition>? Emits =>
    [
        new ComponentEmitDefinition("change")
        {
            Validator = arguments => arguments is [int value] && value >= 0,
        },
        new ComponentEmitDefinition("limit-reached"),
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        void Adjust(int delta)
        {
            var current = properties.Get<int>("quantity");
            var max = properties.Get<int>("max");
            var next = Math.Clamp(current + delta, 0, max);

            if (next == current)
            {
                context.Emit("limit-reached");
                return;
            }

            context.Emit("change", next);
        }

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", "quantity-picker")),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", (Action)(() => Adjust(-1)))),
                "-"),
            VirtualNodeFactory.Element("span", properties.Get<int>("quantity").ToString()),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", (Action)(() => Adjust(+1)))),
                "+"));
    }
}
```

The parent holds the state, passes it down as a prop, and updates it from the handler:

```csharp
public sealed class CartLine : IComponentDefinition
{
    private static readonly QuantityPicker Picker = new();

    public string? Name => "CartLine";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var quantity = Reactive.Reference(1);
        var warning = Reactive.Reference<string?>(null);

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Component(
                Picker,
                VirtualNodeFactory.Properties(
                    ("quantity", quantity.Value),
                    ("max", 5),
                    ("onChange", (Action<object?>)(value =>
                    {
                        quantity.Value = (int)(value ?? 0);
                        warning.Value = null;
                    })),
                    ("onLimitReached", (Action)(() => warning.Value = "That is the limit.")))),
            VirtualNodeFactory.Element("p", warning.Value ?? string.Empty));
    }
}
```

Three details worth naming. `"limit-reached"` is declared kebab-case and handled as `onLimitReached` —
that is the camelization retry doing its job on the *dispatch* side. But as noted under
[Declaring events](#declaring-events), the *fallthrough-exclusion* side does not camelize, so
`onLimitReached` is not recognised as a declared emit's handler prop and will fall through onto the
picker's root `<div>`; declaring `"limitReached"` instead avoids that. And because `quantity` is a
plain prop, the child never mutates it; `ComponentProperties.Set` does not set anything, it only
emits the one-way-data-flow dev warning.

## The same pair as a `.viu` component

In a single-file component the `@script` block's C# is merged verbatim as class-body members of the
generated partial class, and the `@template` block compiles to a `Render` method on that same class.
Template-side, `@change="OnChange"` is exactly the `onChange` prop from the C# above.

```viu
@template {
  <div class="cart-line">
    <QuantityPicker
      :quantity="Quantity.Value"
      :max="5"
      @change="OnChange"
      @limit-reached="OnLimitReached" />
    <p v-if="Warning.Value is not null">{{ Warning.Value }}</p>
  </div>
}

@script {
using System;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

  public Reference<int> Quantity { get; } = Reactive.Reference(1);

  public Reference<string?> Warning { get; } = Reactive.Reference<string?>(null);

  public void OnChange(object? value)
  {
      Quantity.Value = (int)(value ?? 0);
      Warning.Value = null;
  }

  public void OnLimitReached() => Warning.Value = "That is the limit.";
}
```

`OnChange(object? value)` binds to `Action<object?>` and `OnLimitReached()` to `Action`, which is
precisely why method references are the recommended form for component events.

> **Aspirational:** the SFC generator today emits the compiled render body as
> `internal static object? Render(TComponent _ctx, object?[] _cache)` alongside the merged `@script`
> members (alongside a `RenderCacheSize` constant, and with the `@script` block's leading `using`
> directives hoisted above the namespace). It does **not** yet emit the `IComponentDefinition`
> implementation that binds that `Render` method to a `Setup` closure, so the pair above cannot be
> mounted as written — nothing calls `OnChange`. The one example app that ships in the Viu repo
> (`examples/Assimalign.Viu.WebApp`) is hand-written C# with no `.viu` files. The block syntax, the
> merge semantics, and the template compilation above are real; the automatic `Setup` wiring is the
> intended end state. See
> [Single-File Components](../scaling-up/single-file-components.md) and
> [Project Status](../../roadmap/status.md).

## Native DOM events versus component events

These two systems look identical in a template and share nothing underneath. `@click` on a `<button>`
goes to the browser's event invoker registry; `@click` on `<MyComponent>` becomes an `onClick` prop
that only fires if the child calls `context.Emit("click", …)`.

| | Native DOM event | Component event |
|---|---|---|
| Raised by | the browser | `ComponentSetupContext.Emit` |
| Delivered by | `BrowserEventInvokerRegistry` (`Assimalign.Viu.RuntimeDom`) | `ComponentInstance.EmitEvent` (`Assimalign.Viu.RuntimeCore`) |
| Handler shapes | `Action`, `Action<BrowserEvent>` | `Action`, `Action<object?>`, `Action<object?[]>` |
| Handler argument | a `BrowserEvent` | the boxed emit payload |
| Wrong shape | throws `NotSupportedException`, caught and sent to the registry's `ErrorSink` | dev warning, handler skipped |
| Modifiers | `.stop`, `.prevent`, `.once`, key modifiers, … | none — `.once` is the only overlap, and it is the separate `onXxxOnce` prop |
| Declaration | none | `IComponentDefinition.Emits` |

Passing an `Action<BrowserEvent>` as a component event handler, or an `Action<object?>` as a native
DOM handler, fails silently in both directions. Neither failure mode raises anything a Release build
surfaces by default. Full coverage of the native side — modifiers, key guards, the `BrowserEvent`
payload, and the deferred-intent semantics of `StopPropagation()`/`PreventDefault()` — is in
[Event Handling](../essentials/event-handling.md).

## `update:modelValue` is just an emit

Component `v-model` has no dedicated machinery. `<MyInput v-model="value" />` compiles to a
`modelValue` prop plus an `onUpdate:modelValue` handler prop, and the child satisfies it by declaring
and emitting an ordinary event.

> **Partial:** the prop/emit contract shown below works when the parent passes `onUpdate:modelValue`
> **explicitly from C#**. A *template-authored* `v-model` on a component does not yet reach the
> child's emit handler — the compiler expansion is implemented but the last hop is not wired. See
> [Component v-model](./v-model.md) and [Project Status](../../roadmap/status.md).

```csharp
public IReadOnlyList<ComponentEmitDefinition>? Emits =>
[
    new ComponentEmitDefinition("update:modelValue"),
];

// …inside Setup, from an input handler:
context.Emit("update:modelValue", browserEvent.TargetValue);
```

Note that `"update:modelValue"` already begins with a lower-case letter and contains no hyphen, so
`ToHandlerPropertyName` yields `onUpdate:modelValue` directly and the camelization retry never
changes it. See [Component v-model](./v-model.md) for the full contract, including named models and
the `*Modifiers` prop.

## Errors inside a handler

An exception thrown by an emit handler is caught by `ComponentInstance` and routed through
`ComponentErrorHandling` with the info string `event handler for "{eventName}"`. From there it walks
the `Lifecycle.OnErrorCaptured` chain starting at the emitting instance's **parent**, then falls
through to `ApplicationConfiguration.ErrorHandler`:

```csharp
Lifecycle.OnErrorCaptured((exception, instance, info) =>
{
    if (info.StartsWith("event handler", StringComparison.Ordinal))
    {
        Log(exception);
        return false; // false STOPS propagation — this inverts the intuitive reading.
    }

    return true;
});
```

Two rules that bite here. An `OnErrorCaptured` hook returning `false` stops propagation; returning
`true`, or omitting a return, lets the error continue upward. And an instance's own hooks never
capture its own errors, because the walk begins at `instance.Parent`. If no hook stops the error and
`ApplicationConfiguration.ErrorHandler` is `null`, the exception rethrows to the host with its
original stack; if the handler is set, it becomes the terminal sink and nothing rethrows.

## Not yet implemented

- **No compile-time payload typing** — `Emits` carries a name and an optional runtime validator, with
  no generic parameter and no analyzer checking payload types against handler signatures. Vue's
  type-only `defineEmits<…>()` form has no Viu counterpart.
- **No `defineEmits` macro** — `.viu` components declare events by writing the `Emits` property in
  `@script`; there is no compiler macro that generates it from the template.
- **No emit return values** — the three supported shapes are all `Action`; a handler cannot return a
  value to the emitter, so Vue's `v-model` modifier-negotiation idioms that rely on return values do
  not translate.
- **`ApplicationContext.EmitObserver` is a test seam only** — it exists so `Assimalign.Viu.Testing`
  can record every emit in order, and is `null` in production.

## See also

- [Props & Fallthrough Attributes](./props.md) — declaring props and how declared emits are excluded
  from `Attributes`.
- [Component v-model](./v-model.md) — the `update:modelValue` contract built on top of emits.
- [Event Handling](../essentials/event-handling.md) — native DOM listeners, modifiers, and
  `BrowserEvent`.
- [Components](../essentials/components.md) — the `Setup`-returns-a-render-function model these
  examples assume.
- [Differences from Vue 3](../../roadmap/vue-differences.md) — the naming map and behavioral
  divergences.
