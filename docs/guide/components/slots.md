# Slots

Passing markup into a child component through `<slot>` outlets, named slots, scoped slots, and
fallback content.

> **Status:** Implemented. Outlets, named slots, fallback content, scoped slots, and the
> `SlotFlags` stability contract all ship and are covered by tests. Two codegen gaps — scope
> destructuring and typed member access on a slot scope — are listed under
> [Not yet implemented](#not-yet-implemented).

Slots are Viu's port of [Vue's slots](https://vuejs.org/guide/components/slots.html), and the
template syntax is Vue 3's verbatim. What changes is the runtime spelling: a slot is a plain C#
delegate, `Slot`, and a component's slot table is a `ComponentSlots` object reached through
`ComponentSetupContext.Slots`. There is no hidden `$slots` proxy — the compiler rewrites `$slots` to
`_ctx.__slots`, because `$slots` has no legal C# spelling.

A slot is the inverse of a prop. A prop passes a *value* down; a slot passes a *render fragment*
down, and the child decides where — and whether — to render it.

## Slot outlets

A child declares where parent-supplied content lands with a `<slot>` element:

```viu
@template {
    <div class="card">
        <slot></slot>
    </div>
}

@script {
    // Nothing to declare — a default slot needs no props and no emits.
}
```

A parent supplies content by nesting children inside the component tag:

```viu
@template {
    <BaseCard>
        <p>This paragraph becomes the default slot's content.</p>
    </BaseCard>
}
```

That `<slot></slot>` compiles to a `_renderSlot` call against the instance's slot table:

```csharp
// <slot></slot>
return _renderSlot(_ctx.__slots, "default");
```

Slot content is compiled in the **parent's** scope, not the child's. The delegate captures the
parent's render context and the child merely invokes it, which is why a parent's refs are readable
inside slot content and the child's local state is not.

## Fallback content

Children written inside a `<slot>` element are its fallback — rendered only when the parent supplied
nothing for that slot:

```viu
@template {
    <button type="button" class="submit">
        <slot>Submit</slot>
    </button>
}
```

```csharp
// <slot name="header"><p>fallback {{ hint }}</p></slot>
return _renderSlot(_ctx.__slots, "header", _createProps(), () => new object?[]
{
    _createElementVNode("p", null, "fallback " + _toDisplayString(_ctx.hint), 1 /* TEXT */),
});
```

The fallback rules are precise and worth knowing exactly, because two of them are not obvious:

- **Fallback renders when the slot is absent *or* when its content renders empty** — supplying a slot
  whose delegate returns `null`, an empty array, or nothing but comments still yields the fallback.
- **Comments and `null` entries count as empty** — `null` array entries are this model's
  comment-placeholder idiom, and a nested fragment that itself renders empty is transparently
  recursed into. So a slot that is entirely `v-if="false"` falls back.
- **Content and fallback never patch against each other** — `RenderSlot` keys its output fragment
  `"_" + name` and keys the fallback branch `"_" + name + "_fb"`. The differing keys force a full
  swap rather than an in-place patch, so a fallback `<p>` is never diffed into a supplied `<span>`.
- **Passing no fallback delegate disables the check entirely** — with `fallback` null, `RenderSlot`
  returns the slot's output as-is, empty or not.

## Named slots

A child may declare more than one outlet by naming them. The unnamed outlet is `"default"`:

```viu
@template {
    <article class="layout">
        <header>
            <slot name="header">
                <h2>Untitled</h2>
            </slot>
        </header>
        <section>
            <slot></slot>
        </section>
        <footer>
            <slot name="footer"></slot>
        </footer>
    </article>
}
```

The parent targets each one with `v-slot` on a `<template>`, or its `#` shorthand:

```viu
@template {
    <PageLayout>
        <template #header>
            <h2>{{ Title }}</h2>
        </template>

        <p>Anything not inside a named template lands in the default slot.</p>

        <template #footer>
            <small>Updated {{ UpdatedAt }}</small>
        </template>
    </PageLayout>
}

@script {
    using System;

    public string Title { get; set; } = "Quarterly report";

    public DateOnly UpdatedAt { get; set; } = DateOnly.FromDateTime(DateTime.Today);
}
```

Every authoring form the compiler accepts:

| Form | Meaning |
| --- | --- |
| `<slot></slot>` | Default outlet in the child |
| `<slot name="header">` | Named outlet in the child |
| `<slot :name="which">` | Dynamic outlet name in the child |
| `<Comp>…</Comp>` | Implicit default slot content |
| `<Comp v-slot="scope">…</Comp>` | Default slot on the component tag, with scope |
| `<template #header>…</template>` | Named slot via `#` shorthand |
| `<template v-slot:header>…</template>` | Named slot, long form |
| `<template #header="scope">…</template>` | Named scoped slot |
| `<template #[which]>…</template>` | Dynamic slot name |
| `<template #header v-if="ok">…</template>` | Conditional slot — forces `SlotFlags.Dynamic` |
| `<template v-for="row in Rows" #row>…</template>` | Looped slot — forces `SlotFlags.Dynamic` |

### `v-slot` has no modifiers

This is the one place the template language is irregular, and it will surprise anyone who has
internalized the directive grammar. Every other directive treats a `.` as a modifier separator.
`v-slot` does not: **dots fold into the argument itself.**

```viu
@template {
    <!-- The slot is literally named "foo.bar.baz" — NOT "foo" with two modifiers. -->
    <template #foo.bar.baz>…</template>
}
```

The upstream rule is the same, but in Viu it matters more, because a slot name is a plain ordinal
dictionary key on `ComponentSlots` — a typo produces a slot the child simply never asks for, and no
diagnostic fires.

## Scoped slots

A slot outlet may pass data *back up* to the content the parent wrote. Bind anything other than
`name` on the `<slot>` element and it becomes part of the scope object:

```viu
@template {
    <ul class="rows">
        <li v-for="row in Rows">
            <slot :row="row" :selected="row == Active"></slot>
        </li>
    </ul>
}
```

The parent names the incoming scope with `v-slot`'s value:

```viu
@template {
    <DataTable :rows="Rows" v-slot="scope">
        <span>{{ scope }}</span>
    </DataTable>
}
```

Two mechanics govern what `scope` actually is:

- **`Slot` takes one `object?`, not a bag of named arguments** — the delegate signature is
  `VirtualNode?[]? Slot(object? properties)`. Hand-written C# may pass any object at all; a compiled
  `<slot :row="row" :selected="…">` builds a `VirtualNodeProperties` from the camelized non-`name`
  attributes and passes that.
- **The compiled lambda parameter is untyped** — the emitter writes the `v-slot` value through
  verbatim as the parameter of a `_withCtx` lambda, which binds to
  `Func<object?, object?[]?>`. Interpolating the whole scope (`{{ scope }}`) works; reaching into it
  (`{{ scope.Row }}`) does not yet compile. See [Not yet implemented](#not-yet-implemented).

Named scoped slots combine both syntaxes:

```viu
@template {
    <DataTable :rows="Rows">
        <template #row="scope">
            <span>{{ scope }}</span>
        </template>
        <template #empty>
            <em>No rows.</em>
        </template>
    </DataTable>
}
```

## The runtime surface

Everything the templates above compile to is public API you can call directly — which is exactly what
hand-written components do today.

### `ComponentSlots`

`Assimalign.Viu.RuntimeCore` — but note that `SlotFlags`, which its constructor and `Flag` property
take, lives in `Assimalign.Viu.Shared`, so hand-written code that names the flag needs both usings.

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

This is upstream's slots object plus the stability marker Vue stores on its hidden `_` property. Name
lookup is ordinal. Assigning `null` through the indexer **removes** the slot rather than storing a
null; the getter returns `null` for an absent name rather than throwing. The setter rejects a null
or empty name with `ArgumentException`.

### `Slot`

```csharp
public delegate VirtualNode?[]? Slot(object? properties);
```

A slot is the entire delegate — no wrapper object, no reflection, nothing to activate. That is what
keeps slots inside the AOT and trimming contract. Returning `null` or an empty array renders nothing,
which is the condition that triggers fallback.

### `ComponentSetupContext.Slots`

```csharp
public ComponentSlots? Slots { get; }
```

Note the nullability: `Slots` is `null` when the parent passed **no** slot content at all, which is
not the same as an empty `ComponentSlots`. `RenderSlot` accepts a null slot table, so you rarely need
to branch on it.

### `VirtualNodeFactory.RenderSlot`

```csharp
public static VirtualNode RenderSlot(
    ComponentSlots? slots,
    string name,
    object? properties = null,
    Func<VirtualNode?[]?>? fallback = null);
```

The `RenderHelpers` alias generated code binds to is `_renderSlot`, whose `fallback` is typed
`Func<object?[]?>?` so that generated array literals bind without a cast:

```csharp
public static VirtualNode _renderSlot(
    ComponentSlots? slots,
    string name,
    object? properties = null,
    Func<object?[]?>? fallback = null);

public static Slot _withCtx(Func<object?[]?> render);
public static Slot _withCtx(Func<object?, object?[]?> render);
```

`_withCtx` is the wrapper the compiler puts around every slot function. Both overloads simply coerce
the returned array into `VirtualNode?[]?`; the non-scoped overload discards the scope argument.

### A component using slots end to end

```csharp
using System;

using Assimalign.Viu.RuntimeCore;

namespace MyApp.Components;

public sealed class PageLayout : IComponentDefinition
{
    public string? Name => "PageLayout";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => () => VirtualNodeFactory.Element(
            "article",
            VirtualNodeFactory.Properties(("class", "layout")),
            VirtualNodeFactory.Element(
                "header",
                // Named slot with fallback content.
                VirtualNodeFactory.RenderSlot(
                    context.Slots,
                    "header",
                    null,
                    () => [VirtualNodeFactory.Element("h2", "Untitled")])),
            VirtualNodeFactory.Element(
                "section",
                // Default slot, no fallback: empty content renders nothing.
                VirtualNodeFactory.RenderSlot(context.Slots, "default")),
            VirtualNodeFactory.Element(
                "footer",
                VirtualNodeFactory.RenderSlot(context.Slots, "footer")));
}
```

Note the omitted properties argument on the three inner `Element` calls. `VirtualNodeFactory.Element`
overloads `(string, params VirtualNode?[]?)` against `(string, VirtualNodeProperties?, params
VirtualNode?[]?)`, so writing a bare `null` in the properties position with a single vnode after it
is ambiguous (`CS0121`). Drop the `null` when there are no properties, or cast it
(`(VirtualNodeProperties?)null`) when you want the shape to stay explicit.

And the parent side, supplying two of the three slots:

```csharp
var slots = new ComponentSlots
{
    ["header"] = _ => [VirtualNodeFactory.Element("h2", "Quarterly report")],
    ["default"] = _ => [VirtualNodeFactory.Element("p", "Body content.")],
    // "footer" is never assigned: the footer outlet renders empty.
};

var layout = VirtualNodeFactory.Component(new PageLayout(), null, slots);
```

A scoped slot is the same shape with the `properties` parameter actually used:

```csharp
var slots = new ComponentSlots
{
    ["row"] = scope => [VirtualNodeFactory.Element("span", scope as string ?? "none")],
};

// …and in the child's render closure:
VirtualNodeFactory.RenderSlot(context.Slots, "row", "child-scope");
// The delegate above receives "child-scope" and renders <span>child-scope</span>.
```

Because the scope crosses as `object?`, a hand-written child and its hand-written parent should agree
on a shared record type and cast once — that is the pattern to prefer over passing loose strings:

```csharp
public sealed record RowScope(int Index, string Label, bool Selected);

// child
VirtualNodeFactory.RenderSlot(context.Slots, "row", new RowScope(index, label, Selected: index == 0));

// parent
["row"] = scope => scope is RowScope row
    ? [VirtualNodeFactory.Element("span", row.Selected ? $"> {row.Label}" : row.Label)]
    : null,
```

## Slot stability and re-render cost

`ComponentSlots.Flag` decides whether a **parent-only** re-render forces the child to re-render. On
WebAssembly a skipped forced update is skipped patch work *and* skipped interop, so this flag is a
real performance lever rather than bookkeeping.

```csharp
namespace Assimalign.Viu.Shared;

public enum SlotFlags
{
    Stable = 1,
    Dynamic = 2,
    Forwarded = 3,
}
```

| Flag | Emitted when | Effect on a parent-only re-render |
| --- | --- | --- |
| `Stable` | Slot structure is fixed (the `ComponentSlots` default) | Child is **not** forced to update |
| `Dynamic` | A dynamic slot name, or `v-if`/`v-else`/`v-for` on a slot template, or nesting inside another slot or `v-for` | Child is forced to update |
| `Forwarded` | A `<slot>` outlet appears among the children — the component forwards its own slots onward | Resolved to `Stable` or `Dynamic` at vnode creation, against the forwarding component's own slot flag |

Two rules make the default safe:

- **A slot's reactive reads are still tracked by the consuming child regardless of the flag** — the
  delegate runs inside the child's render effect, so a ref read inside slot content re-renders the
  child when it changes. `Stable` only skips *forced structural* updates.
- **`PatchFlags.DynamicSlots` on the component vnode forces the update regardless** — when the
  compiler routes conditional or looped slot templates through `createSlots`, it also stamps that
  patch flag, and the renderer checks it before it ever looks at `SlotFlags`.

Verified behavior, from `SlotsTests` (`Assimalign.Viu.Shared` for `SlotFlags`,
`Assimalign.Viu.Reactivity` for `Reactive.Reference`, `Assimalign.Viu.Testing` for `TestComponent`):

```csharp
var child = new TestComponent
{
    SetupFunction = (_, context) => () =>
    {
        childRenderRuns++;
        return VirtualNodeFactory.Element("div", VirtualNodeFactory.RenderSlot(context.Slots, "default"));
    },
};
var parent = new TestComponent
{
    SetupFunction = (_, _) => () =>
    {
        var slots = new ComponentSlots(SlotFlags.Stable)
        {
            ["default"] = _ => [VirtualNodeFactory.Element("span", "slot")],
        };
        return VirtualNodeFactory.Element(
            "section",
            VirtualNodeFactory.Text(parentState.Value),
            VirtualNodeFactory.Component(child, null, slots));
    },
};

_renderer.Render(VirtualNodeFactory.Component(parent), _container);
childRenderRuns.ShouldBe(1);

// Parent re-renders its own text; stable slots + unchanged props must not force the child.
parentState.Value = "b";
_pump.RunUntilIdle();
childRenderRuns.ShouldBe(1);
```

Set `Dynamic` by hand only when you are building the `ComponentSlots` yourself *and* the set of slot
names, or the structure of a slot's output, can change between renders. Compiled templates work this
out for you.

## What the compiler emits

A component with a named slot and a default slot becomes a props bag of `_withCtx` delegates, closed
by the `("_", n)` entry carrying the `SlotFlags` value:

```csharp
// <MyButton :kind="kind">
//   <template #header="headerProperties"><b>{{ headerProperties }}</b></template>
//   <span>{{ label }}</span>
// </MyButton>
var _component_MyButton = _resolveComponent("MyButton");

return _createBlock(_openBlock(), _component_MyButton, _createProps(("kind", _ctx.kind)), _createProps(
    ("header", _withCtx((headerProperties) => new object?[]
    {
        _createElementVNode("b", null, _toDisplayString(headerProperties), 1 /* TEXT */),
    })),
    ("default", _withCtx(() => new object?[]
    {
        _createElementVNode("span", null, _toDisplayString(_ctx.label), 1 /* TEXT */),
    })),
    ("_", 1)
), 8 /* PROPS */, ["kind"]);
```

Reading that output tells you three things at a glance: which slots the parent supplied, whether each
one is scoped (a lambda parameter is present or absent), and the stability flag the compiler
inferred — `1` for `Stable` above.

## Compiler diagnostics

| # | Code | Message | Cause |
| --- | --- | --- | --- |
| 40 | `XVSlotMisplaced` | `v-slot can only be used on components or <template> tags.` | `v-slot` on a plain element, e.g. `<div v-slot="x">` |
| 37 | `XVSlotMixedSlotUsage` | `Mixed v-slot usage on both the component and nested <template>. …` | `<Comp v-slot="x"><template #header>…</template></Comp>` — scope becomes ambiguous |
| 38 | `XVSlotDuplicateSlotNames` | `Duplicate slot names found.` | Two `<template #a>` siblings under one component |
| 39 | `XVSlotExtraneousDefaultSlotChildren` | `Extraneous children found when component already has explicitly named default slot. These children will be ignored.` | Loose children alongside an explicit `<template #default>` |
| 36 | `XVSlotUnexpectedDirectiveOnSlotOutlet` | `Unexpected custom directive on <slot> outlet.` | A custom directive applied to `<slot>` itself |

See [Compiler Diagnostics](../../api/diagnostics.md) for the full table.

## Related reading

- **[Props & Fallthrough Attributes](props.md)** — the other half of the parent-to-child contract, and
  why `ComponentSlots` never appears in the prop bag.
- **[Component Events](events.md)** — passing behavior up, where slots pass markup down.
- **[Essentials > Conditional & List Rendering](../essentials/conditional-and-list.md)** — `v-if` and
  `v-for` on slot templates, which are exactly what escalate a slots object to `SlotFlags.Dynamic`.
- **[Essentials > Template Syntax](../essentials/template-syntax.md)** — the `$`-spelling remap that
  turns `$slots` into `_ctx.__slots`.
- **[Render Functions & VirtualNode](../../api/render-function.md)** — `VirtualNodeFactory` and the
  `_`-prefixed `RenderHelpers` surface in full.

## Not yet implemented

- **Destructuring a slot scope** — `#item="{ label }"` and `v-slot="{ row }"` parse correctly and
  register `label`/`row` in template scope (interpolating them resolves to the bare name, not
  `_ctx.`), but the emitted lambda parameter list is not valid C#. Name the whole scope instead:
  `#item="item"`.
- **Typed member access on a slot scope in a template** — the compiled slot lambda binds to
  `Func<object?, object?[]?>`, so the scope parameter is `object?`. `{{ scope }}` compiles;
  `{{ scope.Label }}` does not. Hand-written render functions can cast the scope themselves, as shown
  above. This is the same expression-binding work that gates destructuring.
- **`<Suspense>` `#fallback` slot handling** — `Suspense` is a marker object that throws
  `NotSupportedException` when rendered; there is no async boundary and no fallback-slot support. See
  [KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md).
- **Scoped CSS was removed on 2026-09-14** — ordinary component styles and CSS Modules remain
  supported. See [SFC CSS Features](../scaling-up/sfc-css-features.md).

See [Project status](../../roadmap/status.md) for the area-by-area picture.
