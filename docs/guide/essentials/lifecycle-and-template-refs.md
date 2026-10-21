# Lifecycle Hooks & Template Refs

Own asynchronous work and cleanup through the mounted context, and expose values to a parent.

> **Status:** Implemented. Lifecycle task failures and generated listener tasks remain observable.

## Registering a hook

Inside a generated component, implement OnSetup and register instance-owned callbacks:

```viu
<template><p>Ready</p></template>

@script {
    using System;
    using System.Threading;
    using System.Threading.Tasks;

    partial void OnSetup()
    {
        OnMounted(LoadAsync);
        OnUnmounted(() => Console.WriteLine("Unmounted"));
    }

    private Task LoadAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}
```

Generated root conveniences register the same callbacks, in the same order, as
`Context!.Lifecycle.OnMounted`. Context is assigned before OnSetup; it is unavailable during
construction and field initialization. Code-first components use the context passed to Setup.

## The hook catalogue

| Phase | Registration |
| --- | --- |
| Initial mount | OnBeforeMount, OnMounted |
| Later patch | OnBeforeUpdate, OnUpdated |
| Teardown | OnBeforeUnmount, OnUnmounted |
| Retained component | OnActivated, OnDeactivated |
| Descendant error | OnErrorCaptured |
| Server data preparation | OnServerPrefetch |

Ordinary phases accept Action, Func<Task>, or Func<CancellationToken, Task>. Tasks start in
registration order without blocking progression. Server rendering awaits server-prefetch work
before serialization; client-only rendering does not run that phase.

## Capturing errors

Error-capture callbacks receive exception, source context, and information. Returning false stops
propagation. Otherwise errors continue through ancestors to ApplicationOptions.ErrorHandler.
Generated Task-returning component listeners use the same observation path. Avoid async void.

## Cancellation and teardown

The component token is canceled after before-unmount callbacks start and before effect-scope and
subtree teardown. Use it for instance-owned asynchronous work. Watches created through context.Watch
stop with that context's scope. Keep externally owned resources in their owning composition root.

## Template refs

A mount reference receives a host value for an element or a component's exposed value. In code-first
trees, pass a `MountReference` callback through the node's mountReference argument. A component
publishes its public parent-facing value with `context.Expose(value)`. This does not expose Core's
mutable mounted bookkeeping or make arbitrary component internals public.

Observe refs after the host commit, and handle their clearing during teardown. Browser element
values are host handles rather than live JavaScript DOM proxies. See
[Component API](../../api/component.md) and [Testing](../scaling-up/testing.md).

## Timing

Setup is synchronous. It registers work and returns a render function; it does not return Task.
The scheduler orders pre-flush watches, rendering/commits, and post-flush work. Hook registration
belongs to the mounted context, not an ambient static Lifecycle class.
