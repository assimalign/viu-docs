# Component v-model

Express a parameter and update event as a two-way binding with typed C# write-back.

> **Status:** Implemented, including typed and nullable targets in PR #379.

## What v-model compiles to

`<QuantityPicker v-model="Quantity" />` passes modelValue and listens for update:modelValue.
A named model such as `v-model:enabled` instead pairs enabled with update:enabled.
These are ordinary declared component inputs and events, not shared mutable child state.

## Implementing the child

Save this as `QuantityPicker.viu`:

```viu
<template>
    <button type="button" @click="Increment">Quantity: {{ ModelValue }}</button>
</template>

@script {
    using Assimalign.Viu.Components;

    [Parameter]
    public int ModelValue { get; set; }

    [Event("update:modelValue")]
    public partial void UpdateModelValue(int value);

    private void Increment() => UpdateModelValue(ModelValue + 1);
}
```

The generated partial event method calls Context.Emit with the declared event name and typed
payload. The child requests an update; the parent owns the model.

## Wiring the parent

```viu
<template>
    <QuantityPicker v-model="Quantity" />
    <p>Selected: {{ Quantity }}</p>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Quantity { get; } = Reactive.Reference(1);
}
```

Generated assignment writes Quantity.Value using its declared int type. No object-to-int cast is
needed in the template. An ordinary writable property can be a target too; its reads must still
participate in reactivity if changing it should schedule a render.

## Multiple models on one component

Each named model has an independent parameter and update event. For example, declare a bool
Enabled parameter and `[Event("update:enabled")]` partial method, then use
`v-model:enabled="Enabled"` in the parent. Keep canonical event names exact.

## Modifiers

Component-model modifiers are part of the component's model protocol. They do not install a native
VModelText directive on the child. A component that supports modifiers must consume the generated
modifier input and apply its chosen policy. Native `.trim`, `.lazy`, and `.number` behavior is
described in [Form Input Bindings](../essentials/form-bindings.md).

## Typed assignment

Scalar targets include string, bool, integral, floating-point, decimal, and nullable variants.
Numeric conversion uses invariant culture after directive number coercion; null/empty nullable
input becomes null. Invalid conversions throw normally. Nullable reference targets preserve null,
and object or already-typed component payloads pass through by cast. Conversion uses declared type
information and does not add a second getter evaluation for known script targets.

## Compiler diagnostics and limits

A model target must be writable. A child should emit a declared event rather than mutate its input.
Model conversion is reflection-free; it does not deserialize arbitrary objects. See
[Compiler Diagnostics](../../api/diagnostics.md) and [Component Events](events.md).
