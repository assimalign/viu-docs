# Template Syntax

Write C# expressions inside familiar template markup and let the compiler produce immutable trees.

> **Status:** Implemented, including compound server interpolation, static helpers, and ARIA booleans.

## Text interpolation

`{{ expression }}` displays an expression as text. Reference members auto-unwrap in templates;
ordinary C# still uses Value. Compound text works on both client and server paths:

```viu
<template><p>{{ First }} / {{ Last }}</p></template>

@script {
    public string First => "Ada";
    public string Last => "Lovelace";
}
```

Server output escapes each displayed value and preserves separators. Interpolated text is not raw
HTML. Use v-html only with content whose trust policy the application controls.

## Expressions are C#

Use C# operators, methods, and literals. String literals use double quotes; in an HTML attribute,
single-quote the surrounding attribute when the expression needs C# strings:

```html
<p :class='IsActive ? "active" : null'>Status</p>
```

JavaScript object literals, template literals, and implicit coercions are not C# expression syntax.
Static script members are resolved with their generated declaring type as receiver, including
helper methods invoked from the template.

## Attribute bindings

`v-bind:id="Id"` and `:id="Id"` bind expressions. Dynamic arguments bind a computed attribute
name. Property/attribute modifiers select host binding policy; component inputs resolve against
their declared parameter contract.

```html
<button :disabled="IsBusy" :aria-expanded="IsOpen">Details</button>
```

HTML disabled is a boolean presence attribute. ARIA booleans are enumerated: true and false become
the lowercase string tokens `"true"` and `"false"` on Browser and server paths; null removes
the attribute. Hydration compares the same tokens, so false is not an omitted ARIA value.

## Class and style bindings

Static class/style attributes and dynamic bindings share the host's normalization policy. Use
CSS Modules for generated local class names; ordinary component styles are global. Generated CSS
v-bind() application remains deferred; see [SFC CSS Features](../scaling-up/sfc-css-features.md).

## How identifiers are rewritten

The compiler distinguishes script members, loop/slot aliases, reference members, and generated
CSS-module accessors. Script reference reads and writes target Value. Static members stay static.
`$event` is rewritten to a legal handler parameter; `$style` resolves the generated module accessor.
Typed method groups retain their declared parameter and return types.

## Skipping work: v-pre, v-once, and v-memo

v-pre treats its subtree as literal markup rather than processing directives/interpolation.
v-once caches one subtree per mount. v-memo reuses output while its dependencies compare equal;
use it only when the dependency list fully describes changing output. Compiler-generated frame
caches and handler identities are mount-local.

## Directive reference

| Directive | Purpose |
| --- | --- |
| v-bind / : | Element bindings and component arguments. |
| v-on / @ | Events, guards, and key filters. |
| v-if / v-else-if / v-else | Conditional subtrees. |
| v-for | Iteration with stable keys. |
| v-model | Native control or component-model protocol. |
| v-slot / # | Lazy slot content. |
| v-show | Toggle display while retaining the subtree. |
| v-text / v-html | Text or explicit raw HTML content. |
| v-pre / v-once / v-memo | Literal content and caching. |
| v-cloak | Compiler no-op; no runtime template compilation occurs. |

## Where to go next

- [Conditional & List Rendering](conditional-and-list.md)
- [Event Handling](event-handling.md)
- [Form Input Bindings](form-bindings.md)
- [Built-in Directives](../../api/built-in-directives.md)
