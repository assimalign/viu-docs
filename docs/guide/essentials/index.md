# Essentials

Understand components, reactive state, template expressions, events, forms, and mounted lifetimes.

> **Status:** Implemented, including typed model/event glue and slot updates in PR #379.

## Before you start

Complete the Quick Start so the Browser SDK, package feed, and generated root are in place.
Templates and hand-authored projects use the same component model.

## The shape of a Viu component

IComponent.Setup(ComponentContext) runs once and returns a frame-based ComponentRenderer.
Generated SFCs provide this bridge and a static IComponentDefinition registration. Browser builds
populate generated component catalogs by default. References use Value in C# and unwrap in
templates. Context.Watch and lifecycle callbacks own component-local work.

## The chapters

- [Components](components.md)
- [Reactivity Fundamentals](reactivity-fundamentals.md)
- [Computed Properties](computed.md)
- [Template Syntax](template-syntax.md)
- [Conditional & List Rendering](conditional-and-list.md)
- [Event Handling](event-handling.md)
- [Form Input Bindings](form-bindings.md)
- [Watchers](watchers.md)
- [Lifecycle Hooks & Template Refs](lifecycle-and-template-refs.md)
