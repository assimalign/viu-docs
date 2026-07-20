# Form Input Bindings

How `v-model` binds form state in Viu — which runtime directive each element compiles to, what carries
the two-way binding, and how component `v-model` differs.

> **Status:** Partial. Every runtime `v-model` directive is implemented and the compiler selects the
> right one per element, but the emitted directive value is not yet the `ViuModelBinding` carrier the
> directives read. See [Not yet implemented](#not-yet-implemented) and
> [Project status](../../roadmap/status.md).

Viu's `v-model` is a port of [Vue's `v-model`](https://vuejs.org/guide/essentials/forms.html). The
markup is identical; the expression inside it is C#, and the machinery underneath is a directive plus a
plain delegate rather than a proxied `this`.

## Which directive each element compiles to

`v-model` is not one directive. The compiler's `v-model` transform inspects the element tag and its
`type` attribute and selects a concrete runtime directive, exactly as
`@vue/compiler-dom` does. All five live in `Assimalign.Viu.RuntimeDom` and are exposed to generated code
through `DomRenderHelpers` under their upstream-aliased spellings (`_vModelText`, `_vModelCheckbox`, …).

| Markup | Helper emitted | Runtime type |
| --- | --- | --- |
| `<input v-model="text" />` | `_vModelText` | `VModelText` |
| `<input type="checkbox" v-model="agreed" />` | `_vModelCheckbox` | `VModelCheckbox` |
| `<input type="radio" v-model="choice" />` | `_vModelRadio` | `VModelRadio` |
| `<select v-model="picked"></select>` | `_vModelSelect` | `VModelSelect` |
| `<textarea v-model="body"></textarea>` | `_vModelText` | `VModelText` |
| `<input :type="kind" v-model="any" />` | `_vModelDynamic` | `VModelDynamic` |

Two extra selection rules are worth knowing, because neither is visible in the markup:

- **A dynamic-keyed `v-bind` forces `_vModelDynamic`** — an element that declares *no* `type` at all
  but carries `:[key]="x"` alongside `v-model` might still receive a `type` from that dynamic key, so
  the transform falls back to the dynamic directive. A static `type="text"` still wins: the dynamic-key
  check runs only after the transform fails to find a `type` property on the element.
- **Custom elements take the `<input>` branch** — a tag the compiler is configured to treat as a
  custom element is resolved by its `type` attribute just like a real `<input>`.

Every one of these is a normal `IDirective`, so nothing about `v-model` is privileged. You can apply
`VModelText.Instance` by hand exactly the way you would apply your own directive — see
[Custom Directives](../reusability/custom-directives.md).

## Text inputs and `<textarea>`

`VModelText` reflects the model onto `el.value` and writes user edits back through the binding's setter.
It reads the DOM value from `BrowserEvent.TargetValue`, which the JS bridge marshals in the same
dispatch call as the event itself — there is never a follow-up interop read per keystroke.

```viu
@template {
    <input v-model="Text" placeholder="Type here" />
    <textarea v-model="Notes"></textarea>
    <p>{{ Text.Length }} characters</p>
}

@script {
using Assimalign.Viu.Reactivity;

public Reference<string> Text = new("");
public Reference<string> Notes = new("");
}
```

A `Reference<T>` member declared in `@script` is classified as a setup ref, so the compiler inserts
`.Value` on both reads and writes — the template says `Text`, the generated C# says `_ctx.Text.Value`.
See [Reactivity Fundamentals](./reactivity-fundamentals.md) for why `.Value` exists at all.

### Modifiers

| Modifier | Behavior |
| --- | --- |
| `.lazy` | Listens on `change` instead of `input`, so the model updates on commit rather than per keystroke. |
| `.number` | Coerces the committed string through `NumberCoercion.LooseToNumber`; non-numeric input is left untouched, matching upstream `looseToNumber`. |
| `.trim` | Trims the value before assigning it, and re-syncs the element to the trimmed text on `change`. |

- **Order is trim then number** — `.trim.number` and `.number.trim` behave identically, and both trim
  first, matching upstream.
- **`type="number"` implies `.number`** — an `<input type="number" v-model="x" />` coerces without the
  modifier, because the directive checks the vnode's `type` prop as well as the modifier set.
- **IME composition is respected** — updates are suppressed between `compositionstart` and
  `compositionend`, and a pending composition is never clobbered by a model-driven write.
- **Focused elements are guarded** — a re-render will not overwrite the value of a focused input when
  `.lazy` sees a loosely-equal model, or when `.trim` sees only trailing whitespace differing. Focus is
  tracked with element-local `focus`/`blur` model listeners rather than an `activeElement` interop read.

## Checkboxes

`VModelCheckbox` has three distinct modes depending on what the model holds.

```viu
@template {
    <!-- boolean -->
    <input type="checkbox" v-model="Agreed" />

    <!-- custom truthy/falsy payloads -->
    <input type="checkbox" v-model="Answer" true-value="yes" false-value="no" />

    <!-- multi-checkbox bound to a list -->
    <input type="checkbox" :value="Tag.Cats" v-model="Selected" />
    <input type="checkbox" :value="Tag.Dogs" v-model="Selected" />
}

@script {
using System.Collections.Generic;
using Assimalign.Viu.Reactivity;

public Reference<bool> Agreed = new(false);
public Reference<string> Answer = new("no");
public Reference<IList<object?>> Selected = new(new List<object?>());
}
```

- **Boolean binding** — checked assigns the `true-value` prop (or `true` when absent); unchecked assigns
  `false-value` (or `false`). The comparison that decides the initial checked state is loose equality,
  so `"yes"` and a boxed `true` behave the way they do in Vue.
- **`IList` binding** — membership is tested with loose equality (upstream `looseIndexOf`), and toggling
  assigns a *new* list rather than mutating in place, so a `Reference<IList<object?>>` actually fires.
- **`ISet<T>` binding** — membership is strict (upstream `Set.has`), and toggling likewise assigns a
  fresh set.
- **`:value` round-trips objects** — the bound value is read as a raw vnode prop, so an object option
  goes into the list as that object, never as its string form.

## Radio buttons

`VModelRadio` checks the element when the model *loosely equals* the radio's bound `:value`, and assigns
that raw `:value` back on change. Object values round-trip without string coercion.

```viu
@template {
    <label><input type="radio" :value="Size.Small" v-model="Chosen" /> Small</label>
    <label><input type="radio" :value="Size.Large" v-model="Chosen" /> Large</label>
}
```

`VModelRadio` is the only `v-model` directive with **no `Mounted` hook** — it sets `checked` during
`Created`, before the element is inserted, so a preselected radio is correct on first paint.

## Select

`VModelSelect` reflects the model onto each `<option>`'s `selected` state and assigns the selection back
on `change`. It snapshots each option's raw `:value` (falling back to the option's text content, mirroring
how `option.value` defaults to `option.text` in HTML) and maps the dispatched selection string back to
that raw value — so object-valued options survive the DOM round trip.

