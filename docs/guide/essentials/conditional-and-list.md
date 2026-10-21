# Conditional & List Rendering

Choose subtrees with v-if and render reactive collections with v-for and stable keys.

> **Status:** Implemented. Conditional and keyed descendants also update inside compiled slot blocks.

## Conditional rendering

v-if creates or removes a branch. v-else-if and v-else continue the adjacent branch chain. v-show
keeps the subtree mounted and changes its display state. Pick based on whether retaining the
component's lifetime is desirable, not just how the markup looks.

```viu
<template>
    <section>
        <button type="button" @click="Visible = !Visible">Toggle</button>
        <p v-if="Visible">Visible branch</p>
        <p v-else>Alternate branch</p>
    </section>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<bool> Visible { get; } = Reactive.Reference(true);
}
```

Generated branch keys keep alternate branches distinct. Inside a slot, the slot root collects
the dynamic branch descendants; no forced parent render is necessary.

## List rendering

```viu
<template>
    <ul>
        <li v-for="(item, index) in Items" :key="item">{{ index }}: {{ item }}</li>
    </ul>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public ReactiveList<string> Items { get; } = new() { "First", "Second" };
}
```

The second alias for an enumerable is its index; it does not destructure a tuple element. Access
tuple members explicitly when the source contains tuples. Dictionary iteration can expose value,
key, and index. Give sibling rows stable data keys; avoid index keys when insertion/reordering
should retain a row's component state.

ReactiveList tracks index, length, and iteration reads. Adding/removing items notifies structural
readers. A plain List is not reactive; replacing a reference to it or using ReactiveList makes the
structural change observable. Nested ordinary objects still need reactive members for tracked
property changes.

## Watching a collection

Use a getter and Deep options when watching collection contents:

```csharp
using System;

using Assimalign.Viu.Reactivity;

ReactiveList<string> items = new();
using WatchHandle watch = Reactive.Watch(
    () => items,
    (value, previous, cleanup) => Console.WriteLine(value.Count),
    new WatchOptions { Deep = true });
```

Inside a component use context.Watch for a simple scope-owned pre-flush getter watch, or supply
the component scheduler and scope explicitly when using advanced WatchOptions.

## A note on string literals in conditions

Template expressions are C#. Use double-quoted strings inside a single-quoted attribute. A
single-quoted multi-character token is not a C# string. See [Template Syntax](template-syntax.md).

## Related

- [Reactive Collections](../../api/reactive-collections.md)
- [Slots](../components/slots.md)
- [Performance](../best-practices/performance.md)
