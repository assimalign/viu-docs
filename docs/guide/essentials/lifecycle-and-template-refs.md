# Lifecycle Hooks & Template Refs

How a component observes its own mount, update, and teardown, and how it reaches the element or child
component a render produced.

> **Status:** Partial. Seven lifecycle hooks and both template-ref kinds are implemented;
> `OnActivated`, `OnDeactivated`, and `OnServerPrefetch` register but are never invoked. See
> [Project status](../../roadmap/status.md).

Viu's lifecycle surface is a port of Vue's
[Composition API lifecycle hooks](https://vuejs.org/api/composition-api-lifecycle.html), and template
refs are a port of [Template Refs](https://vuejs.org/guide/essentials/template-refs.html). The C#
spellings are PascalCase (`Lifecycle.OnMounted` for `onMounted`), and both features carry deliberate
divergences that this page states explicitly rather than leaving to be discovered at runtime.

## Registering a hook

Every hook lives on the static `Lifecycle` class in `Assimalign.Viu.RuntimeCore`, and every one binds
to `ComponentInstance.Current` at the moment you call it. That has one consequence you must design
around: **hooks are registered synchronously inside `Setup`**, before the render closure is returned.

```csharp
using System;
using System.Threading;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

public sealed class Clock : IComponentDefinition
{
    public string? Name => "Clock";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var now = Reactive.Reference(DateTime.UtcNow);
        Timer? timer = null;

        Lifecycle.OnMounted(() =>
        {
            timer = new Timer(_ => now.Value = DateTime.UtcNow, null, 0, 1000);
        });

        Lifecycle.OnUnmounted(() =>
        {
            timer?.Dispose();
            timer = null;
        });

        return () => VirtualNodeFactory.Element("time", now.Value.ToString("HH:mm:ss"));
    }
}
```

There is no `this` and no Options API — the hook closures capture the same locals the render closure
captures, which is exactly how state and teardown stay paired. See
[Components](./components.md) for why `Setup` returns a render function instead of exposing a
component proxy.

Two failure modes are worth naming up front:

- **Registering with no active instance** — `Lifecycle` emits the dev warning
  `"OnMounted() is called when there is no active component instance to be associated with. Lifecycle
  hooks can only be registered during Setup()."` and the registration is silently dropped. This is
  what happens if you register from an `async` continuation, a timer callback, or module
  initialization.
- **Registering from the render closure** — this does *not* warn, because the renderer makes the
  instance current while the render function runs. Instead you append a duplicate hook on every
  single render. Keep registration in `Setup`.

Once an instance is unmounted, `ComponentInstance` refuses to invoke any hook kind other than
`Unmounted`, so a late-firing scheduler job cannot resurrect a torn-down component's callbacks.

## The hook catalogue

| Hook | Delegate | When it runs | Status |
| --- | --- | --- | --- |
| `Lifecycle.OnBeforeMount` | `Action` | Before the instance's first render is patched in; parent before child | Implemented |
| `Lifecycle.OnMounted` | `Action` | After the tree is in the host; post-flush, child before parent | Implemented |
| `Lifecycle.OnBeforeUpdate` | `Action` | Before a re-render patches; the pre-patch subtree is still observable | Implemented |
| `Lifecycle.OnUpdated` | `Action` | After a re-render's patches applied; post-flush | Implemented |
| `Lifecycle.OnBeforeUnmount` | `Action` | Before teardown starts; parent before child | Implemented |
| `Lifecycle.OnUnmounted` | `Action` | After teardown; post-flush, child before parent | Implemented |
| `Lifecycle.OnErrorCaptured` | `Func<Exception, ComponentInstance?, string, bool>` | When a descendant throws | Implemented |
| `Lifecycle.OnActivated` | `Action` | Never — requires `KeepAlive` | Registers only |
| `Lifecycle.OnDeactivated` | `Action` | Never — requires `KeepAlive` | Registers only |
| `Lifecycle.OnServerPrefetch` | `Func<Task>` | Never — requires a server renderer | Registers only |

Vue's `onRenderTracked` and `onRenderTriggered` debug hooks have no counterpart in Viu; there is no
corresponding hook slot on `ComponentInstance` at all.

## Ordering across a tree

The "before" hooks run synchronously during the patch and go **parent first**. `Mounted`, `Updated`,
and `Unmounted` are queued as post-flush scheduler callbacks, and because equal-identifier post-flush
callbacks keep their insertion order, they come out **child first**.

```csharp
private TestComponent HookedComponent(string name, Func<VirtualNode?> render, TestComponent? child = null)
    => new()
    {
        Name = name,
        SetupFunction = (_, _) =>
        {
            Lifecycle.OnBeforeMount(() => _events.Add($"{name}:beforeMount"));
            Lifecycle.OnMounted(() => _events.Add($"{name}:mounted"));
            Lifecycle.OnBeforeUnmount(() => _events.Add($"{name}:beforeUnmount"));
            Lifecycle.OnUnmounted(() => _events.Add($"{name}:unmounted"));
            return child is null
                ? render
                : () => VirtualNodeFactory.Element("div", VirtualNodeFactory.Component(child));
        },
    };

var child = HookedComponent("child", static () => VirtualNodeFactory.Element("span", "c"));
var parent = HookedComponent("parent", static () => null, child);

_renderer.Render(VirtualNodeFactory.Component(parent), _container);

_events.ShouldBe(
[
    "parent:beforeMount",
    "child:beforeMount",
    "child:mounted",   // post-flush, child before parent
    "parent:mounted",
]);
```

This is the shape used throughout the runtime's own tests. `TestComponent` here is *not* public API —
it is an `internal` `IComponentDefinition` adapter that lives in the runtime's own test project, with a
`required Func<ComponentProperties, ComponentSetupContext, Func<VirtualNode?>> SetupFunction` property
standing in for `Setup`. Your own tests would write an equivalent adapter, or mount a real definition
through the shipping helpers in [Testing](../scaling-up/testing.md). The practical rule
is the same as Vue's: **`OnMounted` is the first point at which your own children are guaranteed to be
in the host tree**, so it is where template refs, measurements, and subscriptions belong.

## Capturing errors

`Lifecycle.OnErrorCaptured` takes a `Func<Exception, ComponentInstance?, string, bool>` — the
exception, the instance that raised it, and an `info` string naming the phase.

```csharp
Lifecycle.OnErrorCaptured((exception, instance, info) =>
{
    _log.Add($"{instance?.Definition.Name ?? "?"} failed during {info}: {exception.Message}");
    return false; // false STOPS propagation — the error goes no further
});
```

Two rules invert the intuitive reading and are the most common source of surprise:

- **`false` stops propagation** — returning `true`, or falling through to a `true` return, lets the
  error continue to further ancestors and then to `ApplicationConfiguration.ErrorHandler`. This is
  upstream parity with Vue's `onErrorCaptured`, spelled as a `bool` rather than a JavaScript falsy
  return.
- **A hook never captures its own instance's errors** — the ancestor walk starts at
  `instance.Parent`. If `Widget` throws in its own render, `Widget`'s own `OnErrorCaptured` is not
  consulted; its parent's is.

The `info` values the runtime passes are fixed strings:

| `info` | Raised by |
| --- | --- |
| `"setup function"` | An exception thrown out of `IComponentDefinition.Setup` |
| `"render function"` | An exception thrown out of the returned render closure |
| `"{Kind} hook"` | A lifecycle hook, e.g. `"Mounted hook"` |
| `"event handler for \"{eventName}\""` | A component emit handler |
| `"directive hook"` | An `IDirective` hook |
| `"template ref function"` | A function template ref |
| `"watcher callback"` / `"watcher getter"` | A `ViuWatch` watcher |

If no hook stops the error, it reaches `ApplicationConfiguration.ErrorHandler`. Both halves of that
contract matter: when `ErrorHandler` is **set** it becomes the terminal sink and the exception is
*not* rethrown; when it is **null** the exception rethrows to the host with its original stack. Pick
deliberately — a set handler that only logs will turn a crash into a silently broken UI.

## Hooks that register but never fire

`OnActivated` and `OnDeactivated` accept a hook and store it in the instance's hook table, but nothing
in the renderer ever invokes them: `LifecycleHookKind.Activated` and `.Deactivated` are written and
never read. `KeepAlive` is only a marker object, and creating its vnode throws
`NotSupportedException` — `"The built-in component <KeepAlive> is not yet supported by the runtime
renderer."` — so the activation path that would fire them cannot exist yet. `OnServerPrefetch`
likewise stores its `Func<Task>` and is never awaited, because there is no server renderer. Neither
warns. Do not build a design on them today — see
[KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md).

## Template refs

A template ref is declared by passing a `"ref"` prop. Viu accepts exactly two value shapes:

- **An `IReference<object?>`** — the ref-object form. It receives the mounted element (or a
  component's exposed surface) and is set back to `null` on unmount.
- **An `Action<object?>`** — the function form. It is invoked with the element/instance on mount and
  with `null` on unmount, which is what makes the `v-for` collection pattern work.

Anything else — most importantly a **string** — produces the dev warning
`"Invalid template ref of type String: a template ref must be an IReference<object?> or an
Action<object?> (string refs are not supported)."` and is treated as no ref at all. Vue's string refs
resolve against a component instance proxy, and Viu has no proxy under AOT, so they are intentionally
not ported.

The `TemplateReference` readonly struct is the classified result of that prop, exposed with public
`TemplateReference.FromReference(IReference<object?>)` and `TemplateReference.FromFunction(Action<object?>)`
factories plus `IsReferenceObject` and value equality. **Do not pass a `TemplateReference` as the `"ref"`
prop.** Classification happens inside the vnode factories, and it only recognizes a raw
`IReference<object?>` or `Action<object?>` — hand it an already-built `TemplateReference` and it takes the
invalid-type branch, warns, and drops the ref. `VirtualNode.Reference` is `internal init`, so there is no
public path that consumes a `TemplateReference` either; the factories are useful for comparing and
asserting against an existing `VirtualNode.Reference`, not for declaring one.

`"ref"` is one of the renderer's reserved prop names (alongside `"key"` and anything starting with
`"onVnode"`). It is lifted onto `VirtualNode.Reference` when the vnode is created and is never
patched to the platform, so it will not appear as a DOM attribute.

### An element ref

```csharp
public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    var inputElement = Reactive.Reference<object?>(null);
    object? mountedInput = null;

    Lifecycle.OnMounted(() =>
    {
        // inputElement.Value is the mounted <input>. On the browser this is a BOXED int
        // node handle, not a JSObject — see "What an element ref actually holds" below.
        mountedInput = inputElement.Value;
    });

    return () => VirtualNodeFactory.Element(
        "input",
        VirtualNodeFactory.Properties(
            ("ref", inputElement),
            ("type", "search")));
}
```

### A component ref, and what `Expose` changes

A ref on a component vnode receives `instance.Exposed` when the child called
`ComponentSetupContext.Expose`, and falls back to the `ComponentInstance` itself when it did not.
That fallback is a documented Viu deviation — it is the stand-in for upstream's public instance
proxy.

```csharp
var exposed = new object();
var child = new TestComponent
{
    SetupFunction = (_, context) =>
    {
        context.Expose(exposed);
        return static () => VirtualNodeFactory.Element("input");
    },
};

var componentRef = Reactive.Reference<object?>(null);
_renderer.Render(
    VirtualNodeFactory.Component(child, VirtualNodeFactory.Properties(("ref", componentRef))),
    _container);

componentRef.Value.ShouldBeSameAs(exposed);   // only the exposed object is surfaced

_renderer.Render(null, _container);
componentRef.Value.ShouldBeNull();            // unmount nulls it
```

Expose a small record of exactly the members the parent needs. Without `Expose`, the parent gets a
whole `ComponentInstance` and every internal on it, which is a much wider contract than you probably
intend.

### A function ref

```csharp
var rows = new List<object?>();

Action<object?> collectRow = value =>
{
    if (value is null)
    {
        return;   // unmount
    }
    rows.Add(value);
};

// ("ref", collectRow) on each item vnode collects every rendered row.
```

Note the asymmetry the renderer inherits from upstream: when a binding is *replaced* by a different
one, only a previous **ref-object** is nulled. A replaced function ref is simply dropped and is never
invoked with `null`.

### In a `.viu` template

Because string refs are unsupported, a template ref is always a **bound** ref — `:ref="expression"`,
never `ref="name"`:

```viu
@template {
    <input :ref="InputElement" type="search" />
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<object?> InputElement = new(null);
}
```

The identifier in the expression is emitted verbatim as `_ctx.InputElement`, so it must match the
declared member's spelling exactly — `:ref="inputElement"` against a field named `InputElement` is a
compile error in the generated partial, not a silent miss.

> **Status:** Partial. The template compiler recognizes `:ref` and the generator emits the compiled
> `Render` method into the component's partial class, but it does not yet emit the
> `IComponentDefinition`/`Setup` wiring that would let an `@script` block register lifecycle hooks.
> The hand-written C# above is the path that compiles end to end today. See
> [Single-File Components](../scaling-up/single-file-components.md) and
> [Project status](../../roadmap/status.md).

### What an element ref actually holds

At the `Renderer<TNode>` layer a `VirtualNode`'s element back-pointer is `object?`, so an element ref
hands you the **boxed platform node**. The browser renderer is a `Renderer<int>` — DOM nodes cross the
WASM boundary as `int` handles — so on the browser `inputElement.Value` is a boxed `int`, not a
`JSObject` and not an `HTMLInputElement`.

Today there is no public API for issuing DOM operations against a raw handle: the interop bridge and
its directive write-channel are both `internal`. So an element ref is currently useful for identity,
bookkeeping, and passing back into runtime-provided directives — not for calling `focus()` yourself.
Reach for a [custom directive](../reusability/custom-directives.md) for element-touching behavior, and
track the public element-operations surface in [Project status](../../roadmap/status.md).

## Timing: when hooks and refs are observable

This is the part that most often surprises a reader porting Vue code, because Viu deviates on purpose.

- **Both ref kinds are deferred to the post-flush phase** — Vue invokes a *function* ref
  synchronously inside `setRef`; Viu queues both kinds as a post-flush job with `Identifier = -1` so
  they populate before user `Mounted`/`Updated` hooks observe them. The upshot: **no template ref is
  ever applied synchronously mid-patch**, and both kinds share identical timing.
- **Nulling on unmount is synchronous** — the unmount path applies `null` immediately rather than
  queueing it, so a ref never dangles past the teardown that cleared it.
- **A direct `Renderer<TNode>.Render` call drains the queues before returning** — it always runs
  `FlushAfterSynchronousRender`, so lifecycle hooks, directive hooks, and template refs are all
  observable on the line after the call. This is what makes the test snippets above assert
  immediately.
- **Reactive updates wait for a flush** — a mutation enqueues a job rather than re-rendering
  synchronously. To observe the resulting DOM or refs, await `Scheduler.NextTick()` (the counterpart
  of Vue's [`nextTick`](https://vuejs.org/api/general.html#nexttick)).

```csharp
count.Value++;                     // queues a render job; nothing has patched yet
await Scheduler.NextTick();        // resolves after the flush and its post-flush callbacks
// the subtree, hooks, and template refs now reflect the new value
```

One sharp edge: `Scheduler.NextTick()` returns `Task.CompletedTask` when nothing is queued, so
awaiting it does **not** yield. Never use it as a general-purpose "let the event loop breathe" await —
it is a flush barrier and nothing more.

For watcher callbacks, which interleave with these phases, see [Watchers](./watchers.md) — and note
that `ViuWatch.Watch` defaults to pre-flush while the standalone `Reactive.Watch` defaults to
synchronous.

## Not yet implemented

- **`OnActivated` / `OnDeactivated`** — registration works, invocation does not; creating a
  `KeepAlive` vnode throws `NotSupportedException`.
- **`OnServerPrefetch`** — stored and never awaited; there is no server renderer, no `hydrate` entry
  point, and no SSR path anywhere in the runtime.
- **`onRenderTracked` / `onRenderTriggered`** — absent entirely; no debug hook slot exists.
- **String template refs** — deliberately not ported (they require a component instance proxy).
- **A public element-operations surface** — an element ref yields a boxed node handle, and the DOM
  bridge that could act on it is `internal`.

Related reading: [Components](./components.md), [Watchers](./watchers.md),
[Custom Directives](../reusability/custom-directives.md), [Composables](../reusability/composables.md),
[Component API](../../api/component.md), and
[Differences from Vue 3](../../roadmap/vue-differences.md).