```viu
@template {
    <select v-model="Country">
        <option v-for="c in Countries" :key="c.Code" :value="c">{{ c.Name }}</option>
    </select>

    <select multiple v-model="Picked">
        <option value="a">A</option>
        <option value="b">B</option>
    </select>
}
```

- **`<select multiple>` requires a list or set** — bound to anything else the directive writes a dev
  warning (`<select multiple v-model> expects an Array or Set value for its binding.`) and reflects
  nothing. When the model is a set, the directive assigns a set back; otherwise a list.
- **Multi-select needs no extra interop** — the selected values arrive on
  `BrowserEvent.SelectedValues`, computed JS-side during dispatch. That property is non-null *only* for
  a `<select multiple>` target.
- **`.number` applies** — the mapped raw value is coerced through `NumberCoercion.LooseToNumber`.
- **Options are collected from the vnode tree** — the directive recurses through `<optgroup>` and
  `v-for` fragments rather than reading a live `el.options` collection.
- **`VModelSelect` and `VModelDynamic` are the only ones that implement `Updated`** — a select must
  re-reflect after its children patch. (`IDirective` declares seven optional hooks in all — `Created`,
  `BeforeMount`, `Mounted`, `BeforeUpdate`, `Updated`, `BeforeUnmount`, `Unmounted` — of which the
  `v-model` directives use five.)

## Dynamic `:type`

`VModelDynamic` holds no behavior of its own. Each hook re-resolves the concrete directive from the
element's current tag and `type` and forwards to it — `select` by tag, `textarea` by tag, then
`checkbox`/`radio` by type, with everything else falling through to `VModelText`. That means
`<input :type="kind" v-model="value" />` genuinely switches semantics when `kind` changes at runtime.

