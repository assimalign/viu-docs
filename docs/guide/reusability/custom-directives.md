# Custom Directives

Writing, attaching, and registering your own directives — Viu's port of Vue's reusable low-level
element behaviors.

> **Status:** Partial. The directive system itself — the seven hooks, bindings, registration, and
> name resolution — is implemented and exercised end to end. Two gaps: there is no *public* browser
> API for acting on the element handle a hook receives, so a user-authored directive cannot yet
> mutate the DOM directly; and modifiers written on a custom directive in a template do not reach
> the binding. Both are detailed under [Not yet implemented](#not-yet-implemented). See
> [Project status](../../roadmap/status.md).

A directive is a bundle of lifecycle hooks attached to a specific vnode. Where a
[composable](./composables.md) packages reusable *state*, a directive packages reusable *element
behavior* — the same split Vue draws in its
[Custom Directives](https://vuejs.org/guide/reusability/custom-directives.html) guide. Viu ports
upstream's `ObjectDirective` as the `IDirective` interface and upstream's `withDirectives` as
`Directives.WithDirectives`.

## The `IDirective` interface

Every hook is a default-null interface member, so a directive implements only the phases it needs
and the renderer skips the rest — the C# equivalent of upstream's `if (hook)` guard.

```csharp
public interface IDirective
{
    DirectiveHook? Created => null;
    DirectiveHook? BeforeMount => null;
    DirectiveHook? Mounted => null;
    DirectiveHook? BeforeUpdate => null;
    DirectiveHook? Updated => null;
    DirectiveHook? BeforeUnmount => null;
    DirectiveHook? Unmounted => null;
}
```

Hook dispatch is a direct enum switch over an internal `DirectiveHookKind` — never reflection over
hook names. That is a hard requirement of the AOT/trimming contract described in
[AOT & Trimming](../best-practices/aot-and-trimming.md), and it is why the hooks are seven named
members rather than a string-keyed dictionary.

| Hook | Vue counterpart | When it runs |
| --- | --- | --- |
| `Created` | `created` | Once, before the bound element's attributes and event listeners are applied. |
| `BeforeMount` | `beforeMount` | Before the bound element is inserted into its parent. |
| `Mounted` | `mounted` | After the element and its parent's subtree are mounted — post-flush. |
| `BeforeUpdate` | `beforeUpdate` | Before the containing component's vnode updates the element. |
| `Updated` | `updated` | After the containing component's vnode and children have updated — post-flush. |
| `BeforeUnmount` | `beforeUnmount` | Before the bound element is removed. |
| `Unmounted` | `unmounted` | After the bound element is removed — post-flush. |

`BeforeMount` running *before* insertion is what lets `VShow` hide an initially-falsy element without
a flash of visible content, and it is the same guarantee your own directives get.

## The `DirectiveHook` delegate

```csharp
public delegate void DirectiveHook(
    object? element,
    DirectiveBinding binding,
    VirtualNode node,
    VirtualNode? previousNode);
```

The four parameters are upstream's `(el, binding, vnode, prevVNode)` in order.

- **`element`** — the *boxed* platform node the renderer stored on `VirtualNode.El`. It is typed
  `object?` because `VirtualNode` is not generic over `TNode`; see
  [The element handle on the browser](#the-element-handle-on-the-browser) below for what this
  actually is under `Assimalign.Viu.RuntimeDom`.
- **`binding`** — the `DirectiveBinding` carrying the value, argument, and modifiers for *this* use
  of the directive on *this* vnode.
- **`node`** — the vnode the directive is bound to. Its props are readable, which is how `VShow`
  derives an element's original `display` without an interop round trip.
- **`previousNode`** — the previous vnode on update hooks; null on created/mount hooks.

An exception thrown inside a hook routes through the component error pipeline with the info string
`"directive hook"`: each ancestor's `OnErrorCaptured` hooks see `(exception, instance, info)` and
returning false stops propagation. It does **not** abort the remaining bindings on that vnode, and
it does not abort the patch. If no captured hook stopped it and
`ApplicationConfiguration.ErrorHandler` is set, that handler is the terminal sink; if it is null the
error is rethrown to the host with its original stack intact.

## `DirectiveBinding`

```csharp
public sealed class DirectiveBinding
{
    public IDirective Directive { get; }
    public ComponentInstance? Instance { get; }
    public object? Value { get; }
    public object? OldValue { get; internal set; }
    public string? Argument { get; }
    public IReadOnlyDictionary<string, bool> Modifiers { get; }
}
```

| Member | Meaning |
| --- | --- |
| `Directive` | The `IDirective` this binding belongs to. |
| `Instance` | The `ComponentInstance` that was rendering when the binding was created. |
| `Value` | The bound value — the `x` in `v-my-dir="x"`. |
| `OldValue` | The previous bound value. **Null on `Created` and mount hooks.** |
| `Argument` | The argument — the `foo` in `v-my-dir:foo`. Null when absent. |
| `Modifiers` | The modifiers — the `lazy` in `v-my-dir.lazy`. **Never null**; an empty set when none. |

Two details worth internalizing before you write an update hook:

- **`OldValue` is refreshed from the previous vnode's binding at the same index** — directive order
  on a vnode is positional, so reordering directives across renders reorders their old values.
- **`Modifiers` is never null.** Probe it with `TryGetValue`; a modifier is present only when the
  key exists *and* maps to `true`. It is populated only when the binding was built
  programmatically — a modifier written on a custom directive in a template does not reach it
  today; see [Not yet implemented](#not-yet-implemented).

There is no `dir` / `oldValue` naming asymmetry to remember: Viu uses whole-word C# names
throughout, consistent with `ComponentSetupContext.Attributes` (not `Attrs`) and
`ComponentInstance.Subtree` (not `subTree`).

## Authoring a directive

### As a bundle of lambdas — the `Directive` record

`Directive` is a sealed record implementing `IDirective` with `init`-only hook properties. It is the
port of writing an upstream object-literal directive, and it is the right choice when the directive
is stateless and short.

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

public sealed class TrackedPanel : IComponentDefinition
{
    // One shared instance, reused by every element the directive is applied to.
    private static readonly Directive Tracked = new()
    {
        Created = static (element, binding, node, previousNode) =>
            Console.WriteLine($"created: value={binding.Value} argument={binding.Argument}"),
        Mounted = static (element, binding, node, previousNode) =>
            Console.WriteLine($"mounted: value={binding.Value}"),
        Updated = static (element, binding, node, previousNode) =>
            Console.WriteLine($"updated: {binding.OldValue} -> {binding.Value}"),
        Unmounted = static (element, binding, node, previousNode) =>
            Console.WriteLine("unmounted"),
    };

    public string? Name => "TrackedPanel";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var label = Reactive.Reference("first");

        // WithDirectives is called from inside the render closure, so the binding is rebuilt
        // — with a fresh Value — on every render.
        return () => Directives.WithDirectives(
            VirtualNodeFactory.Element("div", label.Value),
            Tracked,
            label.Value,
            "label");
    }
}
```

Mutating `label.Value` later triggers a re-render, which re-runs `WithDirectives`, which produces a
binding whose `Value` is the new label and whose `OldValue` is the previous one — and `Updated`
fires with both.

For the shorthand where a single hook serves as both `Mounted` and `Updated` (upstream's
`FunctionDirective` form), use the factory:

```csharp
public static Directive FromFunction(DirectiveHook hook);
```

```csharp
private static readonly Directive Sync = Directive.FromFunction(
    static (element, binding, node, previousNode) => Publish(binding.Value));
```

### As a stateful singleton — implementing `IDirective`

When the directive carries per-element or per-instance state, implement the interface directly and
expose a single shared instance. This is exactly how every built-in directive is written.

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.RuntimeCore;

namespace MyApp;

/// <summary>Reports element lifecycle phases to an Action&lt;string&gt; supplied as the bound value.</summary>
public sealed class LifecycleProbe : IDirective
{
    /// <summary>The shared directive instance. Register this, not a new one per use.</summary>
    public static readonly LifecycleProbe Instance = new();

    private readonly Dictionary<ComponentInstance, int> _updateCounts = new();

    private LifecycleProbe()
    {
    }

    public DirectiveHook? Mounted => OnMounted;

    public DirectiveHook? Updated => OnUpdated;

    public DirectiveHook? Unmounted => OnUnmounted;

    private void OnMounted(object? element, DirectiveBinding binding, VirtualNode node, VirtualNode? previousNode)
    {
        if (binding.Instance is { } instance)
        {
            _updateCounts[instance] = 0;
        }

        Report(binding, "mounted", 0);
    }

    private void OnUpdated(object? element, DirectiveBinding binding, VirtualNode node, VirtualNode? previousNode)
    {
        var count = 0;
        if (binding.Instance is { } instance)
        {
            _updateCounts.TryGetValue(instance, out count);
            _updateCounts[instance] = ++count;
        }

        Report(binding, "updated", count);
    }

    private void OnUnmounted(object? element, DirectiveBinding binding, VirtualNode node, VirtualNode? previousNode)
    {
        if (binding.Instance is { } instance)
        {
            _updateCounts.Remove(instance);
        }

        Report(binding, "unmounted", 0);
    }

    private static void Report(DirectiveBinding binding, string phase, int count)
    {
        if (binding.Value is Action<string> callback)
        {
            callback(binding.Modifiers.TryGetValue("verbose", out var verbose) && verbose
                ? $"{phase} (#{count}, argument={binding.Argument ?? "none"})"
                : phase);
        }
    }
}
```

Two conventions worth copying from the built-ins:

- **Return a method group from each hook property, not an inline lambda** — the renderer reads the
  property on every dispatch. A property body of `=> (a, b, c, d) => …` allocates a fresh delegate
  each time; a method group conversion is cached by the compiler. Every shipped directive uses
  `private static` hook methods; make them instance methods only when, like `LifecycleProbe` above,
  the directive keeps state on the singleton.
- **Clean up in the teardown hook.** Nothing releases per-element or per-instance state for you.
  `VShow` calls `ReleaseState` from `BeforeUnmount` for precisely this reason.

## Attaching directives programmatically

`Directives.WithDirectives` records bindings on a vnode and returns the same vnode, so it composes
directly with `VirtualNodeFactory` calls.

```csharp
public static class Directives
{
    public static VirtualNode WithDirectives(
        VirtualNode node,
        IDirective directive,
        object? value = null,
        string? argument = null,
        IReadOnlyDictionary<string, bool>? modifiers = null);

    public static VirtualNode WithDirectives(VirtualNode node, params DirectiveArgument[] directives);

    public static IDirective? ResolveDirective(string name);
}
```

The single-directive overload is the common case. For several directives on one vnode, use the
params-array overload with `DirectiveArgument` — the port of upstream's
`[directive, value, arg, modifiers]` tuple.

```csharp
public sealed class DirectiveArgument
{
    public DirectiveArgument(
        IDirective directive,
        object? value = null,
        string? argument = null,
        IReadOnlyDictionary<string, bool>? modifiers = null);

    public IDirective Directive { get; }
    public object? Value { get; }
    public string? Argument { get; }
    public IReadOnlyDictionary<string, bool>? Modifiers { get; }
}
```

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

// …inside Setup, where `void OnPhase(string phase)` is a local or member method:
var isVisible = Reactive.Reference(true);
var probeModifiers = new Dictionary<string, bool> { ["verbose"] = true };

return () => Directives.WithDirectives(
    VirtualNodeFactory.Element("section", VirtualNodeFactory.Properties(("class", "panel"))),
    new DirectiveArgument(VShow.Instance, isVisible.Value),
    new DirectiveArgument(LifecycleProbe.Instance, (Action<string>)OnPhase, "panel", probeModifiers));
```

The `(Action<string>)` cast is required, not stylistic: `DirectiveArgument`'s `value` parameter is
`object?`, and C# has no implicit conversion from a method group to `object`. The same applies to
any lambda or method group you pass as a bound value — give it a delegate type first. Note also that
`VShow` is bound with `isVisible.Value`, not `isVisible`: the directive coerces the *value*'s
truthiness, and a `Reference<bool>` object is itself always truthy.

### `WithDirectives` needs an active instance — and a fresh vnode per render

The binding captures `ComponentInstance.Current` as its owning instance. Called with no active
instance it warns `"WithDirectives can only be used inside a render function."` and returns the
vnode **unchanged**, with no directive attached. This is upstream parity, and it is a
silent-in-Release failure mode.

Two distinct mistakes are easy to confuse here:

**No instance is current.** The renderer pushes the instance onto a current-instance stack around
`Setup`, around each run of the render function, and around lifecycle-hook dispatch. Outside those
windows there is no current instance, so a `WithDirectives` call from a constructor, from an event
handler, or from a background continuation resumed after a render finished hits the warning path
and silently drops the directive.

**An instance is current, but the vnode is hoisted.** The instance *is* current inside the body of
`Setup` — the renderer pushes it before invoking `Setup` and pops it after — so the call below
succeeds and does attach the directive. It is still wrong: the vnode and its binding are built once
and handed back unchanged on every render, so `Value` never refreshes, `OldValue` never differs, and
`Updated` never observes a change.

```csharp
public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    // WRONG — this attaches (Setup runs with the instance current), but the vnode is built once and
    // reused, so the binding's Value is frozen at its first-render value.
    var hoisted = Directives.WithDirectives(VirtualNodeFactory.Element("div"), Tracked);
    return () => hoisted;
}
```

The rule that covers both: build the vnode *inside* the closure `Setup` returns, so
`WithDirectives` re-runs — and rebuilds the binding — on every render.

### Directives on a component vnode

Applying a directive to a component vnode is legal: the binding transfers onto the component's
rendered root element. When that root is not an element, component, or comment vnode, the renderer
emits a dev warning and the directive has no effect.

## Registering a directive by name

Register on the application, then reference it from templates by name. Registration is chainable.

```csharp
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

using MyApp;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new App())
    .Directive("lifecycle-probe", LifecycleProbe.Instance)
    .Component("panel-frame", new PanelFrame())
    .Mount("#app");

await Task.Delay(Timeout.Infinite);
```

Both `BrowserApplication` and the platform-agnostic `Application<TNode>` expose the same register /
get pair; only the chaining return type differs, because each returns its own type.

```csharp
// Assimalign.Viu.RuntimeDom.BrowserApplication
public BrowserApplication Directive(string name, IDirective directive);
public IDirective? Directive(string name);

// Assimalign.Viu.RuntimeCore.Application<TNode>
public Application<TNode> Directive(string name, IDirective directive);
public IDirective? Directive(string name);
```

`BrowserApplication.Directive` delegates straight to the wrapped `Application<int>` — the browser
renderer's `TNode` is `int` — so registration semantics are identical on both.

Registering a duplicate name, or registering after `Mount`, warns in dev. Null or empty names throw
`ArgumentException`; a null directive throws `ArgumentNullException`.

### Name resolution rules

The two lookup paths behave differently, and the difference is a common source of confusion.

| Path | Matching |
| --- | --- |
| `app.Directive(name)` — the one-arg **getter** | Raw exact lookup only, `StringComparer.Ordinal`. |
| `Directives.ResolveDirective(name)` — **render time** | Raw, then camelCase, then PascalCase — each an ordinal lookup. |

So a directive registered as `"lifecycle-probe"` is resolvable at render time from
`lifecycle-probe`, and a directive registered as `"LifecycleProbe"` is resolvable from
`lifecycle-probe` too, because `lifecycle-probe` camelizes to `lifecycleProbe` and capitalizes to
`LifecycleProbe`. But `app.Directive("LifecycleProbe")` returns null when the registration used the
hyphenated spelling — the getter tries exactly one spelling. Note also that this is **ordinal**
matching over three candidate spellings, not case-insensitive matching: `v-LIFECYCLE-PROBE` resolves
nothing. The same split governs component resolution; see
[Dynamic Components & Registration](../components/dynamic-components.md).

`ResolveDirective` warns `"Failed to resolve directive: {name}"` and returns null on a miss. (This
is the opposite of `ResolveDynamicComponent`, which deliberately stays quiet because an unresolved
string there is a legitimate element tag.)

## Using a directive in a template

In a [`.viu` single-file component](../scaling-up/single-file-components.md), a custom directive is
written exactly as in Vue — `v-name`, optionally with an argument and modifiers. The name, the
argument, and the bound expression all reach the binding; the modifiers, today, do not (see the
note after the compiled output below).

```viu
@template {
  <section v-lifecycle-probe:panel.verbose="OnPhase">
    <input v-model="Query" />
    <p v-show="HasResults">{{ ResultCount }} matches</p>
  </section>
}
```

The template compiler emits a resolution preamble and a `_withDirectives` wrapper. An element
carrying a runtime directive is emitted as a *block* — `_createElementBlock(_openBlock(), …)` — and,
when it has no other dynamic content, carries the `512 /* NEED_PATCH */` flag. Compiled output for
the outer element is shaped like this:

```csharp
var _directive_lifecycle_probe = _resolveDirective("lifecycle-probe");

return _withDirectives(
    _createElementBlock(_openBlock(), "section", null, /* children */),
    new object?[]
    {
        new object?[]
        {
            _directive_lifecycle_probe,
            _ctx.OnPhase,
            "panel",
            _createProps(("verbose", true)),
        },
    });
```

The tuple slots are `[directive, value?, argument?, modifiers?]`, and an absent slot before a
present one is filled with `null` (the emitter's port of upstream's `void 0`). The modifiers slot
uses `_createProps` because a C# expression position has no object-literal spelling.

> **Modifiers declared in a template do not reach `binding.Modifiers` today.** `_createProps`
> produces a `VirtualNodeProperties`, and `RenderHelpers._withDirectives` reads slot 3 as
> `tuple[3] as IReadOnlyDictionary<string, bool>` — a cast `VirtualNodeProperties` does not satisfy,
> so it yields null and the binding falls back to the empty modifier set. Modifiers passed
> *programmatically* through `Directives.WithDirectives` or `DirectiveArgument` work correctly,
> because those take the dictionary directly. See [Not yet implemented](#not-yet-implemented).

`_withDirectives` and `_resolveDirective` are members of
`Assimalign.Viu.RuntimeCore.RenderHelpers`. Their `_`-prefixed lowercase spellings are a deliberate,
documented, generated-code-only deviation from the repo's whole-word naming rule: the names *are*
the upstream `helperNameMap` contract that generated code binds to literally. Hand-written C# should
call `Directives.WithDirectives` instead. See
[Render Functions & VirtualNode](../../api/render-function.md) for the full helper surface.

Directives whose runtime value is known at compile time — `v-show`, the `v-model` family — skip the
`_resolveDirective` preamble entirely and reference the singleton directly, e.g.
`DomRenderHelpers._vShow`. Only *custom* directives require a name lookup.

## The element handle on the browser

This is the section to read before planning a directive that manipulates the DOM.

Nodes cross the WASM/JavaScript boundary as **positive `int` handles**, never as `JSObject` proxies
— a measured interop decision recorded in the runtime-DOM ADR. Handle `0` is the reserved "no node"
sentinel. Under `Assimalign.Viu.RuntimeDom` the renderer's `TNode` is therefore `int`, so the
`object? element` a hook receives is a **boxed `int`**:

```csharp
private static void OnMounted(object? element, DirectiveBinding binding, VirtualNode node, VirtualNode? previousNode)
{
    if (element is int handle)
    {
        // `handle` identifies the DOM node — but see the limitation below.
    }
}
```

**The limitation, stated plainly:** the operations that turn a handle into a DOM mutation —
the type the built-in directives use to call `SetStyleProperty`, `RemoveStyleProperty`, and friends
— are `internal` to `Assimalign.Viu.RuntimeDom`. There is no public API today that accepts a node
handle. `BrowserRuntime`'s public surface is `InitializeAsync`, `CreateApp`, `CreateRenderer`,
`QuerySelector`, and `GetRegistryDiagnostics`; none of them mutate a node. So a user-authored
directive can *observe* the handle but cannot act on it, and there is no `JSObject` escape hatch,
because the boundary never produces one.

What a user-authored directive **can** do today:

- **React to lifecycle phases** — run logic at `Mounted` / `Updated` / `Unmounted` scoped to a
  specific element's presence in the tree.
- **Read the binding** — `Value`, `OldValue`, `Argument`, and `Instance` are all fully available and
  are enough for most coordination and instrumentation work. `Modifiers` is available too, but only
  for programmatically built bindings (see [Not yet implemented](#not-yet-implemented)).
- **Read the vnode** — `node`'s props are readable, which is how `VShow` recovers an element's
  declared inline `style` without an interop read.
- **Drive reactive state** — write to a `Reference<T>` captured by the closure that created the
  binding, and let the renderer apply the resulting DOM change through ordinary class/style/prop
  bindings.

That last point is the idiomatic workaround: express the DOM effect as a *binding* the renderer
patches, and use the directive for the timing and bookkeeping. A `v-highlight` directive that would
set `el.style.backgroundColor` in Vue becomes, in Viu today, a directive that writes a ref plus a
`:style` binding that reads it.

For behavior that genuinely requires imperative DOM access — focusing an input, measuring a box —
there is no supported path from a custom directive yet. Use the built-in directives where one
covers the need, and track [Project status](../../roadmap/status.md) for the public element-operations
surface.

## Built-in directives as reference implementations

Every shipped directive is a working example of the patterns above — a private constructor, a
`public static readonly Instance`, `private static` method groups behind the hook properties, and
explicit state release on teardown.

| Directive | Helper name | Hooks implemented |
| --- | --- | --- |
| `VShow` | `_vShow` | `BeforeMount`, `Mounted`, `Updated`, `BeforeUnmount` |
| `VModelText` | `_vModelText` | `Created`, `Mounted`, `BeforeUpdate`, `BeforeUnmount` |
| `VModelCheckbox` | `_vModelCheckbox` | `Created`, `Mounted`, `BeforeUpdate`, `BeforeUnmount` |
| `VModelRadio` | `_vModelRadio` | `Created`, `BeforeUpdate`, `BeforeUnmount` — the only one without `Mounted` |
| `VModelSelect` | `_vModelSelect` | All five: `Created`, `Mounted`, `BeforeUpdate`, `Updated`, `BeforeUnmount` |
| `VModelDynamic` | `_vModelDynamic` | All five |

The v-model directives carry their bound value as a `ViuModelBinding` — a `Value` snapshot paired
with an `Action<object?> Setter` — rather than reaching for a component member reflectively. That is
the shape to imitate if you need a directive that writes back to component state under the
no-reflection contract:

```csharp
public sealed class ViuModelBinding
{
    public ViuModelBinding(object? value, Action<object?> setter);
    public object? Value { get; }
    public Action<object?> Setter { get; }
}
```

See [Built-in Directives](../../api/built-in-directives.md) for their full semantics, and
[Form Input Bindings](../essentials/form-bindings.md) for the v-model family in use.

## Timing and observability

Directive hooks share the renderer's flush model with lifecycle hooks and template refs:

- **`Mounted`, `Updated`, and `Unmounted` run post-flush.** They are not synchronous with the patch
  that caused them.
- **A direct `Renderer<TNode>.Render` call drains the pre- and post-flush queues before returning**,
  so in a test all directive hooks are observable immediately after the call. Reactive updates, by
  contrast, wait for a flush — `Scheduler.NextTick()` is what you await for those, and note it
  returns `Task.CompletedTask` when nothing is queued, so awaiting it does not yield.

See [Lifecycle Hooks & Template Refs](../essentials/lifecycle-and-template-refs.md) for the full
flush-timing rules, and [Testing](../scaling-up/testing.md) for the scheduler-pump pattern.

## Not yet implemented

- **A public element-operations API.** The internal browser directive operations are not exposed, so
  a user-authored directive cannot mutate the DOM from a node handle. This is the single largest gap
  on this page.
- **Template-declared modifiers on a custom directive.** The compiler emits them as
  `_createProps(("name", true))`, and `RenderHelpers._withDirectives` reads that slot as
  `IReadOnlyDictionary<string, bool>` — a cast a `VirtualNodeProperties` fails — so
  `binding.Modifiers` arrives empty for `v-my-dir.foo` written in a `.viu` template. Use
  `Directives.WithDirectives` or `DirectiveArgument` directly when a directive needs modifiers.
  (Argument and value slots are unaffected.)
- **`getSSRProps`.** Upstream directives may contribute server-rendered props. There is no server
  renderer in Viu, so there is no equivalent hook — see
  [KeepAlive, Teleport & Suspense](../built-ins/deferred-built-ins.md) and
  [Project status](../../roadmap/status.md) for the broader SSR picture.
- **`v-show` plus `<Transition>` coordination.** `VShow`'s transition seam hooks exist but are
  documented-inert placeholders; see [Transition & TransitionGroup](../built-ins/transition.md).
- **Deprecated Vue 2 hook aliases** (`bind`, `inserted`, `update`, `componentUpdated`, `unbind`).
  Viu ports the Vue 3 hook set only.

## See also

- [Composables](./composables.md) — reusable *state*, the other half of Vue's reusability story.
- [Built-in Directives](../../api/built-in-directives.md) — the full reference for `v-show`, `v-model`,
  and the compiler-known directives.
- [Dynamic Components & Registration](../components/dynamic-components.md) — the exact-versus-render-time
  resolution split, shared with component registration.
- [Differences from Vue 3](../../roadmap/vue-differences.md) — the naming map and behavioral divergences.
