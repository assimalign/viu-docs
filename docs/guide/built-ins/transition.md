# Transition & TransitionGroup

Decorate enter/leave behavior and keyed list movement through Browser's transition components.

> **Status:** Implemented. Core owns structural sequencing; Browser owns CSS and DOM timing.

## The two layers

Transition and TransitionGroup live in Assimalign.Viu.Browser. Core operates on the host-neutral
TransitionNode/transition contracts, including cancellation and deferred removal. Browser supplies
classes, frame timing, transition-end detection, and group movement.

## Transition in a template

```viu
<template>
    <button type="button" @click="Visible = !Visible">Toggle</button>
    <Transition name="fade">
        <p v-if="Visible">Hello</p>
    </Transition>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<bool> Visible { get; } = Reactive.Reference(true);
}

<style>
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

Browser supplies built-in component resolution. A hand-written factory should preserve the
registrations required by the selected host.

## Transition props and classes

Name selects the class prefix; explicit enter/appear/leave class properties override it. Appear
opts into the initial enter effect. Duration/type can make completion policy explicit. CSS false
selects callback-owned behavior instead of automatic CSS handling.

## Transition modes

Mode controls sequencing between old and new children. Use distinct identity for alternatives
when they must be treated as separate children. Deferred leave removal and cancellation belong
to the transition lifetime rather than an arbitrary timer in application code.

## TransitionGroup

Use stable keys on repeated children. The Browser group component coordinates enter/leave and
movement; it needs actual layout and cannot be validated solely with a DOM-free renderer. Keep
list state in reactive values/collections and let the renderer preserve matching mounted identities.

## Related

- [Conditional & List Rendering](../essentials/conditional-and-list.md)
- [KeepAlive, Teleport & Suspense](deferred-built-ins.md)
- [Testing](../scaling-up/testing.md)
