# Props & Fallthrough Attributes

Declare typed component parameters, bind parent inputs, and handle fallthrough values deliberately.

> **Status:** Implemented. Inputs are declared at compile time and resolved before component setup.

## Declaring props

Viu calls a declared input a parameter. In a generated component, decorate an ordinary property:

```viu
<template>
    <h2>{{ Title }}</h2>
    <p>Step: {{ Step }}</p>
</template>

@script {
    using Assimalign.Viu.Components;

    [Parameter(IsRequired = true)]
    public string Title { get; set; } = string.Empty;

    [Parameter]
    public int Step { get; set; } = 1;
}
```

Initializers supply per-instance defaults. `[Parameter("heading")]` overrides the derived template
name. Generated setup assigns resolved parameters before OnSetup and refreshes them before each
render. Runtime code performs no attribute discovery.

## Code-first contracts

`ComponentContract.Parameters` contains `ComponentParameter` declarations. A parameter can carry
a required flag, default factory, validator, and declared type. `ComponentInvocation.Arguments`
is the raw parent input dictionary; Core resolves it into `context.Bindings.Parameters`.
See [Component API](../../api/component.md).

## Reading props

Generated templates read the authored property. Code-first components read current bindings during
their render rather than capture a stale setup-time copy. Exact, camelized, and hyphenated parameter
aliases are supported; collisions, missing required values, and invalid values use diagnostics.

## Props are one-way

The parent owns input state. Emit an event to request a change instead of mutating a parameter as
shared state. `v-model` pairs that input with a declared update event; its generated parent setter
converts to the target's declared type. See [Component v-model](v-model.md).

## Fallthrough attributes

Undeclared values remain in `Context.Bindings.FallthroughBindings`. Declared event listeners and
node lifecycle bindings are consumed separately. The component contract controls inheritance and
Core applies eligible fallthrough to a suitable root; multi-root components should route values
explicitly. Parameters, DOM properties, and attributes are different binding kinds.

Boolean `aria-*` attributes are enumerated strings on Browser, server, and hydration paths.
`false` emits `"false"`; null removes the attribute. Do not treat them as HTML presence booleans.

## See also

- [Component Events](events.md)
- [Component v-model](v-model.md)
- [Template Syntax](../essentials/template-syntax.md)
