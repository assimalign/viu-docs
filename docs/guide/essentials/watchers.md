# Watchers

Run side effects when reactive values change and bind their cleanup to the right lifetime.

> **Status:** Implemented. ComponentContext supplies scope-owned pre-flush watches.

## Read this first: flush timing

Standalone Reactive.Watch defaults to WatchFlushMode.Synchronous. ComponentContext.Watch supplies
the component's scope and scheduler and requests Pre delivery. Pre/Post options need an
IReactiveWatchScheduler; without one, Reactivity falls back to synchronous delivery.

## Watching a single reference

```csharp
using System;

using Assimalign.Viu.Reactivity;

Reference<string> query = Reactive.Reference(string.Empty);
using WatchHandle watch = Reactive.Watch(
    query,
    (value, previous, onCleanup) => Console.WriteLine($"{previous} -> {value}"));
query.Value = "Viu";
```

## The source shapes

Watch accepts a typed IReactiveReference<T>, a getter, a source-generated IReactiveObject,
an array of references, or an array of getters. Collections use a getter plus deep traversal;
they are not source-generated objects. Plain CLR properties are leaves unless their getters
read something tracked.

## The callback and its cleanup

WatchCallback<T> receives current value, previous value, and an onCleanup registration function.
Cleanup runs before the next callback and on stop. Start longer work under an explicit owner and
cancel stale work through cleanup; the watch callback itself is synchronous.

## WatchOptions

Immediate runs the first callback eagerly; Once stops after the first callback. Deep and DeepDepth
control reflection-free traversal. Flush and Scheduler select delivery. A deep object callback
receives the same mutated instance as both values; it is not an automatic snapshot.

## WatchEffect

Reactive.WatchEffect tracks the reads performed by its body and reruns on invalidation. It also
accepts a cleanup callback form. Use Watch when the source should be explicit and WatchEffect when
the effect's synchronous reads define the dependencies.

## Flush timing inside a component

```viu
<template><input v-model="Query" /></template>

@script {
    using System;

    using Assimalign.Viu.Reactivity;

    public Reference<string> Query { get; } = Reactive.Reference(string.Empty);

    partial void OnSetup()
    {
        Context!.Watch(() => Query.Value, (value, previous) => Console.WriteLine(value));
    }
}
```

The callback receives two values. For advanced options, run Reactive.Watch inside Context.Scope
and supply Context.WatchScheduler in WatchOptions. Do not use the retired ViuWatch static API.

## WatchHandle: stop, pause, resume

Stop/Dispose detach the watcher and run pending cleanup. Pause defers reaction; Resume permits
pending work to run. Keep handles for independently owned watches and dispose them with that owner.

## Automatic teardown

Generated setup runs inside a component-owned reactive scope. Context.Watch explicitly attaches
to it and stops on unmount. A watcher created later outside the scope needs explicit ownership.
An asynchronous callback does not make all subsequent work automatically component-owned.

## Related

- [Computed Properties](computed.md)
- [Composables](../reusability/composables.md)
- [Reactivity API: Core](../../api/reactivity-core.md)
