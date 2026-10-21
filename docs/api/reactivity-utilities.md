# Reactivity API: Utilities & Advanced

Inspect reactive values, project properties, and control tracking without runtime reflection.

> **Status:** Implemented. Public construction and observation stay on the Reactive facade.

## Introspection

| API | Meaning |
| --- | --- |
| Reactive.IsRef(value) | Value implements the reference contract. |
| Reactive.IsReactive(value) | A tracked generated object or reactive collection not marked raw. |
| Reactive.IsReadOnly(value) | Read-only reactive classification. |

These checks do not turn a plain object into a reactive value. A computed is a reference; it is
not a proxy-wrapped reactive object. ReadOnly uses that exact capitalization in APIs and attributes.

## Unwrapping — Reactive.Unref

Unref reads a reference's current value or returns an ordinary value unchanged. Reading through
the reference participates in tracking. Keep the reference object when you want to preserve a
connection across method calls; passing only its current scalar value is a snapshot.

## Reactive.ToRef

```csharp
using Assimalign.Viu.Reactivity;

int value = 0;
IReactiveReference<int> projected = Reactive.ToRef(() => value, next => value = next);
projected.Value = 2;
```

The delegate projection does not make an untracked underlying property reactive. A getter-only
projection has no setter. Source-generated objects provide ToReferences for statically known
property projections; there is no string-key reflection lookup equivalent.

## Raw access — ToRaw and MarkRaw

ToRaw exposes supported raw-value views; MarkRaw excludes a value from reactive traversal.
Neither creates a new runtime proxy. Raw access is an escape hatch: mutation through it can bypass
notification. Treat read-only authoring conventions as API contracts rather than access control.

## Tracking control and batching

```csharp
Reactive.PauseTracking();
try
{
    // Reads here do not join the active subscriber.
}
finally
{
    Reactive.ResetTracking();
}
```

Pair every tracking pause, including on failure. Use a disposable Reactive.Batch lease for
coalescing writes. Independently owned work should use an effect scope and explicit cleanup.

## Reactive object interfaces and generation

IReactiveObject and IReactiveTraversable let traversal inspect generated/collection values without
discovering arbitrary CLR properties. Decorate partial classes with Reactive or ShallowReactive and
use partial get/set properties. ReadOnly is a compile-time option. Fields and arbitrary existing
instances do not acquire tracking dynamically.

The generator provides statically typed ToReferences and raw-value support. See
[Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md) and
[Compiler Diagnostics](diagnostics.md).

## Inspection labels and limits

Reactive.WithDebugLabel initializes a first-party reference's optional inspection label once.
DevTools is a separate opt-in package and build feature. There is no runtime reactive(obj) proxy,
string-key property-ref construction, or automatic thread safety. Keep each graph on its host
execution flow and use the documented public interfaces instead of engine internals.

## See also

- [Reactivity API: Core](reactivity-core.md)
- [Reactive Collections](reactive-collections.md)
