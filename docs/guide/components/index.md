# Components In-Depth

Compose explicit parameters, outputs, lazy slots, services, and generated component definitions.

> **Status:** Implemented, including typed component v-model and Task-returning listeners.

## Before you start

Read Essentials > Components first. Static registration, authored behavior, immutable invocation,
and mounted context have distinct lifetimes. A typed ComponentNode handle does not construct its
component; application composition supplies its registration.

## The contract

IComponent owns Setup(ComponentContext). IComponentDefinition supplies a static Registration for
typed roots/routes. Generated template classes implement both. Parameters and declared events
become a ComponentContract; parent arguments, listeners, and slots form a ComponentInvocation.

## Registration

Generated catalogs aggregate across references at compile time. Browser uses them by default;
Cohesion exposes AddComponents(). RegisteredName overrides file-derived names, and a public partial
companion exposes library types. An explicit factory takes precedence over automatic defaults.

## In this section

- [Props & Fallthrough Attributes](props.md)
- [Component Events](events.md)
- [Component v-model](v-model.md)
- [Slots](slots.md)
- [Provide / Inject](provide-inject.md)
- [Dynamic Components & Registration](dynamic-components.md)

## Related reading

- [Essentials > Event Handling](../essentials/event-handling.md)
- [Essentials > Lifecycle Hooks & Template Refs](../essentials/lifecycle-and-template-refs.md)
- [Reusability > Composables](../reusability/composables.md)
- [Component API](../../api/component.md)
