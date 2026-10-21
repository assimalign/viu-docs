# Single-File Components (.viu)

Compile templates, C# behavior, and component styles into runnable definitions at build time.

> **Status:** Implemented. Typed definitions, metadata, and generated catalog aggregation ship in PR #379.

## The container

The current `.viu` format uses `<template>` and `<style>` tags with a C# `@script { }` block.
Compatible `.vue` files use tag containers and require `<script lang="csharp">`. JavaScript
scripts are never executed. Legacy `@template` and `@style` blocks parse with migration warnings.

## Column 0 is structural in `@script`

The script body is a partial class body. Indent its contents; a closing brace in column zero
terminates the block. Keep `using` directives before members, with System imports first. The
file base name supplies the class name; the project RootNamespace and folder path supply its namespace.

## A complete component

Save this as `Counter.viu`:

```viu
<template>
    <section>
        <p>{{ Label() }}: {{ Count }}</p>
        <button type="button" @click="Increment">Increment</button>
    </section>
</template>

@script {
    using System;

    using Assimalign.Viu.Reactivity;

    public const string RegisteredName = "Acme.Counter";
    public Reference<int> Count { get; } = Reactive.Reference(0);

    private static string Label() => "Count";
    private void Increment() => Count.Value++;

    partial void OnSetup()
    {
        OnMounted(() => Console.WriteLine("Mounted"));
    }
}

<style>
section { font-variant-numeric: tabular-nums; }
</style>
```

Static script helpers keep their declaring-type receiver in generated code. Compound interpolation
works in Browser and direct server output; SSR escapes displayed values while retaining separators.

## What the generator emits

For a template component the generator supplies:

- A partial `ComponentBase` class implementing `IComponent` and `IComponentDefinition`.
- `ComponentMetadataAttribute` with the registered name, plus a static registration and contract.
- Setup glue assigning Context, binding parameters, and calling the authored `OnSetup` hook.
- A frame-based client render method, including cache size, block plans, and typed handler glue.
- A direct server-render method and render catalog when `ViuServerRendering=true`.
- Public assembly catalog metadata and explicit `GeneratedViuComponents.Register` entry points.

Renderless files retain their existing behavior; the template bridge is not synthesized for every
arbitrary script file. Do not author members that collide with generated Context or OnSetup members.

### Registered names and public handles

The default name is the sanitized file base name. One nonempty string literal constant named
`RegisteredName` overrides it. Conflicting constants or duplicate registered names report located
diagnostics and omit conflicting catalog entries. Distinct generated types remain available.

Generation preserves default accessibility. Add `public partial class Counter;` in a companion
file in the same namespace to expose a reusable library's typed handle. Then consumers can call
`ComponentNode.For<Counter>()` or `routes.Add<Counter>("/counter", "Counter")`.

### Binding classification

Declared reference members auto-unwrap in templates; C# code still uses Value. Model assignment
converts the payload to the target's declared scalar or nullable type without reflection. Known
targets use type information rather than evaluating the getter again. Single-argument method-group
listeners retain declared parameter and return types, including Task-returning handlers.

## Build integration

Base-SDK libraries compile components without a Browser dependency. Browser executables aggregate
their own and referenced catalogs by default and populate their default factory. Other hosts call
`RegisterGeneratedComponents()` and `RegisterGeneratedRenders()`. Explicit factories/catalogs
replace automatic defaults. `ViuAutoRegisterGeneratedCatalogs=false` retains explicit catalogs
while disabling module publication; libraries can opt in with true.

Styles flow over PackageReference and ProjectReference. Library links are injected before the
application bundle; see [SFC CSS Features](sfc-css-features.md). Ordinary styles are global, and
CSS Modules provide local class names. Scoped CSS is unsupported; generated reactive CSS
`v-bind()` application remains deferred.

## Diagnostics

Diagnostics map to authored component locations. Invalid expressions, declaration conflicts,
unsupported script shapes, and duplicate registrations are build errors rather than runtime
discovery failures. The editor and compiler share the authoring contract. See
[Compiler Diagnostics](../../api/diagnostics.md) for the descriptor families and catalogs.

## The parser as an API

The syntax packages expose build-time parsing and compilation; ordinary application code should
consume the generated component contracts instead. Runtime template compilation, reflection-based
activation, and JavaScript script execution are outside Viu's design.

## Not yet implemented

- SCSS/LESS preprocessing is not installed by a lang option.
- Generated reactive application of CSS `v-bind()` expressions remains deferred.
- See [Project Status](../../roadmap/status.md) for remaining preview limits.

## See also

- [Components](../essentials/components.md)
- [The Viu SDK & Build](sdk-and-build.md)
- [Component API](../../api/component.md)
