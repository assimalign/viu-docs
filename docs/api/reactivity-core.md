# Reactivity API: Core

The reference, computed, effect, scope, and watcher factories in Assimalign.Viu.Reactivity.

> **Status:** Implemented. Construction is through Reactive and the explicit scope abstractions.

## Vue-to-Viu naming map

| Vue concept | Viu |
| --- | --- |
| ref / shallowRef | Reactive.Reference / Reactive.ShallowReference |
| customRef | Reactive.CustomReference |
| computed | Reactive.Computed |
| effect | Reactive.Effect |
| effectScope / getCurrentScope | Reactive.EffectScope / Reactive.CurrentScope |
| onScopeDispose | Reactive.OnScopeDispose |
| watch / watchEffect | Reactive.Watch / Reactive.WatchEffect |

## References

```csharp
using Assimalign.Viu.Reactivity;

Reference<int> count = Reactive.Reference(0);
IReactiveReference<int> writable = count;
IReactiveReadOnlyReference<int> readable = count;
count.Value++;
```

IReactiveReference is the untyped read contract; IReactiveReadOnlyReference<T> adds a typed getter
and IReactiveReference<T> adds a setter. First-party values retain the ReactiveValue hierarchy for
engine dispatch. Use factories rather than constructors for Reference, ShallowReference,
CustomReference, and Computed.

Reactive.CustomReference receives track/trigger delegates and returns a getter/setter pair.
Reactive.TriggerReference accepts IReactiveTrackedReference and forces notification; a projection
without a dependency cell is not that contract.

## Computed<T>

Reactive.Computed<T>(getter, setter: null) creates a lazy cached derivation. Supplying a setter
makes it writable; getter-only writes throw. Computed getters should be pure and may compose
other computeds. See [Computed Properties](../guide/essentials/computed.md).

## Effects

Reactive.Effect(action, scheduler: null) creates and immediately runs an effect. Later invalidations
invoke its scheduler when supplied, otherwise rerun it. A failed first run stops subscriptions
before propagating. Run executes explicitly; Stop/Dispose perform idempotent teardown.

## Effect scopes

```csharp
using System;

using Assimalign.Viu.Reactivity;

using EffectScope scope = Reactive.EffectScope(detached: true);
scope.Run(() => Reactive.WatchEffect(() => Console.WriteLine(count.Value)));
```

Scopes own effects created during Run and invoke registered cleanup on stop. Nested scopes join
their parent unless detached. Read the current scope through Reactive.CurrentScope. For abstract
ownership, IReactiveEffectScopeFactory / ReactiveEffectScopeFactory create IReactiveEffectScope
instances. Do not call nonpublic constructors or the internal EffectScope.Current accessor.

## Watchers

Reactive.Watch accepts a typed reference, getter, generated reactive object, reference array, or
getter array. Its WatchCallback<T> receives current, previous, and OnCleanup. Deep object watches
observe mutations rather than clone snapshots. Collections require the getter form.

| WatchOptions member | Meaning |
| --- | --- |
| Immediate | Run the first callback immediately. |
| Once | Stop after the first callback. |
| Deep / DeepDepth | Enable and bound reflection-free traversal. |
| Flush | Synchronous (default), Pre, or Post. |
| Scheduler | Explicit IReactiveWatchScheduler for scheduled delivery. |

Reactive.WatchEffect tracks synchronous reads in its effect body. The cleanup form receives
OnCleanup. WatchHandle supports Stop, Pause, Resume, and Dispose. Stop runs pending cleanup.

## Component-bound watches

ComponentContext.Watch(getter, callback) is the component-owned convenience. Its two-argument
callback receives current/previous values; the method requests Pre scheduling and enters the
context's scope. For advanced options, use Reactive.Watch inside that scope with WatchScheduler.
Generated SFC setup already has a reactive scope. The retired ViuWatch static mirror is not part
of the current component API.

## Batching and threading

Reactive.Batch returns a disposable lease; the outermost disposal flushes queued invalidations.
Each graph remains single-event-loop and not thread-safe. Reactive.EnterExecutionFlow isolates
ambient tracking/batching/scope bookkeeping for independent host flows; it neither clones nor
disposes reactive objects. Request-oriented Viu hosts own this boundary.

## See also

- [Utilities & Advanced](reactivity-utilities.md)
- [Reactive Collections](reactive-collections.md)
- [Watchers](../guide/essentials/watchers.md)
