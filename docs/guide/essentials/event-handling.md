# Event Handling

Listen to DOM events with v-on, modifier and key guards, and typed C# handlers.

> **Status:** Implemented. PR #379 preserves typed event delegates through modifier wrappers.

Viu's event markup follows [Vue's event handling](https://vuejs.org/guide/essentials/event-handling.html).
The handler expression is C#. Browser payloads cross WebAssembly as a snapshot instead of a live
JavaScript Event proxy.

## Listening to events

Use `v-on:click` or `@click` with a method reference or inline statement:

```viu
<template>
    <form @submit.prevent="SaveAsync">
        <input v-model="Title" @keydown.enter.prevent="SaveAsync" />
        <button type="submit">Save {{ Title }}</button>
        <button type="button" @click="Title = string.Empty">Clear</button>
    </form>
</template>

@script {
    using System.Threading.Tasks;

    using Assimalign.Viu.Reactivity;

    public Reference<string> Title { get; } = Reactive.Reference(string.Empty);
    private Task SaveAsync() => Task.CompletedTask;
}
```

Method groups retain their declared event parameter and return type. The generator adapts them
explicitly rather than erasing a BrowserEvent delegate to object. Both synchronous and Task-returning
handlers work with guard and key modifiers. Inline handlers work without a modifier too.

## Event modifiers

| Modifier | Effect |
| --- | --- |
| `.stop` | Stop propagation. |
| `.prevent` | Prevent the browser's default action. |
| `.self` | Run only for events targeting the current element. |
| `.ctrl`, `.shift`, `.alt`, `.meta`, `.exact` | Require the specified modifier-key combination. |
| `.left`, `.middle`, `.right` | Filter mouse buttons. |
| `.once`, `.capture`, `.passive` | Configure listener attachment. |

Ordering matters for guards that return early. Do not combine passive attachment with prevention.
The wrapper keeps the same BrowserEvent instance, so prevention and propagation decisions reach
the JavaScript listener before synchronous dispatch returns.

## Key modifiers

`@keyup.enter` and key aliases filter before invoking the handler. Key guards and ordinary guards
can compose, as in `@keydown.enter.prevent`. The event's key is normalized for alias matching;
use the key name supported by BrowserEvents rather than numeric key codes.

## The event payload

`Assimalign.Viu.Components.IElementEvent` is the portable read-only contract shared by Browser
and Testing. It exposes event name, key, target value, checked state, and selected values.
`Assimalign.Viu.Browser.BrowserEvent` adds Browser-specific event data and response intents.

```csharp
using Assimalign.Viu.Browser;

private void OnSubmit(BrowserEvent browserEvent)
{
    browserEvent.PreventDefault();
}
```

Call PreventDefault or StopPropagation before the first asynchronous yield. The browser applies
those decisions when synchronous dispatch returns; a decision made after awaiting work arrives
too late. Template `.prevent` performs prevention before invoking an asynchronous method.

## The same thing in hand-written C#

```csharp
using System;

using Assimalign.Viu.Components;

ElementNode button = new(
    new QualifiedName("button"),
    bindings: [ElementBinding.Event("click", (Action)(() => Console.WriteLine("Clicked")))],
    children: [new TextNode("Click")]);
```

Bindings distinguish events from attributes explicitly. Pass a concrete delegate when constructing
one by hand; no runtime reflection discovers its signature.

## Errors inside handlers

Observed asynchronous failures use the component lifecycle error channel, ancestor capture hooks,
and the application error handler. Prefer Task over async void so completion and failure remain
observable. Component events have their own declared outputs; they are not DOM propagation.

## Related

- [Form Input Bindings](form-bindings.md)
- [Component Events](../components/events.md)
- [Lifecycle & Template Refs](lifecycle-and-template-refs.md)
