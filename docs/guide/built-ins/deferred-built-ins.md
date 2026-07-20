# KeepAlive, Teleport & Suspense

The three Vue built-in components that Viu recognizes at compile time but cannot render, what exists
in their place, and the patterns that cover their use cases today.

> **Status:** Not yet implemented. `<Teleport>`, `<KeepAlive>`, and `<Suspense>` are marker objects
> only; constructing one at runtime throws `NotSupportedException`. See
> [Project status](../../roadmap/status.md).

Vue ships five built-in components. Viu implements two of them — see
[Transition & TransitionGroup](./transition.md) — and the remaining three exist as compiler-visible
markers with no renderer behind them. This page exists so that fact is discovered while reading
documentation rather than while debugging a WASM stack trace.

The upstream counterparts are [`<Teleport>`](https://vuejs.org/guide/built-ins/teleport.html),
[`<KeepAlive>`](https://vuejs.org/guide/built-ins/keep-alive.html), and
[`<Suspense>`](https://vuejs.org/guide/built-ins/suspense.html). Nothing on this page is a partial
port of them. They are absent, and the sections below give the workarounds that cover the same
ground with APIs that do exist.

## The failure mode, precisely

`RenderHelpers` in `Assimalign.Viu.RuntimeCore` declares three markers alongside the two that are
real:

```csharp
public static readonly object _Fragment;        // fully realized
public static readonly object _BaseTransition;  // resolves to BaseTransition.Instance
public static readonly object _Teleport;        // marker only
public static readonly object _Suspense;        // marker only
public static readonly object _KeepAlive;       // marker only
```

Each of the three is a `BuiltInVirtualNodeType` — an internal marker class carrying only a `Name` and
an `IsFragment` flag. When a compiled render body passes one of them as the `tag` argument to
`_createVNode` or `_createBlock`, the vnode factory's dispatch reaches the marker arm and throws:

```text
System.NotSupportedException: The built-in component <Teleport> is not yet supported by the runtime renderer.
```

Three properties of that failure matter when you are reading a stack trace:

- **It throws during vnode construction, not during patching** — the exception surfaces the first
  time the component's render function executes, so the component never mounts at all and no partial
  DOM is left behind.
- **The message names the specific built-in** — `<Teleport>`, `<Suspense>`, or `<KeepAlive>` — because
  the marker carries its upstream name for exactly this diagnostic.
- **It is deliberate, not an oversight** — the alternative was silently mis-rendering the children as
  though the wrapper were not there, which would have produced a much harder bug.

## What the compiler already does

The template compiler recognizes all three tags. `ParserContext.IsCoreComponent` matches both the
PascalCase and the kebab/lowercase spellings, exactly as upstream does:

| Template tag | Also matched as | Compiles to | Renders? |
| --- | --- | --- | --- |
| `<Teleport>` | `<teleport>` | `_Teleport` | No — throws |
| `<Suspense>` | `<suspense>` | `_Suspense` | No — throws |
| `<KeepAlive>` | `<keep-alive>` | `_KeepAlive` | No — throws |
| `<BaseTransition>` | `<base-transition>` | `_BaseTransition` | Yes |

So a template using them **compiles cleanly**. This is the trap: there is no build error telling you
the feature is missing. A `.viu` template containing `<Teleport to="body">` emits a perfectly ordinary
block call:

```csharp
return _createBlock(_openBlock(), _Teleport, _createProps(("to", "body")), new object?[] { _createElementVNode("div", null, _toDisplayString(_ctx.tip), 1 /* TEXT */) });
```

Note that `to="body"` is faithfully carried into `_createProps` — the prop survives compilation and is
simply never read, because there is no component to read it.

The compiler applies three further built-in-aware behaviors, all of them upstream parity work that
landed ahead of the runtime:

- **`<Teleport>` and `<Suspense>` force a block** — `TransformElement` sets `shouldUseBlock`, because
  upstream treats both as block boundaries whose children need their own dynamic-child tracking.
- **`<KeepAlive>` forces a block and adds `PatchFlags.DynamicSlots`** — its child is a dynamic
  component by definition, so the parent can never skip the diff.
- **`<Teleport>` and `<KeepAlive>` children are not built as slots** — unlike every other component
  tag, their children stay a plain child array, matching upstream's vnode shape for both.

`<KeepAlive>` is additionally the one of the three with a real diagnostic behind it:
`XKeepAliveInvalidChildren` (`<KeepAlive> expects exactly one child component.`) is reported when more
than one child is present. It is an accurate, useful error about a component that cannot run. See
[Compiler Diagnostics](../../api/diagnostics.md) for the full code list.

## Scaffolding that exists but is inert

Several pieces of the runtime look like support for these built-ins. None of them is. Treating any of
the following as evidence that the feature works will mislead you. (`ShapeFlags` and
`ShapeFlagsExtensions` live in `Assimalign.Viu.Shared`, `Lifecycle` in `Assimalign.Viu.RuntimeCore`,
and `CssVariables` in `Assimalign.Viu.RuntimeDom`.)

- **`ShapeFlags.Teleport` (`1 << 6`) and `ShapeFlags.Suspense` (`1 << 7`)** — declared for upstream bit
  parity and covered by tests, but `Renderer<TNode>` never sets either bit and never branches on it.
- **`ShapeFlags.ComponentShouldKeepAlive` (`1 << 8`) and `ShapeFlags.ComponentKeptAlive` (`1 << 9`)** —
  likewise declared and never set, so a component is never cached instead of unmounted.
- **`ShapeFlagsExtensions.IsTeleport()`, `IsSuspense()`, `ShouldKeepAlive()`, `IsKeptAlive()`** — real,
  correct predicates over flags that nothing in the framework ever raises. Each one returns `false`
  for every vnode Viu actually produces.
- **`Lifecycle.OnActivated` and `Lifecycle.OnDeactivated`** — registration works and the delegates are
  stored on the instance, but nothing ever invokes them, because invocation is KeepAlive's job. A
  component that registers them will simply never see them fire. This is covered in
  [Lifecycle Hooks & Template Refs](../essentials/lifecycle-and-template-refs.md).
- **`Lifecycle.OnServerPrefetch`** — stored and never awaited. In Vue this is the hook `<Suspense>`
  drives during SSR; Viu has neither the built-in nor a server renderer.
- **`CssVariables.UseCssVars`** — the runtime half of `v-bind()` in CSS walks a component's subtree to
  find its root elements, drilling through higher-order components and fragments. Its source states
  outright that the Suspense branch of upstream's `setVarsOnVNode` is intentionally absent, because
  Suspense does not exist.
- **`BaseTransition`'s private `GetInnerChild`** — upstream unwraps a KeepAlive child before animating
  it. Viu keeps the call site for structural parity, but the method body is the identity function
  (`vnode => vnode`), and it cannot be anything else while neither wrapper can be constructed. It is a
  private implementation detail, not a public API you can call.

## Teleport

### What is missing

There is no Teleport component, no `to` prop, and no `disabled` prop. `ShapeFlags.Teleport` is never
set. The renderer has no concept of a mount target other than the container it was given.

### What to do instead

Viu's applications are cheap and independent, so the closest working equivalent to teleporting into a
detached container is **mounting a second `BrowserApplication` into that container**. Give the host
page a sibling mount point:

```html
<main id="app"></main>
<div id="modal-root"></div>
```

Then drive it with a small host that creates and unmounts an application on demand:

```csharp
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

namespace MyApp;

/// <summary>Mounts a component into #modal-root, outside the main application's DOM subtree.</summary>
public static class ModalHost
{
    private static BrowserApplication? current;

    public static void Show(IComponentDefinition modal)
    {
        Hide();
        current = BrowserRuntime.CreateApp(modal);
        current.Mount("#modal-root");
    }

    public static void Hide()
    {
        current?.Unmount();
        current = null;
    }
}
```

A component opens and closes it from ordinary lifecycle and event code (`ConfirmDialog` here is your
own `IComponentDefinition`):

```csharp
using System;

using Assimalign.Viu.RuntimeCore;

namespace MyApp;

public sealed class DeleteButton : IComponentDefinition
{
    public string? Name => "DeleteButton";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        Lifecycle.OnBeforeUnmount(ModalHost.Hide);

        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(
                ("type", "button"),
                ("onClick", (Action)(() => ModalHost.Show(new ConfirmDialog())))),
            "Delete");
    }
}
```

The `(Action)` cast is not decoration. `VirtualNodeFactory.Properties` takes
`(string Name, object? Value)` entries, so an uncast lambda is boxed as whatever natural type the C#
compiler infers for it, and the DOM invoker dispatches **only** `Action` and `Action<BrowserEvent>` —
anything else raises `NotSupportedException` into the error sink at click time rather than at compile
time. See [Event Handling](../essentials/event-handling.md).

Four caveats, all of which follow from this being a genuinely separate application rather than a
relocated subtree:

- **`Mount` clears the container first** — `BrowserApplication.Mount` wipes the target's existing
  content before a client mount, so `#modal-root` must be a container you own outright.
- **Provides do not cross the boundary** — the second application has its own provide table and its
  own root instance, so `DependencyInjection.Inject` inside the modal will not see values provided by
  the main app. Provide them again on the second application, or pass them through
  `BrowserRuntime.CreateApp`'s root properties.
- **Events do not bubble across the boundary either** — the modal's DOM is not inside the main app's
  tree, so a parent component cannot catch its events by listening on an ancestor.
- **Unmount is your responsibility** — nothing ties the second application's lifetime to the component
  that opened it, which is why the example above hooks `OnBeforeUnmount`.

For a modal that does not actually need to escape a clipping or stacking context, the simpler answer
is usually to render it in place and position it with CSS. Teleport's value is escaping `overflow`
and `z-index` containment, not the markup location itself.

## KeepAlive

### What is missing

There is no component cache. There is no `include`, `exclude`, or `max` prop. `OnActivated` and
`OnDeactivated` never fire. Switching a `v-if` branch or a `<component :is>` target **unmounts** the
outgoing component and destroys its state, every time, with no way to opt out.

### What to do instead

Since the component instance cannot survive, **move the state you want to keep somewhere that
outlives the component**. A composable backed by an app-level provide does this cleanly and is the
sanctioned pattern regardless — see [Composables](../reusability/composables.md) and
[Provide / Inject](../components/provide-inject.md).

Define the state as an ordinary class holding refs and reactive collections:

```csharp
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

/// <summary>Search state that survives the SearchTab component being unmounted and remounted.</summary>
public sealed class SearchState
{
    public Reference<string> Query { get; } = Reactive.Reference(string.Empty);

    public Reference<int> ScrollOffset { get; } = Reactive.Reference(0);

    public ReactiveList<string> Results { get; } = new();
}

public static class SearchStateModule
{
    public static readonly InjectionKey<SearchState> Key = new(nameof(SearchState));

    /// <summary>Resolves the shared search state, falling back to a fresh instance outside a host app.</summary>
    public static SearchState UseSearchState()
        => DependencyInjection.Inject(Key, static () => new SearchState());
}
```

Provide one instance for the whole application at bootstrap:

```csharp
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

namespace MyApp;

public static class Program
{
    public static async Task Main()
    {
        await BrowserRuntime.InitializeAsync();

        BrowserRuntime.CreateApp(new App())
            .Provide(SearchStateModule.Key, new SearchState())
            .Mount("#app");

        await Task.Delay(Timeout.Infinite);
    }
}
```

The tab component now reads and writes that state, and remounting it restores the query and scroll
position because nothing it owns held them:

```csharp
using System;
using System.Linq;

using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

namespace MyApp;

public sealed class SearchTab : IComponentDefinition
{
    public string? Name => "SearchTab";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var state = SearchStateModule.UseSearchState();

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Element(
                "input",
                VirtualNodeFactory.Properties(
                    ("value", state.Query.Value),
                    ("onInput", (Action<BrowserEvent>)(e => state.Query.Value = e.TargetValue ?? string.Empty)))),
            VirtualNodeFactory.Element(
                "ul",
                state.Results.Select(static result => VirtualNodeFactory.Element("li", result)).ToArray()));
    }
}
```

Two things this pattern does not give you, so that you can decide whether it is enough:

- **The DOM is still torn down and rebuilt** — you are preserving state, not the rendered subtree, so
  transient DOM state that is not in your model (an uncontrolled input's caret, a `<details>` open
  flag, a media element's playback position) is still lost.
- **State is now shared, not cached per instance** — two `SearchTab` instances mounted at once would
  see the same `SearchState`. If you need per-key state, key a
  `ReactiveDictionary<string, SearchState>` in the provided object instead of a single instance.

The `(Action<BrowserEvent>)` cast on `onInput` matters for a second reason beyond the one given under
Teleport: the lambda body `state.Query.Value = …` is an *expression* that yields a value, so without
the cast its inferred natural type is `Func<BrowserEvent, string>`, not `Action<BrowserEvent>`, and
the invoker would reject it. `BrowserEvent` and the handler shapes the invoker accepts are covered in
[Event Handling](../essentials/event-handling.md).

## Suspense

### What is missing

There is no async boundary. There is no `#default`/`#fallback` slot pair, no `onPending`,
`onResolve`, or `onFallback` event, and no `timeout` prop. `ShapeFlags.Suspense` is never set.
`Setup` returns `Func<VirtualNode?>` synchronously and there is no async-setup component form for a
boundary to await — nor is there a `defineAsyncComponent` equivalent, as noted in
[Dynamic Components & Registration](../components/dynamic-components.md).

### What to do instead

Handle the async state explicitly inside the component. Start the work in `Setup`, write into refs
when it completes, and branch in the render function. This is more code than `<Suspense>` but it is
also strictly more expressive — you get a real error branch rather than a separate `onErrorCaptured`
path.

```csharp
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading.Tasks;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

public sealed class UserCard : IComponentDefinition
{
    public string? Name => "UserCard";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties =>
    [
        new ComponentPropertyDefinition("userId") { Required = true },
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var userId = properties.Get<string>("userId") ?? string.Empty;

        var name = Reactive.Reference<string?>(null);
        var error = Reactive.Reference<string?>(null);
        var isLoading = Reactive.Reference(true);

        // The browser event loop is single-threaded, so the continuation resumes on the same loop
        // the renderer runs on. Writing a ref here schedules a re-render exactly as an event would.
        _ = LoadAsync();

        return () =>
        {
            if (isLoading.Value)
            {
                return VirtualNodeFactory.Element(
                    "p",
                    VirtualNodeFactory.Properties(("class", "loading")),
                    "Loading…");
            }

            if (error.Value is { } message)
            {
                return VirtualNodeFactory.Element(
                    "p",
                    VirtualNodeFactory.Properties(("class", "error")),
                    message);
            }

            return VirtualNodeFactory.Element(
                "article",
                VirtualNodeFactory.Element("h2", name.Value ?? "Unknown"));
        };

        async Task LoadAsync()
        {
            try
            {
                using var client = new HttpClient();
                name.Value = await client.GetStringAsync($"/api/users/{userId}/name");
            }
            catch (HttpRequestException exception)
            {
                error.Value = exception.Message;
            }
            finally
            {
                isLoading.Value = false;
            }
        }
    }
}
```

The same shape in a `.viu` component reads much closer to the Vue original, using `v-if` /
`v-else-if` / `v-else` where `<Suspense>` would have used slots. **This form does not run yet** — the
`.viu` block parser, the source generator, and the template compiler are all implemented, but the
runtime adapter that turns a generated partial class into an `IComponentDefinition` is not, so
nothing calls `LoadAsync` and nothing mounts the result. Treat it as the shape the format will take,
not as working code; the hand-written component above is today's working path. See
[Not yet implemented](../scaling-up/single-file-components.md#not-yet-implemented).

```viu
@template {
    <p v-if="IsLoading" class="loading">Loading&hellip;</p>
    <p v-else-if="Error != null" class="error">{{ Error }}</p>
    <article v-else>
        <h2>{{ Name }}</h2>
    </article>
}

@script {
    using System.Net.Http;
    using System.Threading.Tasks;

    using Assimalign.Viu.Reactivity;

    public Reference<string?> Name = Reactive.Reference<string?>(null);
    public Reference<string?> Error = Reactive.Reference<string?>(null);
    public Reference<bool> IsLoading = Reactive.Reference(true);

    public async Task LoadAsync(string userId)
    {
        try
        {
            using var client = new HttpClient();
            Name.Value = await client.GetStringAsync($"/api/users/{userId}/name");
        }
        catch (HttpRequestException exception)
        {
            Error.Value = exception.Message;
        }
        finally
        {
            IsLoading.Value = false;
        }
    }
}
```

Two notes on this pattern:

- **A shared loading shell is a composable, not a boundary** — factor the `isLoading` / `error` /
  `value` triple into a `UseAsync<T>` composable if several components need it. That gives you the
  reuse `<Suspense>` provides without needing a component that can suspend.
- **Nothing coordinates sibling loads** — `<Suspense>` waits for every async dependency in its subtree
  before revealing any of it. Reproducing that means hoisting the loading flags into one shared
  object, typically the same app-level provide pattern shown under KeepAlive.

See [Conditional & List Rendering](../essentials/conditional-and-list.md) for the branch semantics
and [Single-File Components (.viu)](../scaling-up/single-file-components.md) for the block format.

## Summary

| Feature | Marker | Compiles | Renders | Closest working pattern |
| --- | --- | --- | --- | --- |
| `<Teleport>` | `RenderHelpers._Teleport` | Yes | Throws `NotSupportedException` | A second `BrowserApplication` mounted into another container |
| `<KeepAlive>` | `RenderHelpers._KeepAlive` | Yes, with `XKeepAliveInvalidChildren` | Throws `NotSupportedException` | Hoist state into a composable over an app-level provide |
| `<Suspense>` | `RenderHelpers._Suspense` | Yes | Throws `NotSupportedException` | Load into refs in `Setup`, branch with `v-if` |

The two built-ins that do work are documented in [Transition & TransitionGroup](./transition.md). For
the full area-by-area implementation state, see [Project status](../../roadmap/status.md); for the
naming and behavioral map against Vue 3, see
[Differences from Vue 3](../../roadmap/vue-differences.md).
