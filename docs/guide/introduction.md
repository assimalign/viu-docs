# Introduction

Viu brings reactive components and compiled templates to C# and .NET WebAssembly.

> **Status:** Preview. Components, routing, State, SSR/hydration, and opt-in DevTools are implemented.

## What Viu is

Viu uses explicit reactive values and ahead-of-time template compilation to produce user interfaces.
Browser supplies the DOM host; the component model itself remains host-neutral. The same compiled
component library can participate in Browser rendering and an explicitly enabled server profile.

## A first look

```viu
<template>
    <button type="button" @click="Count++">Count: {{ Count }}</button>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count { get; } = Reactive.Reference(0);
}
```

The generator supplies component behavior and a static definition. A Browser application can use
ComponentNode.For<Counter>() and generated catalog defaults; it does not construct the component
as its root. Each mount creates an authored instance with its own reactive state.

## The founding divergences

Reactive cells use explicit Value access in C#. Reactive properties are source-generated, not
intercepted by a JavaScript Proxy. Templates contain C# expressions and compile during the build.
Setup returns a renderer rather than an Options API object. Dependencies flow through explicit
parameters, slots, application services, and state registries; there is no hierarchical provide/inject.

The .viu container combines template/style tags with C# in @script. Compatible .vue input requires
lang="csharp" for scripts. Ordinary CSS and CSS Modules are supported; scoped styles are not.

## Two hard constraints

One reactive graph follows a single host event loop and is not thread-safe. Request-oriented hosts
isolate ambient bookkeeping and own fresh render contexts. Trimming and AOT require explicit
activation and generated catalogs, not reflection scans or runtime code generation.

## Applications and hosting

Assimalign.Viu.Sdk is the host-neutral authoring SDK; Assimalign.Viu.Sdk.Browser adds WebAssembly
application behavior. Cohesion hosting supplies container composition, route integration, inferred
client output, and DI-first server rendering in the Web host's provider. See
[The Viu SDK & Build](scaling-up/sdk-and-build.md).

## Where to go next

- [Quick Start](quick-start.md)
- [Essentials](essentials/index.md)
- [Differences from Vue 3](../roadmap/vue-differences.md)
- [Project Status](../roadmap/status.md)
