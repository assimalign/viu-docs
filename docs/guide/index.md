# Guide

Learn component authoring, reactive state, templates, and application hosting in reading order.

> **Status:** Implemented features are documented against the current PR sources; preview limits are labelled.

## How to read this guide

Begin with Introduction and Quick Start, then work through Essentials. Components In-Depth builds
on the same explicit registration, invocation, and mounted-context vocabulary. Scaling Up covers
library CSS, generated catalogs, testing, and Cohesion Web/SSR hosting.

## What a component looks like

A .viu file uses template/style tags and a C# @script block. The generator produces ComponentBase,
IComponent behavior, and IComponentDefinition metadata. Each mount receives a new instance and
context. Templates compile at build time; no runtime template compiler or reflection scan is needed.

## Getting Started

- [Introduction](introduction.md)
- [Quick Start](quick-start.md)

## Essentials

- [Components](essentials/components.md)
- [Reactivity Fundamentals](essentials/reactivity-fundamentals.md)
- [Computed Properties](essentials/computed.md)
- [Template Syntax](essentials/template-syntax.md)
- [Conditional & List Rendering](essentials/conditional-and-list.md)
- [Event Handling](essentials/event-handling.md)
- [Form Input Bindings](essentials/form-bindings.md)
- [Watchers](essentials/watchers.md)
- [Lifecycle Hooks & Template Refs](essentials/lifecycle-and-template-refs.md)

## Components In-Depth

- [Props & Fallthrough Attributes](components/props.md)
- [Component Events](components/events.md)
- [Component v-model](components/v-model.md)
- [Slots](components/slots.md)
- [Provide / Inject](components/provide-inject.md)
- [Dynamic Components & Registration](components/dynamic-components.md)

## Reusability

- [Composables](reusability/composables.md)
- [Custom Directives](reusability/custom-directives.md)

## Built-ins

- [Transition & TransitionGroup](built-ins/transition.md)
- [KeepAlive, Teleport & Suspense](built-ins/deferred-built-ins.md)

## Scaling Up

- [Single-File Components (.viu)](scaling-up/single-file-components.md)
- [SFC CSS Features](scaling-up/sfc-css-features.md)
- [The Viu SDK & Build](scaling-up/sdk-and-build.md)
- [Testing](scaling-up/testing.md)

## Best Practices

- [AOT & Trimming](best-practices/aot-and-trimming.md)
- [Performance](best-practices/performance.md)

## Beyond the guide

- [API Reference](../api/index.md)
- [Examples](../examples/index.md)
- [Project Status](../roadmap/status.md)
- [Differences from Vue 3](../roadmap/vue-differences.md)
