# Viu

Build reactive C# user interfaces with compiled components and explicit application composition.

> **Status:** Preview. This documentation follows Viu #379 and viu-platforms #4.

## A component, end to end

Generated .viu components are runnable definitions. Browser applications use a typed
ComponentNode.For<App>() root and generated catalog defaults; Cohesion adds DI, routing, and
Web hosting. Templates provide supported application and library starting points.

## What works today

Components, reactivity, State, routing, Browser rendering, server rendering/hydration, structural
built-ins, component CSS, and opt-in DevTools are implemented. PR #379 fixes typed model/event glue,
slot updates, compound SSR text, static helpers, referenced library styles, and ARIA booleans.

## Preview limits

Ordinary component styles and CSS Modules are supported; scoped CSS is unsupported and generated
reactive CSS v-bind() application remains deferred. Runtime template compilation and ambient
component-tree provide/inject are deliberate omissions. PR package pins must move to compatible
merged builds after the upstream PRs merge.

## Guide

**Getting started**

- [Guide](guide/index.md)
- [Introduction](guide/introduction.md)
- [Quick Start](guide/quick-start.md)

**Essentials**

- [Essentials](guide/essentials/index.md)
- [Components](guide/essentials/components.md)
- [Reactivity Fundamentals](guide/essentials/reactivity-fundamentals.md)
- [Computed Properties](guide/essentials/computed.md)
- [Template Syntax](guide/essentials/template-syntax.md)
- [Conditional & List Rendering](guide/essentials/conditional-and-list.md)
- [Event Handling](guide/essentials/event-handling.md)
- [Form Input Bindings](guide/essentials/form-bindings.md)
- [Watchers](guide/essentials/watchers.md)
- [Lifecycle Hooks & Template Refs](guide/essentials/lifecycle-and-template-refs.md)

**Components in depth**

- [Components In-Depth](guide/components/index.md)
- [Props & Fallthrough Attributes](guide/components/props.md)
- [Component Events](guide/components/events.md)
- [Component v-model](guide/components/v-model.md)
- [Slots](guide/components/slots.md)
- [Provide / Inject](guide/components/provide-inject.md)
- [Dynamic Components & Registration](guide/components/dynamic-components.md)

**Reusability**

- [Composables](guide/reusability/composables.md)
- [Custom Directives](guide/reusability/custom-directives.md)

**Built-ins**

- [Transition & TransitionGroup](guide/built-ins/transition.md)
- [KeepAlive, Teleport & Suspense](guide/built-ins/deferred-built-ins.md)

**Scaling up**

- [Single-File Components (.viu)](guide/scaling-up/single-file-components.md)
- [SFC CSS Features](guide/scaling-up/sfc-css-features.md)
- [The Viu SDK & Build](guide/scaling-up/sdk-and-build.md)
- [Testing](guide/scaling-up/testing.md)

**Best practices**

- [AOT & Trimming](guide/best-practices/aot-and-trimming.md)
- [Performance](guide/best-practices/performance.md)

## API Reference

- [API Reference](api/index.md)
- [Reactivity API: Core](api/reactivity-core.md)
- [Reactivity API: Utilities & Advanced](api/reactivity-utilities.md)
- [Reactive Collections](api/reactive-collections.md)
- [Component API](api/component.md)
- [Application API](api/application.md)
- [Render Functions & VirtualNode](api/render-function.md)
- [Built-in Directives](api/built-in-directives.md)
- [MSBuild Reference](api/msbuild-reference.md)
- [Compiler Diagnostics](api/diagnostics.md)

## Examples

- [Examples](examples/index.md)
- [Stopwatch](examples/stopwatch.md)

## Roadmap

- [Project Status](roadmap/status.md)
- [Differences from Vue 3](roadmap/vue-differences.md)
