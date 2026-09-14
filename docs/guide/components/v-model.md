# Component v-model

Two-way binding across a component boundary — the `modelValue` prop and `update:modelValue` emit
pair that `v-model` on a component expands into.

> **Status:** Partial. The prop/emit contract and the compiler expansion are both implemented, but a
> template-authored component `v-model` does not yet reach the child's emit handler — see
> [Not yet implemented](#not-yet-implemented) and [Project status](../../roadmap/status.md).

`v-model` on a component is not a distinct feature. It is **sugar for a prop plus an emit**, exactly
as in Vue's [Component v-model](https://vuejs.org/guide/components/v-model.html). The parent hands
the child a value and a write-back handler; the child renders the value and calls the handler when
the user changes it. Nothing about the runtime is special-cased — everything on this page is built
out of [props](./props.md) and [emits](./events.md) you could write by hand, and often should.

For `v-model` on a native `<input>`, `<select>`, or `<textarea>`, the mechanism is completely
different — a runtime directive rather than a prop pair. See
[Form Input Bindings](../essentials/form-bindings.md).

## What `v-model` compiles to

The `v-model` transform (`VModelTransform`, the port of `@vue/compiler-core`'s `transformModel`)
turns one directive on a component tag into two or three vnode props:

| Template on a component | Props emitted |
| --- | --- |
| `v-model="value"` | `modelValue`, `onUpdate:modelValue` |
| `v-model:title="value"` | `title`, `onUpdate:title` |
| `v-model:title.trim="value"` | `title`, `onUpdate:title`, `titleModifiers` |
| `v-model:[name]="value"` | `[name]`, `"onUpdate:" + name` |
| `v-model:[name].trim="value"` | `[name]`, `"onUpdate:" + name`, `name + "Modifiers"` |

- **The argument names the model** — with no argument the pair is `modelValue` /
  `onUpdate:modelValue`. With `v-model:title` the property name is the argument verbatim and the
  handler name is `"onUpdate:" + Camelize(argument)`, so `v-model:full-name` emits the `full-name`
  prop alongside an `onUpdate:fullName` handler.
- **The modifiers prop is component-only, and appears only when modifiers are written.**
  `BuildModifiersKey` appends `Modifiers` to the argument *verbatim* — `modelModifiers` when there is
  no argument, and `full-nameModifiers` (not camelized, unlike the handler name) for
  `v-model:full-name.trim`. On a native element no modifiers prop is emitted at all; there the
  modifiers ride in the `withDirectives` array and reach the runtime directive as
  `DirectiveBinding.Modifiers`.
- **The expression must be a member expression.** `ExpressionShape.IsMemberExpression` gates the
  transform, so `v-model="draft.Title"` is fine and `v-model="a + b"` reports
  `XVModelMalformedExpression` — the write-back handler has to have somewhere to assign to.

Here is the render body the compiler actually emits for `<MyInput v-model="value"></MyInput>`:

```csharp
var _component_MyInput = _resolveComponent("MyInput");

return _createBlock(_openBlock(), _component_MyInput, _createProps(
    ("modelValue", _ctx.value),
    ("onUpdate:modelValue", _withHandler(__event => ((_ctx.value) = __event)))
), null, 8 /* PROPS */, ["modelValue", "onUpdate:modelValue"]);
```

Three things in that output are worth reading closely:

- **`$event` is spelled `__event`.** The transform authors the assignment with Vue's `$event`, which
  has no legal C# spelling; the emitter substitutes `__event`. You still write `$event` in templates.
- **`_withHandler` supplies the delegate target type.** A bare C# lambda has no type of its own, so
  handler-keyed prop values are wrapped in this Viu-only helper. (The exception is a value already
  wrapped in `_withModifiers` or `_withKeys` — those helpers' own signatures type the inner lambda,
  so the emitter does not re-wrap them.) See
  [Template Syntax](../essentials/template-syntax.md) for the full set of emitted contract helpers.
- **The write-back assigns `object?`.** `__event` is typed `object?`, so whatever `v-model` targets
  must accept an `object?` on assignment. This is the single most common way a component `v-model`
  fails to compile — see [The `object?` assignment rule](#the-object-assignment-rule).

## Implementing the child

The child's half is two declarations and one call. Declare `modelValue` in `Properties`, declare
`update:modelValue` in `Emits`, and emit the new value:

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

internal sealed class TextField : IComponentDefinition
{
    public string? Name => "TextField";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
    [
        new ComponentPropertyDefinition("modelValue") { DefaultValue = string.Empty },
        new ComponentPropertyDefinition("label") { DefaultValue = string.Empty },
    ];

    public IReadOnlyList<ComponentEmitDefinition>? Emits { get; } =
    [
        new ComponentEmitDefinition("update:modelValue"),
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => () => VirtualNodeFactory.Element(
            "label",
            VirtualNodeFactory.Properties(("class", "field")),
            VirtualNodeFactory.Element("span", properties.Get<string>("label") ?? string.Empty),
            VirtualNodeFactory.Element(
                "input",
                VirtualNodeFactory.Properties(
                    ("type", "text"),
                    ("value", properties.Get<string>("modelValue") ?? string.Empty),
                    ("onInput", (Action<BrowserEvent>)(browserEvent =>
                        context.Emit("update:modelValue", browserEvent.TargetValue))))));
}
```

- **Declaring the prop is mandatory.** An undeclared `modelValue` never becomes a prop — it lands in
  `ComponentSetupContext.Attributes` and, with the default `InheritAttributes`, is merged onto the
  rendered root element as a stray attribute instead.
- **Declaring the emit is what keeps the handler out of fallthrough.**
  `ComponentInstance.IsDeclaredEmitHandlerName` excludes a declared emit's handler prop from
  `Attributes`, so declaring `update:modelValue` is what stops `onUpdate:modelValue` from being
  merged onto the root. It also silences the "emitted event … is not declared in the Emits option"
  dev warning, which fires whenever a component declares *any* emits and then emits something else.
- **`properties.Get<T>` never throws.** It returns `default` both when the prop is absent and when it
  is present but of another type, so the `?? string.Empty` above is doing real work. See
  [Props & Fallthrough Attributes](./props.md#reading-props).
- **`BrowserEvent.TargetValue`** carries the input's current value across the interop boundary; the
  DOM element itself is an `int` handle, never a JS object.

### How the emit finds the handler

`ComponentSetupContext.Emit` maps the event name to a prop name through
`ComponentInstance.ToHandlerPropertyName`, which upper-cases the first character and prefixes `on`:

```text
"update:modelValue"  ->  "onUpdate:modelValue"
"update:title"       ->  "onUpdate:title"
"change"             ->  "onChange"
```

That is exactly the prop name the compiler emits, which is why the two halves line up. If the first
lookup misses, the dispatcher retries with a camelized event name, so a kebab-case emit
(`"item-selected"`) still finds a camelCase handler prop (`"onItemSelected"`).

**Emit handlers must be `Action`, `Action<object?>`, or `Action<object?[]>`.** Any other delegate
shape produces a dev warning naming the offending type and is *not invoked* — a silent no-op in a
Release WASM build, where the warning sink is a `Debug.WriteLine`. This constraint is the reason
component `v-model` is currently marked Partial; see below.

## Wiring the parent

Written by hand, the parent supplies both halves of the pair explicitly:

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

internal sealed class NoteEditor : IComponentDefinition
{
    public string? Name => "NoteEditor";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var field = new TextField();
        var draft = Reactive.Reference(string.Empty);

        return () => VirtualNodeFactory.Element(
            "form",
            VirtualNodeFactory.Component(field, VirtualNodeFactory.Properties(
                ("label", "Title"),
                ("modelValue", draft.Value),
                ("onUpdate:modelValue", (Action<object?>)(value =>
                    draft.Value = value as string ?? string.Empty)))),
            VirtualNodeFactory.Element("p", $"{draft.Value.Length} characters"));
    }
}
```

Reading `draft.Value` inside the render closure is what subscribes the parent to it, so the emit
writes the ref, the ref invalidates the render effect, and the child receives the new `modelValue` on
the next flush. That round trip is the whole of two-way binding — there is no hidden channel.

The same thing in a template, once the child is registered on the application:

```csharp
BrowserRuntime.CreateApp(new NoteEditor())
    .Component("TextField", new TextField())
    .Mount("#app");
```

```viu
@template {
    <form>
        <TextField label="Title" v-model="draft" />
        <p>{{ (draft as string)?.Length ?? 0 }} characters</p>
    </form>
}

@script {
    // Members of the generated partial class; the compiled render binds against them as _ctx.
    // `draft` must be object? because the generated write-back assigns an object? into it, which
    // is also why the interpolation above has to cast — see The object? assignment rule below.
    public object? draft { get; set; } = string.Empty;
}
```

Registration matters because `<TextField>` compiles to `_resolveComponent("TextField")`. The
registry getter is an exact-name lookup, but render-time resolution also tries camelCase and
PascalCase — see [Dynamic Components & Registration](./dynamic-components.md).

## Multiple models on one component

Each `v-model` with a distinct argument produces its own independent prop/handler pair, so a
component can carry as many as it likes:

```viu
@template {
    <UserFields v-model:first-name="first" v-model:last-name="last" />
}
```

Compiled from `<MyInput v-model="first" v-model:title="second"></MyInput>`, the emitter produces
four props with no interference between the pairs:

```csharp
return _createBlock(_openBlock(), _component_MyInput, _createProps(
    ("modelValue", _ctx.first),
    ("onUpdate:modelValue", _withHandler(__event => ((_ctx.first) = __event))),
    ("title", _ctx.second),
    ("onUpdate:title", _withHandler(__event => ((_ctx.second) = __event)))
), null, 8 /* PROPS */, ["modelValue", "onUpdate:modelValue", "title", "onUpdate:title"]);
```

The child declares each one the same way it declared `modelValue`:

```csharp
public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
[
    new ComponentPropertyDefinition("firstName"),
    new ComponentPropertyDefinition("lastName"),
];

public IReadOnlyList<ComponentEmitDefinition>? Emits { get; } =
[
    new ComponentEmitDefinition("update:firstName"),
    new ComponentEmitDefinition("update:lastName"),
];
```

`ComponentPropertyDefinition` derives a `KebabName` automatically and the instance registers the
declaration under both spellings, so the `first-name` prop the template emits still matches the
`firstName` declaration. The stored value is always keyed by the declaration's camelCase `Name`,
though: the child reads `properties["firstName"]`, never `properties["first-name"]`.

## Modifiers

`v-model:title.trim="value"` adds a third prop, `titleModifiers`, describing which modifiers the
author wrote. Viu ships **no built-in component modifiers** — `.trim`, `.number`, and `.lazy` are not
interpreted by the runtime for a component `v-model`. The prop is passed through and the child
decides what it means, which is the same division of labour as Vue's custom modifiers.

**Watch the name with a kebab-case argument.** The handler name is camelized but the modifiers key is
not, so `v-model:full-name.trim` emits `full-nameModifiers` — which is not the hyphenation of
`fullNameModifiers` (`full-name-modifiers`), so a `fullNameModifiers` declaration will *not* match it.
Declare the prop under the literal emitted name, or use a camelCase argument.

Reading one is an ordinary prop read:

```csharp
public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
[
    new ComponentPropertyDefinition("title"),
    new ComponentPropertyDefinition("titleModifiers"),
];

public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    var modifiers = properties.Get<IReadOnlyDictionary<string, bool>>("titleModifiers");
    var trims = modifiers is not null && modifiers.TryGetValue("trim", out var on) && on;

    return () => VirtualNodeFactory.Element(
        "input",
        VirtualNodeFactory.Properties(
            ("value", properties.Get<string>("title") ?? string.Empty),
            ("onInput", (Action<BrowserEvent>)(browserEvent =>
                context.Emit(
                    "update:title",
                    trims ? browserEvent.TargetValue?.Trim() : browserEvent.TargetValue)))));
}
```

The runtime places **no constraint on the modifiers value** — there is no `ModelModifiers` type
anywhere in Viu. A dictionary is the natural shape when the parent is hand-written C#, and it is what
the `Get<IReadOnlyDictionary<string, bool>>` read above expects.

Note that `titleModifiers` is read once in `Setup`, outside the render closure, while `title` is read
inside it. That is deliberate: props read inside the closure are what subscribe the render effect, and
modifiers are fixed by the template at compile time, so re-reading them per render would buy nothing.
Any prop that can actually change must be read inside the closure.

> **The template path for modifiers does not compile yet.** The transform emits the modifiers object
> as a compiler-injected literal spelled in JavaScript object syntax — `("titleModifiers", { trim:
> true })` — which is not a valid C# expression. (The base transform builds that value as a raw
> string rather than an IR object expression, so unlike the native-element modifiers object it never
> passes through the `_createProps` mapping that would make it compilable. No component `v-model`
> case appears in the emitter's parse-validity suite.) Pass the modifiers prop explicitly from a
> hand-written parent until the C# literal shape lands.

## The `object?` assignment rule

The generated write-back handler is `__event => ((target) = __event)` where `__event` is `object?`.
So whatever `v-model` points at must be assignable from `object?`. In a `.viu` component that means
the member is declared `object?`:

```viu
@script {
    public object? draft { get; set; }
    public object? title { get; set; }
}
```

A `public string Title { get; set; }` member is **not** a valid `v-model` target — the generated
assignment will not compile. The failure is a C# compiler error on the emitted render body, not a
template diagnostic; the generator's `#line` map resolves it back to the offending `.viu` template
line, so it is reported where you wrote the directive rather than in generated source. Cast at the
point of use instead:

```viu
@template {
    <TextField v-model="draft" />
    <p>{{ (draft as string)?.Length ?? 0 }} characters</p>
}
```

This is a direct consequence of having no `this`-proxy: Vue's assignment goes through a dynamically
typed property write, whereas Viu's is a statically bound C# assignment that must satisfy the
compiler. Template expressions are C#, not JavaScript — see
[Template Syntax](../essentials/template-syntax.md).

## Compiler diagnostics

The v-model transform reports these recoverable errors through `TransformOptions.OnError`. Only the
first two can be reached from a component `v-model`; the rest are native-element rules, listed here
so the whole set is in one place:

| Code | Applies to | Meaning |
| --- | --- | --- |
| `XVModelNoExpression` | component and element | `v-model` written with no value. |
| `XVModelMalformedExpression` | component and element | The expression is not a member expression. |
| `XVModelOnInvalidElement` | element | `v-model` on a tag that is not `input`/`textarea`/`select` (a configured custom element is also accepted). |
| `XVModelArgumentOnElement` | element | `v-model:arg` on a native element; arguments are component-only. |
| `XVModelOnFileInputElement` | element | `v-model` on `<input type="file">`, which is read-only. |
| `XVModelUnnecessaryValue` | element | A redundant `:value` binding alongside `v-model`. |

Nothing throws — errors are pushed through the `OnError` callback and the compile continues. The two
expression errors abort the expansion, so the directive contributes no props at all; the
element-shape errors are reported alongside whatever props the base expansion already built (a
`v-model` on a `<div>` still emits its `onUpdate:modelValue` prop, just without a runtime directive).
Two further codes,
`XVModelOnScopeVariable` and `XVModelOnProps`, exist in the catalog for numeric parity with upstream
but are **never emitted by any code path** — do not expect them. See
[Compiler Diagnostics](../../api/diagnostics.md).

## Vue counterparts

| Vue | Viu | Note |
| --- | --- | --- |
| `v-model` on a component | `v-model` on a component | Same syntax, same expansion. |
| `modelValue` / `update:modelValue` | `modelValue` / `update:modelValue` | Identical names. |
| `v-model:title` | `v-model:title` | Emits `title` + `onUpdate:title`. |
| `titleModifiers` | `titleModifiers` | Same name; codegen is incomplete (above). |
| `emit('update:modelValue', v)` | `context.Emit("update:modelValue", v)` | `params object?[]` payload. |
| `$event` | `$event`, emitted as `__event` | Authored the Vue way, spelled the C# way. |
| `defineModel()` | — | No equivalent; see below. |
| `.trim` / `.number` / `.lazy` on a component | — | Passed through, never interpreted. |

## Not yet implemented

- **A template-authored component `v-model` does not reach the child's emit handler.** The compiler
  wraps the write-back in `_withHandler`, whose overload resolution binds the value-returning
  assignment lambda to `Func<object?, object?>`. `ComponentInstance` dispatches emits only to
  `Action`, `Action<object?>`, and `Action<object?[]>`, so the handler is skipped with a dev warning
  and the parent's value is never written. **The hand-written parent shown above — passing an
  explicit `(Action<object?>)` for `onUpdate:modelValue` — is the working path today.** The
  compiler-side expansion, the prop resolution, and the emit dispatch are each implemented and
  tested; it is the delegate shape at the join that has not been reconciled.
- **Component `v-model` modifiers do not emit compilable C#.** The `*Modifiers` object is written as
  a JavaScript object literal, as described above.
- **No `defineModel` equivalent.** Vue's macro collapses the prop and emit into one writable ref;
  Viu has no compiler macro for it, because `.viu` script analysis does not yet synthesize props or
  emits at all. The `.viu` generator emits only `Render`, `RenderCacheSize`,
  `ExtractedStyles`, `ApplyCssVariables`, and CSS-module accessors into the partial class — a
  component's `Properties` and `Emits` tables are hand-written C#. See
  [Single-File Components (.viu)](../scaling-up/single-file-components.md).
- **No built-in `.trim` / `.number` / `.lazy` handling for components.** The names travel in the
  modifiers prop and mean whatever the child decides. (On native elements, by contrast, the runtime
  `v-model` directives do implement them — see
  [Form Input Bindings](../essentials/form-bindings.md).)
- **No two-way binding on `v-bind`.** Vue 3 has none either — Vue 2's `.sync` modifier was removed in
  favour of `v-model` arguments. `v-model` is the only two-way directive.

Related reading: [Component Events](./events.md) for the emit contract and the delegate shapes it
accepts, [Props & Fallthrough Attributes](./props.md) for the prop half,
[Form Input Bindings](../essentials/form-bindings.md) for `v-model` on native elements,
[Component API](../../api/component.md) for the full signatures, and
[Differences from Vue 3](../../roadmap/vue-differences.md) for the naming map.
