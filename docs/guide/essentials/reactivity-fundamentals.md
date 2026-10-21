# Reactivity Fundamentals

Track state with explicit reference cells, generated reactive properties, and dedicated collections.

> **Status:** Implemented. Reactive graphs are explicit and do not use runtime proxies.

## References

```csharp
using System;

using Assimalign.Viu.Reactivity;

Reference<int> count = Reactive.Reference(0);
Computed<int> doubled = Reactive.Computed(() => count.Value * 2);
using ReactiveEffect effect = Reactive.Effect(() => Console.WriteLine(doubled.Value));
count.Value++;
```

A read inside an effect subscribes to the cell. A changed write invalidates subscribers. C# reads
and writes Value explicitly; compiled templates unwrap declared reference members automatically.
Use the Reactive factories: reference, computed, effect, and scope constructors are not the public
construction surface.

## Refs in a component

IComponent.Setup runs once per mount and returns a ComponentRenderer taking a ComponentRenderFrame.
Generated SFCs provide that bridge automatically and create a fresh authored instance per mount.

```viu
<template>
    <p>Count: {{ Count }}</p>
    <button type="button" @click="Count++">Increment</button>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count { get; } = Reactive.Reference(0);
}
```

## Reactive objects

Annotate partial classes and partial properties; the source generator emits tracking setters and
getters at build time:

```csharp
using Assimalign.Viu.Reactivity;

[Reactive]
public partial class Todo
{
    public partial string Title { get; set; }
    public partial bool Done { get; set; }
}
```

Plain objects do not become reactive by assignment to a reference. Fields are not rewritten, and
an arbitrary existing object cannot acquire generated tracking at runtime. Generated ToReferences
projections preserve property connections when sharing individual members.

## Shallow references and collections

Reactive.ShallowReference tracks replacement of the contained value, not interior mutations. Use
Reactive.TriggerReference for an explicit notification after an intentional in-place change to a
tracked shallow value. ReactiveList, ReactiveDictionary, and ReactiveSet track their collection
operations; a plain List does not. See [Reactive Collections](../../api/reactive-collections.md).

## Ownership and batching

Component setup runs in its reactive scope. Context.Watch binds watches to that scope and the
component scheduler; teardown stops them. Independently created effects/watches need an owner.
Reactive.EffectScope creates a scope and Reactive.CurrentScope reads the ambient one.

```csharp
using (Reactive.Batch())
{
    count.Value = 1;
    count.Value = 2;
}
```

Nested batches flush when the outermost lease closes. Always dispose the lease, including on
failure. Computed getters are lazy and cached; they should derive values without causing side effects.

## Threading and packaging

An individual graph remains single-event-loop and not thread-safe. Request-oriented hosts isolate
ambient tracking/scope state; this does not make externally shared reactive values concurrent.
The base Viu SDK supplies reactive generation as part of its authoring framework. Use the matching
package/SDK train, not an independently chosen analyzer build.

## Next

- [Computed Properties](computed.md)
- [Watchers](watchers.md)
- [Reactivity API: Core](../../api/reactivity-core.md)
- [Utilities & Advanced](../../api/reactivity-utilities.md)
