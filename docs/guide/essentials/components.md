# Components

Define reusable UI with generated single-file components or explicit C# component registrations.

> **Status:** Implemented, including typed definitions and generated catalog aggregation.

A component has four distinct lifetimes: its immutable render description, its static registration,
one authored instance per mount, and that mount's `ComponentContext`. Keeping those separate
makes activation explicit and safe under trimming and AOT.

## A component in a single file

Save this as `Counter.viu`:

```viu
<template>
    <button type="button" @click="Increment">Count: {{ Count }}</button>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count { get; } = Reactive.Reference(0);
    private void Increment() => Count.Value++;
}
```

The generator supplies `ComponentBase`, `IComponent.Setup(ComponentContext)`, and
`IComponentDefinition`. Setup runs once; the generated `ComponentRenderer` runs whenever
reactive values it read change. An authored `partial void OnSetup()` can register lifecycle
work after the context and initial parameters are available.

## Static identity and typed definitions

Generated template components carry `ComponentMetadataAttribute` and a static registration through
`IComponentDefinition.Registration`. The default registered name is the sanitized file base name.
Override it with one nonempty string literal constant in the script:

```csharp
public const string RegisteredName = "Acme.Counter";
```

Duplicate registered names and conflicting overrides produce located compiler diagnostics.
The name is ordinal; choose a distinctive prefix for reusable libraries.

Use the generated type as a non-activating handle:

```csharp
using Assimalign.Viu.Components;

ComponentNode counter = ComponentNode.For<Counter>();
```

Generation preserves default accessibility. To expose a library's typed handle, add a companion
`.cs` file in the same namespace with `public partial class Counter;`. A named invocation can
still use `new ComponentNode(ComponentReference.ForName("Acme.Counter"))`.

## Registering components

Browser builders populate generated catalogs by default. Executable compilations publish direct
catalog delegates for their own assembly and referenced catalogs; there is no runtime scanning.
For an independently owned factory:

```csharp
using Assimalign.Viu.Components;

ComponentFactory components = new();
components.RegisterGeneratedComponents();
```

Catalogs are applied in ordinal full-assembly-identity order, once per target factory. Diamond
references are deduplicated; two different registrations for the same component remain an error.
An explicit Browser factory replaces the default, so populate it before building the application.

Cohesion hosts use `builder.Services.AddComponents()`. Explicit
`GeneratedViuComponents.Register` callbacks remain available. Set
`ViuAutoRegisterGeneratedCatalogs=false` to disable publication while keeping those entry points;
libraries can opt in with `true`. See [Dynamic Components & Registration](../components/dynamic-components.md).

## The hand-written C# form

`IComponent` is the behavior contract. `IComponentDefinition` is the optional static handle;
it is not the Setup interface.

```csharp
using System;

using Assimalign.Viu.Components;
using Assimalign.Viu.Reactivity;

public sealed class Counter : IComponent, IComponentDefinition
{
    public static ComponentRegistration Registration { get; } = new(
        ComponentReference.ForName("Counter"),
        new ComponentContract(displayName: "Counter"),
        static _ => new Counter());

    public ComponentRenderer Setup(ComponentContext context)
    {
        Reference<int> count = Reactive.Reference(0);
        return frame => new ElementNode(
            new QualifiedName("button"),
            bindings: [ElementBinding.Event("click", (Action)(() => count.Value++))],
            children: [new TextNode($"Count: {count.Value}")]);
    }
}
```

Register this code-first definition explicitly with `components.Register(Counter.Registration)`.
The source generator does not discover arbitrary authored C# classes. For a small closure-based
component, `ComponentRegistration.Define(name, contract, setup)` is another explicit option.

## Inputs, events, and slots

`ComponentInvocation` carries the parent's arguments, listeners, slots, and directives. Core
resolves those inputs against `ComponentContract` into `context.Bindings` before setup.
Generated `[Parameter]` properties refresh before each render; `[Event]` partial methods emit
declared outputs. Undeclared values become fallthrough bindings according to the contract.

Components receive application services through nullable `context.Services`. There is no ambient
component-tree provide/inject API; use explicit parameters, slots, services, and state registries.

## Where to go next

- [Props](../components/props.md)
- [Component Events](../components/events.md)
- [Component v-model](../components/v-model.md)
- [Slots](../components/slots.md)
- [Component API](../../api/component.md)