## What `v-model` compiles to

On a **native element** the transform emits an `onUpdate:modelValue` assignment handler and attaches the
selected directive, and it deliberately *filters out* the `modelValue` prop — on native elements the value
rides as the directive's binding value instead:

```csharp
// template: <input v-model="name" />
return _withDirectives(
    _createElementBlock(_openBlock(), "input", _createProps(
        ("onUpdate:modelValue", _withHandler(__event => ((_ctx.name) = __event)))
    ), null, 8 /* PROPS */, ["onUpdate:modelValue"]),
    new object?[] { new object?[] { _vModelText, _ctx.name } });
```

Note what is *not* there: no reflection, no magic prop, no component-instance proxy. The write-back is a
plain C# assignment lambda, which is what keeps the whole path AOT- and trimming-safe.

## `ViuModelBinding` — the carrier

At runtime every `v-model` directive expects its binding value to be a `ViuModelBinding`:

```csharp
public sealed class ViuModelBinding
{
    public ViuModelBinding(object? value, Action<object?> setter);
    public object? Value { get; }
    public Action<object?> Setter { get; }
}
```

It pairs a snapshot of the current model value with the delegate that writes it back. The directive reads
`Value` where upstream Vue reads `binding.value`, and calls `Setter` where upstream calls
`el[assignKey](v)`. Both are ordinary delegates — Viu has no `this`-proxy to stash an assigner on and no
reflection to discover one.

Applied by hand, that is the whole contract:

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

namespace MyApp;

public sealed class NameField : IComponentDefinition
{
    public string? Name => "NameField";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var name = Reactive.Reference("");

        return () => Directives.WithDirectives(
            VirtualNodeFactory.Element("input", VirtualNodeFactory.Properties(("type", "text"))),
            VModelText.Instance,
            new ViuModelBinding(name.Value, value => name.Value = value as string ?? ""));
    }
}
```

`BrowserModelDirective.Carrier` is just `binding.Value as ViuModelBinding`, so a directive whose binding
value is some other type finds no carrier and never throws: its assigner stays null and the write-back
path is inert. The reflect path still runs against a null model — `VModelText`, for instance, formats
null to `""` and writes that to the element on `Mounted`. That is the gap described under
[Not yet implemented](#not-yet-implemented).

## `v-model` on a component

Component `v-model` is a pure prop-plus-event convention; no directive is involved.

| Markup | Props emitted |
| --- | --- |
| `<MyInput v-model="value" />` | `modelValue`, `onUpdate:modelValue` |
| `<MyInput v-model:title="value" />` | `title`, `onUpdate:title` |
| `<MyInput v-model:title.trim="value" />` | `title`, `onUpdate:title`, `titleModifiers` |

- **Modifier objects are component-only** — a `*Modifiers` prop is emitted *only* when the element is a
  component. Modifiers on a native `v-model` are consumed by the runtime directive instead.
- **Only the *event* name is camelized** — `v-model:full-name` produces the event `onUpdate:fullName`
  but leaves the prop key as the raw argument, `full-name`. It still reaches a prop declared as
  `fullName`, because prop resolution matches a declaration's `KebabName` too.
- **A dynamic argument works too** — `v-model:[key]` emits `"onUpdate:" + key` and `key + "Modifiers"`.
- **`v-model` argument on a plain element is an error** — see `XVModelArgumentOnElement` below.

The child declares the prop and the emit, then emits the update:

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

namespace MyApp;

public sealed class MyInput : IComponentDefinition
{
    public IReadOnlyList<ComponentPropertyDefinition> Properties { get; } =
        [new ComponentPropertyDefinition("modelValue")];

    public IReadOnlyList<ComponentEmitDefinition> Emits { get; } =
        [new ComponentEmitDefinition("update:modelValue")];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        return () => VirtualNodeFactory.Element("input", VirtualNodeFactory.Properties(
            ("value", properties.Get<string>("modelValue")),
            ("onInput", (Action<BrowserEvent>)(e => context.Emit("update:modelValue", e.TargetValue)))));
    }
}
```

Viu has no `defineModel` equivalent — the prop and emit pair *is* the mechanism. Full treatment lives in
[Component v-model](../components/v-model.md); prop declaration rules are in
[Props & Fallthrough Attributes](../components/props.md).

## Two channels on one DOM event

