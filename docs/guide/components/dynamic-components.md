# Dynamic Components & Registration

Select components dynamically and compose generated or explicit registrations without runtime scanning.

> **Status:** Implemented. Typed definitions and generated catalogs are available in PR #379.

## `<component :is>` in a template

```viu
<template>
    <component :is="Selected" />
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<string> Selected { get; } = Reactive.Reference("HomePage");
}
```

The selected registered name must resolve in the application's component factory. For explicit
C# construction, use `ElementNode` for an element and `ComponentNode` for a component; their
identities are different contracts.

## The runtime behind it

```csharp
using Assimalign.Viu.Components;

ComponentNode named = new(ComponentReference.ForName("HomePage"));
ComponentNode typed = ComponentNode.For<HomePage>();
```

`ComponentNode.For<T>()` requires `IComponentDefinition`. It reads the exact static registration
reference without constructing a component. Generated template classes implement that interface;
code-first components may implement it explicitly.

## Registering components by name

The generated name defaults to the sanitized file base name. A script can override it with
`public const string RegisteredName = "Acme.Home";`. Duplicate names in one compilation report
diagnostics; conflicts between distinct runtime catalogs throw. Registered-name identity is ordinal.

Browser applications normally leave `ApplicationOptions.Components` at its default. Generated
module initialization publishes the application's and referenced assemblies' catalog delegates,
and the builder populates its factory. A supplied factory takes precedence and is not supplemented.

```csharp
using Assimalign.Viu.Components;

ComponentFactory components = new();
components.RegisterGeneratedComponents();
```

Full assembly identity keeps assemblies sharing a root namespace distinct. Catalogs apply in
deterministic order once per factory, including diamond reference graphs. Existing registrations
survive hot reload; replacing a published delegate affects newly populated factories.

## Cohesion registration

```csharp
using Assimalign.Cohesion.Viu.Hosting;

builder.Services.AddComponents();
builder.UseRootComponent<App>();
```

Parameterless `AddComponents()` explicitly adds generated aggregates alongside other component
contributions. Without any contributions or a supplied factory, generated catalogs are also the
builder default. An explicit `ConfigureApplication` factory overrides contributions. Repeated
generated contributions are idempotent; conflicting explicit registrations remain errors.

## Explicit catalogs and opt-out

`GeneratedViuComponents.Register` remains an explicit entry point. With several libraries,
aggregation avoids generated-type aliases and registration boilerplate. Set
`ViuAutoRegisterGeneratedCatalogs=false` to disable module publication while retaining explicit
catalogs and their compile-time metadata. Libraries opt in with `true` when they need publication.

Library typed handles need an authored public partial declaration. A catalog can still activate
an internal generated component by its registered name. See [Components](../essentials/components.md)
and [The Viu SDK & Build](../scaling-up/sdk-and-build.md).
