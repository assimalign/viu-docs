# Slots

Pass lazy template content to a child while keeping state and handler ownership explicit.

> **Status:** Implemented. PR #379 fixes dynamic descendants inside slot roots, including native models.

## Slot content and outlets

A child declares an outlet; save this as `FormPanel.viu`:

```viu
<template>
    <section class="panel">
        <header><slot name="header">Form</slot></header>
        <slot></slot>
    </section>
</template>
```

A parent supplies default content directly and named content with `<template #header>`. The
long spelling is `v-slot:header`. Outlet children are fallback content when no slot is supplied.

## Render scope

Slot content reads the declaring parent's members. Its lazy function executes during the outlet's
render; reactive reads subscribe that invoking render effect. Generated caches and handlers remain
owned by the declaring mount. Slots are not eager child arrays or a second component instance.

## Dynamic slot content and native models

```viu
<template>
    <FormPanel>
        <template #header><h2>New item</h2></template>
        <form @submit.prevent="Submit">
            <input v-model="NewTitle" />
            <button :disabled="NewTitle.Length == 0">Add {{ NewTitle }}</button>
        </form>
        <small>{{ NewTitle }}</small>
    </FormPanel>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<string> NewTitle { get; } = Reactive.Reference(string.Empty);
    private void Submit() => NewTitle.Value = string.Empty;
}
```

A single-element slot root collects its dynamic descendants in its own block, including when the
root has event or binding patch flags. Multiple siblings form a stable fragment block. Model
changes therefore update nested text, disabled state, conditional branches, and keyed descendants
without an unrelated declaring-component render. If a slot throws, incomplete block assembly is
discarded before the error propagates. No force-update workaround is required.

## Scoped slots

An outlet may supply named arguments to its slot function. Name the whole scope and read the
argument dictionary rather than assuming JavaScript destructuring syntax is C#:

```viu
<template>
    <RowList>
        <template #item="scope">{{ scope["label"] }}</template>
    </RowList>
</template>
```

The child supplies label in its item outlet. Slot arguments are an
`IReadOnlyDictionary<string, object?>`; cast application payloads explicitly when accessing members.

## The C# form

```csharp
using System.Collections.Generic;

using Assimalign.Viu.Components;

ComponentInvocation invocation = new(slots: new Dictionary<string, ComponentSlot>
{
    ["default"] = arguments => new TextNode("Slot content"),
});
```

Slot functions return a fresh subtree or null. The child reads them through Context.Bindings.Slots.
`ComponentInvocation.SlotStability` defaults to Stable for fixed hand-built slot sets. Choose
Dynamic when the slot structure changes and Forwarded when forwarding a parent's slot set.
An optimistic stability declaration can incorrectly suppress a child update.

## See also

- [Form Input Bindings](../essentials/form-bindings.md)
- [Component API](../../api/component.md)
- [Render Functions & VirtualNode](../../api/render-function.md)
