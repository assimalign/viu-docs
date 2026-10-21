# Composables

Package reactive state and actions in ordinary C# helpers with explicit ownership and cleanup.

> **Status:** Implemented. A composable needs no special runtime registration.

## Your first composable

```csharp
using System;

using Assimalign.Viu.Reactivity;

public static class CounterState
{
    public static (Reference<int> Count, Action Increment) Create()
    {
        Reference<int> count = Reactive.Reference(0);
        return (count, () => count.Value++);
    }
}
```

Call Create once per mounted component when state should be local. A static shared reference
instead shares one graph and lifetime across callers; choose that deliberately.

## Consuming a composable in Setup

IComponent.Setup runs once and returns a frame-based ComponentRenderer. Generated SFCs offer
OnSetup after Context and parameters are assigned. Keep reference objects intact when returning
them from a helper; copying their current scalar Value does not preserve a reactive connection.

## Composables that own effects

Pass ComponentContext to a component-specific helper when it needs lifecycle or watches. Use
context.Watch for a scope-owned pre-flush getter watch, context.Lifecycle for callbacks and
cancellation, and context.Services for application dependencies. There is no ambient static
Lifecycle or component-tree provide/inject API.

## Effect scopes outside components

```csharp
using System;

using Assimalign.Viu.Reactivity;

using EffectScope scope = Reactive.EffectScope(detached: true);
Reference<int> count = Reactive.Reference(0);
scope.Run(() =>
{
    Reactive.WatchEffect(() => Console.WriteLine(count.Value));
    Reactive.OnScopeDispose(() => Console.WriteLine("Stopped"));
});
count.Value++;
```

The scope owns effects created inside Run and invokes cleanup on stop/disposal. Nested scopes
stop with their parent unless detached. Read the ambient scope through Reactive.CurrentScope;
use the factory rather than constructing EffectScope directly.

## Sharing state between components

For application state, use an explicit StateStoreDefinition<TStore> and IStateStoreRegistry.
Each registry owns one instance per definition; independent render scopes can own independent
registries. A helper's static field does not become request-local simply because a component
reads it. See [Application API](../../api/application.md).

## Constraints

Each reactive graph remains single-event-loop and not thread-safe. Request-oriented hosts isolate
ambient execution bookkeeping; that does not clone a shared reference or make its mutation safe
across concurrent requests. Keep background work and resource disposal under an explicit owner.

## Related

- [Watchers](../essentials/watchers.md)
- [Reactivity API: Core](../../api/reactivity-core.md)
- [Provide / Inject](../components/provide-inject.md)
