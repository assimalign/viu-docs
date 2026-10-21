# Form Input Bindings

Bind native form controls to typed reactive state with v-model and its modifiers.

> **Status:** Implemented. Typed scalar write-back and native models inside slots work in PR #379.

## Which directive each element compiles to

| Element | Browser directive |
| --- | --- |
| Text input / textarea | `VModelText` |
| Checkbox | `VModelCheckbox` |
| Radio | `VModelRadio` |
| Select | `VModelSelect` |
| Dynamic input type | `VModelDynamic` |

The generated binding carries both the current value and the write-back operation. Ordinary
application code does not construct that carrier by hand.

## Text inputs and textarea

```viu
<template>
    <section>
        <input v-model.trim="Title" placeholder="Title" />
        <textarea v-model="Notes"></textarea>
        <p>{{ Title }} / {{ Notes.Length }} characters</p>
    </section>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<string> Title { get; } = Reactive.Reference(string.Empty);
    public Reference<string> Notes { get; } = Reactive.Reference(string.Empty);
}
```

Reference members auto-unwrap in the template on reads and writes. Native model values come from
the same event snapshot as dispatch; typing does not require a second DOM read per keystroke.
IME composition is respected.

## Modifiers

| Modifier | Behavior |
| --- | --- |
| `.lazy` | Commit on change rather than each input event. |
| `.trim` | Trim text before assignment. |
| `.number` | Apply the directive's loose number conversion before typed write-back. |

`type="number"` also selects numeric coercion. Trim/number/lazy remain directive policies;
conversion to the declared C# target type is a separate generated assignment step.

## Typed write-back

```viu
<template>
    <section>
        <input type="number" v-model.number="Quantity" />
        <input type="number" v-model.number="OptionalQuantity" />
        <p>{{ Quantity }} / {{ OptionalQuantity }}</p>
    </section>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Quantity { get; } = Reactive.Reference(1);
    public Reference<int?> OptionalQuantity { get; } = Reactive.Reference<int?>(null);
}
```

String, boolean, integral, floating-point, decimal, and nullable scalar targets are supported without
reflection. Numeric conversion uses invariant culture after .number. Null or empty nullable input
becomes null; invalid scalar conversion throws its normal conversion exception. Nullable reference
targets preserve null. Object and already-typed component payloads pass through by cast.

For a known script target the compiler uses its declared type as the conversion witness; conversion
does not introduce another target getter read. A manual `(int)$event` workaround is unnecessary.

## Checkboxes, radios, and selects

A boolean checkbox binds checked state; checkbox collections and select-multiple bind selection
values according to the Browser directives. Radios bind the selected value. Use an appropriate
model type for the control's payload, and `:value` when a value is a C# expression rather than text.
`true-value` and `false-value` customize checkbox payloads.

## Form content inside a slot

Native models also work in a wrapper's default slot:

```viu
<template>
    <FormPanel>
        <form @submit.prevent="Submit">
            <input v-model="NewTitle" />
            <button :disabled="NewTitle.Length == 0">Add {{ NewTitle }}</button>
        </form>
        <small>{{ NewTitle }}</small>
    </FormPanel>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<string> NewTitle { get; } = Reactive.Reference(string.Empty);
    private void Submit() => NewTitle.Value = string.Empty;
}
```

FormPanel supplies a default `<slot>` outlet. The compiled slot root owns a complete block of
dynamic descendants, and multiple siblings use a stable fragment. Input changes update button
text, disabled state, and sibling text without a forced parent render. No extra wrapper or manual
refresh is needed. See [Slots](../components/slots.md).

## Component models

Component `v-model` binds a parameter and a declared `update:…` event. It uses the same typed
write-back conversion but does not install a native form directive. See
[Component v-model](../components/v-model.md) for the child contract.
