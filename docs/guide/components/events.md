# Component Events

Declare typed component outputs and consume them with C# listeners in a parent template.

> **Status:** Implemented. Typed method-group listeners and Task observation work in PR #379.

## Emitting and declaring events

Save this child as `QuantityPicker.viu`:

```viu
<template>
    <button type="button" @click="Choose">Choose 2</button>
</template>

@script {
    using Assimalign.Viu.Components;

    [Event]
    public partial void Selected(int quantity);

    private void Choose() => Selected(2);
}
```

The generator declares selected in the static contract and implements the method as a typed
Context.Emit call. An explicit `[Event("selection-changed")]` overrides the derived event name.
Code-first contracts declare `ComponentEvent` entries and call `context.Emit(name, arguments)`.

## A parent and child, end to end

```viu
<template>
    <QuantityPicker @selected="OnSelectedAsync" />
    <p>Selected: {{ Quantity }}</p>
</template>

@script {
    using System.Threading.Tasks;

    using Assimalign.Viu.Reactivity;

    public Reference<int> Quantity { get; } = Reactive.Reference(0);

    private Task OnSelectedAsync(int quantity)
    {
        Quantity.Value = quantity;
        return Task.CompletedTask;
    }
}
```

The method group keeps its declared int parameter and Task return type. Generated listener glue
supplies a concrete delegate type; it does not ask C# to infer a method group from object. A
synchronous return value is discarded; Task and Task<T> completion remain observable. Avoid async
void because its completion and exceptions cannot be owned by the component lifetime.

## Payload behavior and once handlers

`ComponentEventListener` receives an immutable ordered argument list and returns void. Generated
authoring adapts typed methods to that low-level contract and observes their tasks. Event names
belong to the component contract; declared listeners are consumed rather than falling through as
DOM attributes. A `.once` listener is consumed on its first dispatch.

## Native DOM events versus component events

DOM listeners receive host event data and can use propagation/default-action guards. Component
events deliver the child's declared arguments to the parent's listener and do not bubble through
the component tree. Use the child's exact event name and matching C# payload type.

For Browser modifier/key handlers, see [Event Handling](../essentials/event-handling.md). Typed
method groups work on both sides; component listeners do not turn into BrowserEvent payloads.

## update:modelValue is an event

`[Event("update:modelValue")]` pairs with a modelValue parameter for component v-model. The parent
performs typed assignment when the event arrives. See [Component v-model](v-model.md).

## Errors inside a handler

Generated Task-returning component listeners use ComponentLifecycle task observation. Failures
flow through ancestor error-capture callbacks and ApplicationOptions.ErrorHandler, and owned work
is observed during teardown. This avoids losing an asynchronous failure behind a void adapter.

## See also

- [Props](props.md)
- [Component API](../../api/component.md)
- [Lifecycle & Template Refs](../essentials/lifecycle-and-template-refs.md)
