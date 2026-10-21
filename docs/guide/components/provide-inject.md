# Provide / Inject

Use explicit component inputs and application services in place of an ambient component-tree channel.

> **Status:** Deliberate divergence. Viu has no hierarchical component-tree provide/inject API.

## The difference from Vue

Vue's provide/inject walks ancestors to locate a value. Viu keeps dependencies visible through
parameters, slots, application services, and explicitly selected state registries. Parent context
exists for runtime relationships; it does not define a service lookup hierarchy.

## Application services

Compose a provider with the container of your choice and supply it through
`ApplicationOptions.Services`. Core borrows that lookup-only IServiceProvider and does not dispose
it. A component resolves an application service through its mounted context:

```csharp
using System;

// Inside Setup, or inside OnSetup after generated Context assignment:
var client = (ApiClient?)context.Services?.GetService(typeof(ApiClient))
    ?? throw new InvalidOperationException("ApiClient is not registered.");
```

ApiClient is an application-owned type. In a generated script use `Context!` instead of the
Setup parameter context. Resolve dependencies after setup begins, not in a field initializer.

## Cohesion composition

Register services in the builder's Services container. Browser component services come from the
Viu application's provider. With `services.AddViuServerRendering(...)` on Web, server component
services come from a fresh asynchronous render scope in the Web container. Singleton services stay
shared; render scopes are separate from other middleware scopes.

## Choosing a boundary

| Need | Use |
| --- | --- |
| Parent supplies a value | A declared Parameter. |
| Parent supplies UI | A slot. |
| Child requests a change | A declared Event. |
| Application service | Context.Services. |
| Shared reactive state | An explicit State registry/definition. |

There is no DependencyInjection.Provide or Inject equivalent to call on a component. See
[Props](props.md), [Slots](slots.md), [Component Events](events.md), and
[Application API](../../api/application.md).
