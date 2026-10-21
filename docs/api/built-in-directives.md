# Built-in Directives

The template directives, their runtime boundaries, and links to complete authoring examples.

> **Status:** Implemented. Native/component models and modifier/key handlers use typed generated glue.

## The table

| Directive | Shorthand | Behavior |
| --- | --- | --- |
| v-if / v-else-if / v-else | — | Conditional branches with distinct identity. |
| v-for | — | Collection iteration; :key supplies sibling identity. |
| v-bind | : | Bind an expression to an attribute, property, or component input. |
| v-on | @ | Native or component listener. |
| v-model | — | Native form binding or a component parameter/update-event pair. |
| v-show | — | Retain the subtree and toggle display. |
| v-text | — | Set text content. |
| v-html | — | Set raw HTML; the application owns content trust. |
| v-slot | # | Declare lazy named/default slot content. |
| v-pre | — | Skip template interpretation in a subtree. |
| v-once | — | Cache one subtree per mount. |
| v-memo | — | Reuse output while declared dependencies compare equal. |
| v-cloak | — | Compile-time no-op. |

## Structural directives

Conditional and loop transforms produce immutable trees and render plans. Keep v-else adjacent
to its preceding branch. Put a loop key on the repeated root, including a template grouping
several siblings. See [Conditional & List Rendering](../guide/essentials/conditional-and-list.md).

## Binding directives

Bindings preserve the distinction between host attributes, properties, and listeners. Boolean
ARIA attributes serialize to lowercase true/false tokens; null removes them. Browser, server,
and hydration apply the same rule. See [Template Syntax](../guide/essentials/template-syntax.md).

## v-on

Method groups, inline statements, modifier guards, and key filters are supported. Generated native
event glue preserves the concrete Browser event delegate, including Task-returning methods, and
passes the same event instance through wrappers. A .prevent guard runs before an async handler
yields. See [Event Handling](../guide/essentials/event-handling.md).

## v-model

Browser selects VModelText, VModelCheckbox, VModelRadio, VModelSelect, or VModelDynamic for native
controls. Generated bindings carry a setter; typed write-back supports scalar and nullable targets
without reflection. Trim/lazy/number stay directive policies. Invalid scalar conversion throws
normally; null/empty nullable input becomes null. Native models inside slots update nested dynamic
content. See [Form Input Bindings](../guide/essentials/form-bindings.md).

For components the default protocol is modelValue plus update:modelValue; named models use their
named input/update pair. See [Component v-model](../guide/components/v-model.md).

## Content and caching directives

Interpolation and v-text display text; only v-html inserts raw markup. v-once and v-memo use
mount-local frame caches. Include every changing dependency in memo input; otherwise cached output
can correctly remain unchanged according to the incomplete dependency contract you supplied.

## Custom directives

Runtime directives resolve through an explicit IDirectiveResolver. They receive an invocation
value and host/lifecycle data; component registration and directive registration are separate.
See [Custom Directives](../guide/reusability/custom-directives.md).

## Slot outlets and dynamic components

`<slot>` invokes lazy content or fallback; generated roots track their dynamic descendants.
`<component :is>` selects a component dynamically. For typed C# requests use
ComponentNode.For<T>(); named requests use ComponentReference.ForName. See
[Slots](../guide/components/slots.md) and
[Dynamic Components & Registration](../guide/components/dynamic-components.md).
