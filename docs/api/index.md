# API Reference

Find the public component, reactivity, application, rendering, and build contracts used by the guide.

> **Status:** Preview. References follow the Viu #379 and platforms #4 sources.

## Assembly boundaries

Components owns immutable tree descriptions, authored behavior, static registrations, and contexts.
Reactivity owns tracked values and scope abstractions; State owns explicit store registries.
Core executes mounted trees and the application lifetime. Browser supplies DOM operations;
ServerRenderer supplies host-neutral serialization. Router is host-free, with Browser.Router and
Cohesion hosting as integration layers.

## Pages by assembly

- [Reactivity API: Core](reactivity-core.md)
- [Reactivity API: Utilities & Advanced](reactivity-utilities.md)
- [Reactive Collections](reactive-collections.md)
- [Component API](component.md)
- [Application API](application.md)
- [Render Functions & VirtualNode](render-function.md)
- [Built-in Directives](built-in-directives.md)
- [MSBuild Reference](msbuild-reference.md)
- [Compiler Diagnostics](diagnostics.md)

## Rules that apply on every page

Templates compile at build time. Typed definitions and generated catalogs avoid runtime scanning;
explicit resolvers take precedence over host defaults. Each reactive graph remains single-event-loop.
See [Project Status](../roadmap/status.md) for remaining limits and package pin follow-up.
