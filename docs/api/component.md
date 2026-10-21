# Component API

The host-neutral contracts for component behavior, static definitions, inputs, and mounted lifetimes.

> **Status:** Implemented, including metadata, typed definitions, and generated catalog aggregation.

All types on this page live in `Assimalign.Viu.Components` unless noted otherwise.

## `IComponent` and `IComponentDefinition`

```csharp
public interface IComponent
{
    ComponentRenderer Setup(ComponentContext context);
}

public interface IComponentDefinition
{
    static abstract ComponentRegistration Registration { get; }
}
```

`Setup` runs once per mounted invocation and returns a renderer taking `ComponentRenderFrame`.
The static interface supplies a definition's registration; it neither activates the component nor
provides Setup. Generated template components implement both interfaces and derive `ComponentBase`.

## Metadata and registered names

Generated template classes carry `ComponentMetadataAttribute` with their exact registered name.
Tooling reads it at compile time; runtime activation never inspects attributes. The name defaults
to the sanitized file base name. A single nonempty string literal constant named `RegisteredName`
in `@script` overrides it. Conflicting overrides and duplicate names produce located diagnostics.
An authored `public partial class` companion exposes a generated library type to consumers.

`ComponentNode.For<TComponent>(invocation: null, key: null)` requires `IComponentDefinition`
and returns a node using `TComponent.Registration.Reference`. It does not register or instantiate T.

## `ComponentRegistration` and factories

| Type | Purpose |
| --- | --- |
| `ComponentReference` | A named or type-based definition identity. |
| `ComponentContract` | Static parameter/event declarations, flags, display name, and render-cache contract. |
| `ComponentRegistration` | Reference, contract, and explicit activation delegate. |
| `ComponentFactory` / `IComponentFactory` | Application-owned registration storage and resolution. |
| `ComponentRegistration.Define` | Explicit closure-based component definition. |

```csharp
using Assimalign.Viu.Components;

ComponentFactory components = new();
components.RegisterGeneratedComponents();
```

`RegisterGeneratedComponents()` consumes direct published delegates in ordinal full-assembly-identity
order, once per factory. Executables publish their own and referenced catalogs by default;
libraries may opt in with `ViuAutoRegisterGeneratedCatalogs=true`. Setting it to `false` retains
explicit `GeneratedViuComponents.Register` entry points. Conflicting names across catalogs throw.
There is no runtime assembly scan. Browser builders use these aggregates unless given a factory.

## `ComponentInvocation` and `ComponentBindings`

`ComponentInvocation` copies the parent's arguments, `ComponentSlot` functions,
`ComponentEventListener` callbacks, directives, slot stability, and optional hydration strategy.
It is immutable raw input. Core resolves it against the contract into the mount's
`ComponentBindings.Parameters`, `Slots`, and `FallthroughBindings`.

Generated `[Parameter]` properties receive resolved values at setup and before each render.
Initializers supply per-instance defaults. `[Event]` partial methods generate typed calls to
`Context.Emit`. See [Props](../guide/components/props.md) and [Component Events](../guide/components/events.md).

## `ComponentContext`

| Member | Meaning |
| --- | --- |
| `Bindings` | Current resolved parameters, slots, and fallthrough. |
| `Services` | Nullable application or render-scope `IServiceProvider`. |
| `Lifecycle` | Instance hooks and cancellation token. |
| `Scope` / `WatchScheduler` | Reactive ownership and scheduling. |
| `Watch(getter, callback)` | Scope-owned, pre-flush watch; callback receives current and previous values. |
| `Parent` | Runtime-provided parent context, or null. |
| `Emit(name, arguments)` | Declared output dispatch with an immutable ordered argument snapshot. |
| `Expose(value)` | Publish the value delivered to a parent mount reference. |
| `Warn(message)` | Application warning channel. |

`ComponentBase.Context` is nullable before setup. Generated `OnSetup` runs after assignment;
script methods can then use `Context!`. Do not access it from constructors or field initializers.

## `ComponentLifecycle`

Hooks include before-mount, mounted, before-update, updated, before-unmount, unmounted, activated,
deactivated, error-captured, and server-prefetch. Ordinary hooks accept `Action`, `Func<Task>`,
and `Func<CancellationToken, Task>`. Tasks are observed without delaying normal progression;
server-prefetch tasks are awaited before serialization.

`OnErrorCaptured` receives the exception, source context, and information string. Returning false
stops propagation. Unhandled failures reach `ApplicationOptions.ErrorHandler`. The lifetime token
is canceled after before-unmount callbacks begin and before scope/subtree teardown. Generated
Task-returning component listeners use this same error and teardown observation.

Generated SFCs expose root-level conveniences such as `OnMounted` inside `OnSetup`. They register
into the same lifecycle lists as `Context!.Lifecycle.OnMounted`. See
[Lifecycle & Template Refs](../guide/essentials/lifecycle-and-template-refs.md).

## Slots and render frames

`ComponentSlot` returns a lazy virtual subtree. `SlotStability` is Stable, Dynamic, or Forwarded.
A hand-built slot set whose structure changes must select Dynamic; forwarded slots use Forwarded.
Generated slot roots collect dynamic descendants so native model-dependent text, disabled states,
conditions, and lists update even when the declaring component does not independently render.

Each mount owns one `ComponentRenderFrame` containing its render cache and block assembly.
Hand-authored nodes default to `RenderPlan.None` and receive a full diff. There is no public static
render-helper class or mutable mounted component instance in the authored contract.

## See also

- [Application API](application.md)
- [Render Functions & VirtualNode](render-function.md)
- [Single-File Components](../guide/scaling-up/single-file-components.md)