A `v-model` directive and a template `@input` handler on the same element both need the `input` event.
Viu's invoker registry keeps **two independent handler channels** per `(nodeHandle, eventName, capture)`
triple:

- **The property channel** — a template `@event` / `onX` prop.
- **The model channel** — a listener registered by a `v-model` directive.

Both fire on dispatch, in **property-then-model order**, and the shared DOM listener is removed only once
*both* channels are null. So this works, and your handler sees the event before the model is written:

```viu
@template {
    <input v-model="Query" @input="MarkDirty" />
}
```

Because there is exactly one DOM listener per triple, a re-render that changes a handler is a pure .NET
delegate swap costing zero interop calls. The delegate-shape rules that govern the property channel are
in [Event Handling](./event-handling.md) — note in particular that a handler which is not `Action` or
`Action<BrowserEvent>` fails silently in a Release build.

## Directive hook coverage

| Directive | `Created` | `Mounted` | `BeforeUpdate` | `Updated` | `BeforeUnmount` |
| --- | --- | --- | --- | --- | --- |
| `VModelText` | yes | yes | yes | — | yes |
| `VModelCheckbox` | yes | yes | yes | — | yes |
| `VModelRadio` | yes | — | yes | — | yes |
| `VModelSelect` | yes | yes | yes | yes | yes |
| `VModelDynamic` | yes | yes | yes | yes | yes |

The table covers only the hooks any `v-model` directive uses; `IDirective`'s other two — `BeforeMount`
and `Unmounted` — are left null by all five. All five are stateless singletons reached through the
static `Instance` field; per-element state is keyed by node handle inside the runtime and released on
`BeforeUnmount`.

## Compiler diagnostics

| Code | Message | Trigger |
| --- | --- | --- |
| `XVModelNoExpression` | `v-model is missing expression.` | `<input v-model />` |
| `XVModelMalformedExpression` | `v-model value must be a valid JavaScript member expression.` | the expression is not a member expression |
| `XVModelOnInvalidElement` | `v-model can only be used on <input>, <textarea> and <select> elements.` | `<div v-model="x">` |
| `XVModelArgumentOnElement` | `v-model argument is not supported on plain elements.` | `<input v-model:foo="x" />` |
| `XVModelOnFileInputElement` | `v-model cannot be used on file inputs since they are read-only. Use a v-on:change listener instead.` | `<input type="file" v-model="x" />` |
| `XVModelUnnecessaryValue` | `Unnecessary value binding used alongside v-model. It will interfere with v-model's behavior.` | `:value` bound alongside `v-model` |

Two further codes — `XVModelOnScopeVariable` and `XVModelOnProps` — are declared with messages ported
from upstream but are **never reported** by any transform today, so writing `v-model` to a `v-for` alias
or to a prop compiles without a diagnostic. The full catalog is in
[Compiler Diagnostics](../../api/diagnostics.md).

## Not yet implemented

- **The compiler does not emit `ViuModelBinding`.** The render-function emitter currently passes the raw
  model value as the directive's binding value (`new object?[] { _vModelText, _ctx.name }`). The runtime
  directives read `binding.Value as ViuModelBinding`, so a compiled native-element `v-model` finds no
  carrier and its write-back path is inert. Hand-written `Directives.WithDirectives(..., new
  ViuModelBinding(value, setter))` works today; template-compiled native `v-model` does not yet
  round-trip.
- **The `<input type="range">` focused-write nuance is deferred.** Upstream gates its focused-element
  write guards on `document.activeElement === el && el.type !== 'range'`; Viu's port omits the range
  special case.
- **Focus is inferred, not queried.** `focus`/`blur` model listeners on the element stand in for an
  `activeElement` interop read. Real browser focus and IME behavior are deferred to a future end-to-end
  harness.
- **A runtime `:multiple` toggle on `<select>` is not handled.** `VModelSelect`'s `change` listener
  captures `multiple` (and whether the model is a set) once in `Created`, so flipping `:multiple` after
  mount leaves the listener assigning the old shape. The reflect path re-reads `multiple` per call.

## See also

- [Component v-model](../components/v-model.md) — the prop-and-emit contract in depth.
- [Event Handling](./event-handling.md) — `v-on`, modifiers, and `BrowserEvent`.
- [Built-in Directives](../../api/built-in-directives.md) — the full directive reference.
- [Differences from Vue 3](../../roadmap/vue-differences.md) — the naming map and behavioral divergences.
