# Testing

Unit-testing Viu components on a plain CoreCLR xUnit host with `Assimalign.Viu.Testing` — no browser,
no WebAssembly, no JavaScript interop.

> **Status:** Implemented. The in-memory renderer and the component wrapper API both ship and are
> exercised by the framework's own test suite. There is no browser end-to-end harness and no
> benchmark suite yet — see [Project status](../../roadmap/status.md).

`Assimalign.Viu.Testing` is the C# counterpart of two upstream Vue packages at once, and it is easiest
to understand as exactly that:

| Layer | Viu | Upstream Vue | Use it when |
| --- | --- | --- | --- |
| Renderer | `TestRenderer`, `TestElement`, `TestNodeOperationLog` | [`@vue/runtime-test`](https://github.com/vuejs/core/tree/main/packages/runtime-test) | The test is about renderer, patch, or scheduler behavior |
| Component utilities | `ViuTest.Mount`, `ComponentWrapper`, `ElementWrapper` | [`@vue/test-utils`](https://test-utils.vuejs.org/) | The test is about a component's behavior |

The whole library is DOM-free by design. The node tree is a small in-memory graph of `TestElement`,
`TestText`, and `TestComment` objects that fulfils the renderer's node-operations contract exactly as
the browser adapter does, so an op sequence observed in a test is the op sequence the browser would
have received. That is a hard rule, not a convenience: unit tests must never require a browser.

Everything is AOT- and trimming-safe. Components are passed to `Mount` as **instances**, never as a
`Type` or a name; there is no reflection-based activation anywhere in the library; stubs are plain
component definitions; and the event dispatcher invokes delegates directly rather than through
`DynamicInvoke`. The constraints this creates are real and are documented below.

## Setting up a test project

`Assimalign.Viu.Testing` is a dev-time harness and is deliberately **not** part of the
`Assimalign.Viu.App` shared framework, so it must be referenced explicitly. The test project is an
ordinary `Microsoft.NET.Sdk` library — not `Assimalign.Viu.Sdk` — because nothing in it runs on
WebAssembly. You do not need the `wasm-tools` workload to run these tests.

```xml
<Project Sdk="Microsoft.NET.Sdk">
    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
        <IsPackable>false</IsPackable>
    </PropertyGroup>

    <ItemGroup>
        <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.6.0" />
        <PackageReference Include="xunit" Version="2.9.3" />
        <PackageReference Include="xunit.runner.visualstudio" Version="3.1.5" />
        <PackageReference Include="Shouldly" Version="4.3.0" />
        <PackageReference Include="Assimalign.Viu.Testing" Version="10.0.1-preview.2" />
    </ItemGroup>

    <ItemGroup>
        <ProjectReference Include="..\MyApp\MyApp.csproj" />
    </ItemGroup>
</Project>
```

> **Aspirational:** the `Assimalign.Viu.Testing` package reference above assumes a feed that has the
> package. Nothing is published to nuget.org yet; today the only distribution is the repo-local
> `_out/packages` feed produced by `scripts/Install-Local.ps1`. See
> [The Viu SDK & Build](sdk-and-build.md) and [Quick Start](../quick-start.md).

Viu's own test projects look slightly different — they use `<ViuPackageReference>` and
`<ViuProjectReference>` with no `Version` attributes, because package versions are centralized in
`build/Targets/Build.References.Packages.targets`. Those item types are in-repo dogfooding mechanisms
and are not available to a consumer project; the versions pinned above are the ones that file
currently resolves.

xUnit v2 plus [Shouldly](https://docs.shouldly.org/) is the sanctioned combination throughout the
codebase. Every example on this page uses them.

### Disabling test parallelization is required

Add this to your test assembly. It is not optional:

```csharp
using Xunit;

// The scheduler and the test node tree use ambient static state under the single-threaded JS
// event-loop model, so tests must not run in parallel.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
```

`Scheduler.FlushDispatcher` and the `TestNode.Identifier` counter are process-wide static state.
`ComponentWrapper`, `TestSchedulerPump`, and `TestNode` are all documented as not thread-safe, which
mirrors the runtime itself: nothing in Viu is thread-safe, because the browser event loop is
single-threaded. Without this attribute, two tests running concurrently will clobber each other's
scheduler state and fail in ways that look like flakiness rather than a configuration mistake.

## Your first component test

Here is a complete, self-contained component — a counter that seeds its state from a prop, emits
`ready` during mount, and emits `change` on every increment. It is written by hand against
`IComponentDefinition` so that every moving part is visible. (A `.viu` file is *intended* to reduce to
this same shape, but **does not yet** — the generator emits a partial class with a `static Render`
method and no `IComponentDefinition` implementation, so a `.viu` component cannot be mounted or
tested today. Hand-written components are the only testable path; see
[Single-File Components](single-file-components.md#not-yet-implemented).)

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp.Components;

// A counter: prop-seeded reactive count, emits "ready" on mount and "change" per increment.
public sealed class CounterComponent : IComponentDefinition
{
    private static readonly IReadOnlyList<ComponentPropertyDefinition> DeclaredProperties =
        [new ComponentPropertyDefinition("start") { DefaultValue = 0 }];

    private static readonly IReadOnlyList<ComponentEmitDefinition> DeclaredEmits =
        [new ComponentEmitDefinition("ready"), new ComponentEmitDefinition("change")];

    public string? Name => "Counter";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties => DeclaredProperties;

    public IReadOnlyList<ComponentEmitDefinition>? Emits => DeclaredEmits;

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var count = Reactive.Reference(properties.Get<int>("start"));

        context.Emit("ready", count.Value); // emitted during mount

        void Increment()
        {
            count.Value++;
            context.Emit("change", count.Value);
        }

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", "counter")),
            VirtualNodeFactory.Element(
                "span", VirtualNodeFactory.Properties(("class", "count")), count.Value.ToString()),
            VirtualNodeFactory.Element(
                "button", VirtualNodeFactory.Properties(("onClick", (Action)Increment)), "+"));
    }
}
```

And the test:

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

using Shouldly;
using Xunit;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.Shared;
using Assimalign.Viu.Testing;

using MyApp.Components;

namespace MyApp.Tests;

public class CounterComponentTests
{
    [Fact]
    public void Mount_RendersComponent_ExposesHtmlTextAndInstance()
    {
        using var wrapper = ViuTest.Mount(new CounterComponent());

        wrapper.Instance.ShouldNotBeNull();
        wrapper.Exists().ShouldBeTrue();
        wrapper.Html().ShouldBe(
            "<div class=\"counter\"><span class=\"count\">0</span><button>+</button></div>");
        wrapper.Text().ShouldBe("0+");
    }

    [Fact]
    public async Task Trigger_DispatchesThroughTheEventPath_AndAwaitsTheFlush()
    {
        using var wrapper = ViuTest.Mount(new CounterComponent());
        wrapper.Find(".count")!.Text().ShouldBe("0");

        await wrapper.Get("button").Trigger("click");

        // The awaited trigger completes only after the scheduler flush, so post-update state is
        // observable without a manual NextTick.
        wrapper.Find(".count")!.Text().ShouldBe("1");
    }
}
```

That `using` block is the full set every later snippet on this page assumes: `Assimalign.Viu.Reactivity`
for `Reactive.Reference` and `Reference<T>`, `Assimalign.Viu.RuntimeCore` for the vnode and component
types plus `Scheduler`, `Assimalign.Viu.Shared` for `PatchFlags`, and `Assimalign.Viu.Testing` for the
harness itself.

Three things in that test are worth naming explicitly, because they are the rules everything else
depends on.

- **`using var` is mandatory** — `ComponentWrapper.Dispose` unmounts the tree, restores the previously
  installed scheduler flush dispatcher, and calls the scheduler's reset. Leaking a wrapper leaves the
  test pump installed and poisons every subsequent test in the same assembly.
- **One mount may be live at a time** — `ViuTest.Mount` unconditionally resets the scheduler and
  installs a fresh pump, so two live wrappers in one test clobber each other. There is no multi-mount
  or nested-mount support.
- **Awaiting `Trigger` is the whole synchronization story** — the returned `Task` completes only after
  the scheduler flush has drained, so the assertion after it observes post-update state. There is no
  sleeping, no polling, and no `SynchronizationContext` involved.

## `ViuTest.Mount`

```csharp
public static ComponentWrapper Mount<TComponent>(
    TComponent component,
    ComponentMountOptions? options = null)
    where TComponent : IComponentDefinition
```

This is the port of [`mount`](https://test-utils.vuejs.org/api/#mount). It resets the scheduler,
installs a `TestSchedulerPump`, creates a `TestRenderer` and a detached container, builds an
application context from `options` (provides, name-registered components, stubs, app config, and the
emit observer), creates the root component vnode, renders it, and returns the root wrapper. It throws
`ArgumentNullException` when `component` is null.

The type parameter exists for typed `FindComponent<T>` matching, not for activation — the caller
always supplies the instance.

## `ComponentWrapper`

The port of [`VueWrapper`](https://test-utils.vuejs.org/api/). Its constructor is `internal`;
instances come only from `ViuTest.Mount` or from `FindComponent`/`GetComponent`.

| Member | Signature | Behavior |
| --- | --- | --- |
| `Instance` | `ComponentInstance Instance` | The mounted instance — upstream's `vm`. Exposes `Uid`, `Definition`, `Parent`, `Root`, `Scope`, `Properties`, `Attributes`, `Slots`, `Exposed`, `VirtualNode`, `Subtree`, `IsMounted`, `IsUnmounted`. |
| `Exists()` | `bool Exists()` | Whether the component is still mounted. |
| `Html()` | `string Html()` | Serializes the component's host nodes. A fragment root's nodes are concatenated with no separator. Does **not** include the container element. |
| `Text()` | `string Text()` | Concatenates all descendant text nodes with **no separator and no trimming**. Comments contribute nothing. |
| `Find(selector)` | `ElementWrapper? Find(string)` | First matching element, or null. Searches the component's **own root element and all descendants**, descending into child components. |
| `Get(selector)` | `ElementWrapper Get(string)` | Same, but throws `InvalidOperationException` when nothing matches. |
| `FindAll(selector)` | `IReadOnlyList<ElementWrapper> FindAll(string)` | Every match in render order; empty list when nothing matches. |
| `FindComponent<T>()` | `ComponentWrapper?` | First mounted **child** whose definition is `T`, matched as `candidate.Definition is T`. Excludes the starting instance. |
| `GetComponent<T>()` | `ComponentWrapper` | Same, but throws `InvalidOperationException` when nothing matches. |
| `Emitted(name)` | `IReadOnlyList<IReadOnlyList<object?>>` | Ordered occurrences of one event emitted by **this** component, each an argument list. |
| `Emitted()` | `IReadOnlyDictionary<string, IReadOnlyList<IReadOnlyList<object?>>>` | Every event this component emitted, keyed by name. |
| `Trigger(name, payload)` | `Task Trigger(string, object? = null)` | Dispatches on the component's **first host element** and awaits the flush. |
| `SetValue(value)` | `Task SetValue(object?)` | Sets the root element's `value` property, dispatches `input` with that payload, awaits the flush. |
| `NextTickAsync()` | `Task` | Pumps every captured flush to completion, then awaits the tick. The port of `nextTick()`. |
| `FlushAsync()` | `Task` | The `flushPromises` counterpart — **identical implementation** to `NextTickAsync`. |
| `Unmount()` | `void` | Unmounts by rendering null into the container. Root wrapper only. |
| `Dispose()` | `void` | Unmounts, restores the previous flush dispatcher, resets the scheduler. Root wrapper only. |

`NextTickAsync` and `FlushAsync` call the same method. The two names exist for upstream parity, not
for different behavior — do not reach for `FlushAsync` expecting it to drain something
`NextTickAsync` will not.

`Trigger` and `SetValue` act on the component's first host **element** node. A component that renders
only text or comment host nodes makes both throw `InvalidOperationException` with
`"The component has no root element to trigger events on."` or `"…to set a value on."`.

### Non-root wrappers

A wrapper obtained from `FindComponent` or `GetComponent` is **non-root**: its `Unmount()` and
`Dispose()` are silent no-ops. Only the wrapper `ViuTest.Mount` returned owns the mount lifecycle.

```csharp
[Fact]
public void FindComponent_LocatesAChildByType_WithExistsAndThrowingVariants()
{
    var host = new HostComponent();
    using var wrapper = ViuTest.Mount(host);

    var child = wrapper.FindComponent<CounterComponent>();
    child.ShouldNotBeNull();
    child.Instance.Definition.ShouldBeSameAs(host.Counter);

    wrapper.FindComponent<SelectorComponent>().ShouldBeNull();
    Should.Throw<InvalidOperationException>(() => { wrapper.GetComponent<SelectorComponent>(); });
}

// Renders a Counter child (stable definition) so FindComponent/stubbing have something to find.
public sealed class HostComponent : IComponentDefinition
{
    public CounterComponent Counter { get; } = new();

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => () => VirtualNodeFactory.Element("main", VirtualNodeFactory.Component(Counter));
}
```

Note `HostComponent` holding its child definition in a property. That is not incidental — it is what
makes the definition instance addressable from the test, which stubbing requires.

## `ElementWrapper`

The port of [`DOMWrapper`](https://test-utils.vuejs.org/api/#element). Its constructor is `internal`;
instances come only from a wrapper's `Find`/`Get`/`FindAll`. It is not `IDisposable`.

| Member | Behavior |
| --- | --- |
| `Element` | The underlying `TestElement` — the escape hatch to `Tag`, `Namespace`, `Properties`, `Children`, `EventListeners`. |
| `Exists()` | **Always returns `true`.** Absence is expressed by `Find` returning null, never by a wrapper reporting `false`. |
| `Html()` | The element's serialized markup, including the element itself. |
| `Text()` | Descendant text concatenated, no separator, no trimming. |
| `Attribute(name)` | The raw boxed value last patched — an `object?`, **not** a string. Ordinal, case-sensitive lookup. Returns null when absent. |
| `Find` / `Get` / `FindAll` | `querySelector` semantics — **excludes the element itself**, unlike `ComponentWrapper.Find`. |
| `Trigger(name, payload)` | Dispatches through `TestEventDispatcher` and awaits the flush. |
| `SetValue(value)` | Sets `value`, dispatches `input` with that payload, awaits the flush. |

The scope difference between the two `Find` methods is the one that catches people:
`wrapper.Get("div").Find("div")` does not re-find the same node, because `ElementWrapper.Find` starts
at the children. `ComponentWrapper.Find` includes the component's own root.

Because `Attribute` returns `object?`, compare against the boxed original type or call `ToString()`
yourself:

```csharp
wrapper.Get("input").Attribute("value").ShouldBe("hello");
wrapper.Get(".count").Element.Properties["class"].ShouldBe("count");
```

## Selectors

Selector support is a deliberately small CSS subset — **a single simple selector only**, matched
ordinally and case-sensitively:

| Form | Matches |
| --- | --- |
| `span` | Ordinal string equality against `TestElement.Tag`. |
| `#title` | Ordinal equality against the `id` property's `ToString()`. |
| `.highlight` | The `class` property must be a `string`; it is split on spaces and compared token-wise, ordinally. |
| `[data-role]` | The property key exists. |
| `[data-role=action]` | Ordinal equality against the property's `ToString()`; surrounding quotes on the value are trimmed. |

Anything else — compound selectors, descendant or child combinators, comma lists, `:pseudo`,
`[attr^=…]` — is unsupported and simply does not match. It is not an error; the selector quietly
finds nothing. A `[` selector missing its closing `]` also never matches. A non-string `class`
property value never matches a `.class` selector.

```csharp
[Fact]
public void Find_SupportsTagIdClassAndAttributeSelectors()
{
    using var wrapper = ViuTest.Mount(new SelectorComponent());

    wrapper.Find("span").ShouldNotBeNull();
    wrapper.Find("#title").ShouldNotBeNull();
    wrapper.Find(".highlight").ShouldNotBeNull();
    wrapper.Find("[data-role=action]").ShouldNotBeNull();
    wrapper.Find(".missing").ShouldBeNull();
    Should.Throw<InvalidOperationException>(() => { wrapper.Get(".missing"); });
    wrapper.FindAll("span").Count.ShouldBe(2);
}

public sealed class SelectorComponent : IComponentDefinition
{
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => () => VirtualNodeFactory.Element(
            "section",
            VirtualNodeFactory.Element("span", VirtualNodeFactory.Properties(("id", "title")), "Title"),
            VirtualNodeFactory.Element("span", VirtualNodeFactory.Properties(("class", "highlight")), "Body"),
            VirtualNodeFactory.Element(
                "button", VirtualNodeFactory.Properties(("data-role", "action")), "Go"));
}
```

Because `Find` returns `ElementWrapper?`, C# nullable analysis will push you toward either `Get` (which
throws on a miss and is usually what a test wants) or a null-forgiving `Find(".count")!`.

## Triggering events

Three rules govern dispatch, and all three fail quietly rather than loudly.

- **Event names are registered lower-cased** — `patchProp` registers an `onClick` prop under the key
  `"click"` and `onMouseOver` under `"mouseover"`. Always trigger with the fully lower-cased name;
  `Trigger("mouseOver")` matches nothing.
- **Listeners must be `Action` or `Action<object?>`** — those are the only two shapes
  `TestEventDispatcher` invokes. Reflection-based invocation is forbidden by the AOT and trimming
  rules, so there is no `DynamicInvoke` fallback, and any other delegate shape throws
  `NotSupportedException` at trigger time. Hand-written components must cast explicitly, as in
  `("onClick", (Action)Increment)` and `("onInput", (Action<object?>)OnInput)`.
- **Triggering an unregistered event is a silent no-op** — `TestEventDispatcher.Trigger` returns
  `false` and the wrapper discards that bool, still awaiting the flush. A typo'd event name surfaces
  as a missing state change, not as an exception.

`TestEventDispatcher.Trigger(TestElement, string, object?)` is public if you need the bool return.
Multicast delegates (merged handlers) invoke every target in order.

There is no structured event-options support. Upstream's `trigger('keydown.enter')` modifier syntax
and `trigger('click', { button: 0 })` options object have no counterpart — the second argument is a
single opaque `object? payload` handed to `Action<object?>` listeners.

### Driving inputs with `SetValue`

`SetValue` sets the element's `value` property, dispatches `input` with that value as the payload,
and awaits the flush — which is exactly the shape a `v-model` binding consumes (see
[Form Input Bindings](../essentials/form-bindings.md)).

```csharp
[Fact]
public async Task SetValue_UpdatesInput_FiresInput_AndAwaitsTheFlush()
{
    using var wrapper = ViuTest.Mount(new InputComponent());

    await wrapper.Get("input").SetValue("hello");

    wrapper.Find(".echo")!.Text().ShouldBe("hello");
}

// A v-model-style input echoing its value into a span.
public sealed class InputComponent : IComponentDefinition
{
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var text = Reactive.Reference(string.Empty);

        void OnInput(object? value) => text.Value = value?.ToString() ?? string.Empty;

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Element(
                "input",
                VirtualNodeFactory.Properties(("onInput", (Action<object?>)OnInput), ("value", text.Value)),
                (VirtualNode?[]?)null),
            VirtualNodeFactory.Element(
                "span", VirtualNodeFactory.Properties(("class", "echo")), text.Value));
    }
}
```

## Asserting emitted events

`Emitted()` is scoped to the wrapper's own instance. The recorder is installed as the application
context's emit observer *before* the render, which is why events emitted during `Setup` — during
mount — are captured too.

```csharp
[Fact]
public async Task Emitted_CapturesEventsInOrder_IncludingDuringMount()
{
    using var wrapper = ViuTest.Mount(new CounterComponent());

    // Emitted during mount (the component emits "ready" in setup).
    wrapper.Emitted("ready").Count.ShouldBe(1);
    wrapper.Emitted("ready")[0].ShouldBe(new object?[] { 0 });

    await wrapper.Get("button").Trigger("click");
    await wrapper.Get("button").Trigger("click");

    var changes = wrapper.Emitted("change");
    changes.Count.ShouldBe(2);
    changes[0].ShouldBe(new object?[] { 1 });
    changes[1].ShouldBe(new object?[] { 2 });
    wrapper.Emitted().ShouldContainKey("change");
}
```

Each occurrence is the full argument array from the `Emit` call, so an event with no payload records
an empty array. `Emitted(name)` returns an empty list — not null — when the event never fired, and
throws `ArgumentException` for a null or empty event name. The no-argument `Emitted()` takes no name
and cannot throw; it returns an empty dictionary when nothing was emitted.

A child wrapper from `FindComponent` reports only its own events, because lookup is keyed by
`ComponentInstance` even though the underlying recorder is shared across the mount.

## `ComponentMountOptions`

The port of `mount(component, options)`'s second argument. Every member is optional.

| Member | Type | Upstream | Notes |
| --- | --- | --- | --- |
| `Properties` | `VirtualNodeProperties?` | `props` | **Not** a dictionary and **not** `ComponentProperties`. Build it with `VirtualNodeFactory.Properties(("start", 10))`. |
| `Slots` | `ComponentSlots?` | `slots` | Passed straight through to the component vnode. |
| `Provides` | `Dictionary<object, object?>` | `global.provide` | Get-only. Keyed by the same `InjectionKey<T>`/string identities `Inject` uses. |
| `Components` | `Dictionary<string, IComponentDefinition>` | `global.components` | Get-only, ordinal and case-sensitive keys. For name-based and dynamic resolution. |
| `Stubs` | `Dictionary<IComponentDefinition, IComponentDefinition?>` | `global.stubs` | Get-only. Keyed by definition **instance** (reference equality). A null value means the auto-generated placeholder. |
| `ConfigureApplication` | `Action<ApplicationConfiguration>?` | `global.config` | Invoked after provides/components/stubs, before the emit observer is installed. `ErrorHandler` takes effect; `WarnHandler` does **not** (see [below](#configuring-the-application)). |

`Provides`, `Components`, and `Stubs` are get-only dictionaries the options object initializes itself,
so you populate them rather than assign them (`Components` is constructed with `StringComparer.Ordinal`;
the other two use default equality). Fluent helpers exist for the common cases: `Provide<T>(InjectionKey<T>, T)`,
`Provide(string, object?)`, and `Stub(IComponentDefinition, IComponentDefinition? = null)`, each
returning the options object.

### Passing props

```csharp
[Fact]
public async Task CounterComponent_SeedsFromProps_AndDrivesStateThroughTheRealScheduler()
{
    // Props seed state, a click mutates a reactive ref (scheduled re-render), and the awaited
    // trigger observes the post-flush tree and the emitted event — no sleeping or polling.
    var options = new ComponentMountOptions
    {
        Properties = VirtualNodeFactory.Properties(("start", 10)),
    };

    using var wrapper = ViuTest.Mount(new CounterComponent(), options);
    wrapper.Get(".count").Text().ShouldBe("10");

    await wrapper.Get("button").Trigger("click");
    wrapper.Get(".count").Text().ShouldBe("11");

    await wrapper.Get("button").Trigger("click");
    wrapper.Get(".count").Text().ShouldBe("12");

    var changes = wrapper.Emitted("change");
    changes.Count.ShouldBe(2);
    changes[0].ShouldBe(new object?[] { 11 });
    changes[1].ShouldBe(new object?[] { 12 });
}
```

Props can only be supplied **at mount time**. There is no `SetProps` equivalent, so a test that needs
a second set of props mounts a second time.

### Supplying app-level provides

`Provides` populates the application context's provides table, which is what
`DependencyInjection.Inject` resolves against at the root of the tree. See
[Provide / Inject](../components/provide-inject.md).

```csharp
[Fact]
public void Provides_FromGlobalConfig_AreInjectableByTheComponent()
{
    var options = new ComponentMountOptions().Provide("theme", "dark");
    using var wrapper = ViuTest.Mount(new InjectingComponent(), options);

    wrapper.Text().ShouldBe("dark");
}

// Injects an app-level provide and renders it.
public sealed class InjectingComponent : IComponentDefinition
{
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var theme = DependencyInjection.Inject("theme") as string ?? "default";
        return () => VirtualNodeFactory.Element("div", theme);
    }
}
```

The typed overload uses the same reference-identity `InjectionKey<T>` the component uses:

```csharp
private static readonly InjectionKey<IClock> ClockKey = new("clock");

var options = new ComponentMountOptions().Provide(ClockKey, new FixedClock(new DateTime(2026, 1, 1)));
```

Because `InjectionKey<T>` identity is reference identity, the key the test provides under must be the
very same static instance the component injects with — two keys with the same `Name` are different
keys.

### Configuring the application

`ConfigureApplication` is the hook for app-level configuration. The most useful case is capturing
errors, since Viu has no dedicated helper for it:

```csharp
[Fact]
public void ErrorHandler_ReceivesUncapturedComponentErrors()
{
    var errors = new List<Exception>();

    var options = new ComponentMountOptions
    {
        ConfigureApplication = config =>
            config.ErrorHandler = (exception, instance, info) => errors.Add(exception),
    };

    using var wrapper = ViuTest.Mount(new ThrowingComponent(), options);

    errors.Count.ShouldBe(1);
    errors[0].ShouldBeOfType<InvalidOperationException>();
}

// Throws from Setup. The runtime catches it, routes it to the app-level handler, and substitutes a
// null-returning render function, so the mount still completes.
public sealed class ThrowingComponent : IComponentDefinition
{
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => throw new InvalidOperationException("boom");
}
```

A `Setup` that throws is routed with the info string `"setup function"`; a render function that throws
is routed with `"render function"`. In both cases the runtime installs `() => null` as the render
function and the mount completes rather than tearing down, so the wrapper is still usable afterwards.

`ApplicationConfiguration.ErrorHandler` is `Action<Exception, ComponentInstance?, string>?`. Setting it
makes it the terminal sink — the error is delivered rather than rethrown — so a test that wants the
exception to propagate should leave it null. `ApplicationConfiguration.Performance` exists but has no
effect yet.

> **`WarnHandler` does not work under `ViuTest.Mount`.** `ApplicationConfiguration.WarnHandler` is
> `Action<string>?` and you can assign it from `ConfigureApplication`, but nothing will ever call it:
> the handler is installed as the runtime's warning sink by `Application<TNode>.Mount`, and
> `ViuTest.Mount` bypasses `Application<TNode>` entirely — it builds an application context directly
> and renders. The sink itself (`RuntimeWarnings.Sink`) is `internal` to
> `Assimalign.Viu.RuntimeCore`, so a consumer test project cannot reach around it either. **Dev
> warnings cannot be captured from a mounted component test today.** Assert on behavior instead, or
> drive the component through a real `Application<TNode>` if warning capture is the point of the test.

### Slots

`ComponentMountOptions.Slots` is wired through to the component vnode, but no test anywhere in the
Viu repository exercises it, so there is no verified usage to reproduce here. Treat it as available
but unproven. `ComponentSlots` exposes `Flag`, `Count`, `this[string]`, `Contains(string)`, and
`TryGetSlot(string, out Slot?)`; see [Slots](../components/slots.md) for the `Slot` delegate shape.

## Stubbing child components

A stub replaces a child component with something cheap, so a test can focus on the parent.

```csharp
[Fact]
public void Stub_ReplacesAChildComponent_WithARecognizablePlaceholderTag()
{
    var host = new HostComponent();
    var options = new ComponentMountOptions().Stub(host.Counter);
    using var wrapper = ViuTest.Mount(host, options);

    // The real counter never renders — its <span class="count"> is absent, a <counter-stub> is
    // in its place (upstream default stub placeholder).
    wrapper.Html().ShouldContain("<counter-stub>");
    wrapper.Find(".count").ShouldBeNull();
    wrapper.FindComponent<CounterComponent>().ShouldBeNull();
}
```

Two rules matter here.

- **Stub keys use reference identity** — `Stubs` is a `Dictionary<IComponentDefinition, …>` with
  default reference equality, so the stub only takes effect when the test holds the **same definition
  instance** the parent renders. That is why `HostComponent` exposes
  `public CounterComponent Counter { get; } = new();` and the test passes `host.Counter`. A freshly
  constructed `new CounterComponent()` would key a different entry and stub nothing.
- **The auto-generated placeholder is a bare element** — its tag is the definition's `Name`
  kebab-cased plus `-stub`, so `Name` `"Counter"` renders `<counter-stub>`, and a null or empty `Name`
  renders `<anonymous-stub>`. It has no children, so the real component's text and inner elements
  disappear entirely.

Passing an explicit second argument substitutes your own definition instead, which is how you make a
stub that renders recognizable content or records the props it received:

```csharp
var options = new ComponentMountOptions().Stub(host.Counter, new FakeCounterComponent());
```

Stubbing is per-component only. There is no `shallowMount` and no option to stub every child at once.

## Observing state without a `vm`

Vue's test utils let a test read and write component state through `wrapper.vm.count`. Viu has no
equivalent, and this is structural rather than an omission: there is no `this`-proxy anywhere in Viu.
A component's state lives in closures over refs that `Setup` returned a render function over, so there
is nothing for a wrapper to expose. See [Components](../essentials/components.md).

That leaves three ways to observe and drive state, all of which are the behaviors you actually want to
pin:

- **Observe through rendered output** — `Html()`, `Text()`, `Find(...)!.Text()`, and
  `Attribute(name)`. This is what a user would see.
- **Observe through `Emitted()`** — the component's public event contract.
- **Drive through `Trigger` and `SetValue`** — or, when the state belongs to a composable or an
  app-level provide, by mutating a ref the test itself owns and then awaiting `NextTickAsync()`.

The last of those is worth spelling out, because it is the cleanest way to test a composable that a
component consumes:

```csharp
[Fact]
public async Task Component_RerendersWhenAProvidedRefChanges()
{
    var title = Reactive.Reference("first");
    var options = new ComponentMountOptions().Provide("title", title);

    using var wrapper = ViuTest.Mount(new TitleComponent(), options);
    wrapper.Text().ShouldBe("first");

    title.Value = "second";
    await wrapper.NextTickAsync();

    wrapper.Text().ShouldBe("second");
}

// Renders a ref the test owns, injected as an app-level provide.
public sealed class TitleComponent : IComponentDefinition
{
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var title = DependencyInjection.Inject("title") as Reference<string>;
        return () => VirtualNodeFactory.Element("h1", title?.Value ?? string.Empty);
    }
}
```

Mutating a ref queues a re-render on the scheduler; awaiting `NextTickAsync` pumps the captured flush
and makes the result observable. Without the await, the assertion would still see `"first"` — the
render effect is scheduled, not synchronous.

## The low-level layer: `TestRenderer`

Reach for `TestRenderer` when the test is about the renderer rather than a component — patch behavior,
block trees, keyed reconciliation, or the exact cost of an update. It is the ready-to-use counterpart
of `@vue/runtime-test`'s exported `render` plus `nodeOps` pair.

| Member | Behavior |
| --- | --- |
| `Renderer` | The underlying `Renderer<TestNode>`: `Render`, `CreateRenderEffect`, `CreateApplication`. |
| `OperationLog` | The `TestNodeOperationLog` every node operation is recorded into. |
| `CreateContainer(tag = "root")` | A detached container to render into. Creation is **not** logged — the log isolates what the renderer did. |
| `Render(node, container)` | Renders `node`; passing null unmounts. Repeated calls on the same container patch rather than remount. |

The constructor does not reset the scheduler or install a pump — that is the fixture's job:

```csharp
public class RendererTests : IDisposable
{
    private readonly TestRenderer _renderer = new();
    private readonly TestElement _container;
    private readonly TestSchedulerPump _pump;

    public RendererTests()
    {
        // The pump captures scheduled flushes — without it the scheduler's thread-pool fallback
        // would race these single-threaded assertions.
        _pump = TestSchedulerPump.Install();
        _container = _renderer.CreateContainer();
    }

    public void Dispose() => _pump.Dispose();

    [Fact]
    public void Render_MountsAnElementTree_WithExpectedOps()
    {
        var tree = VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("id", "app")),
            VirtualNodeFactory.Element("span", "hello"));

        _renderer.Render(tree, _container);

        TestNodeSerializer.Serialize(_container)
            .ShouldBe("<root><div id=\"app\"><span>hello</span></div></root>");
        _renderer.OperationLog.Count(TestNodeOperationType.CreateElement).ShouldBe(2);
        _renderer.OperationLog.Count(TestNodeOperationType.SetElementText).ShouldBe(1);
        _renderer.OperationLog.Count(TestNodeOperationType.Insert).ShouldBe(2);
        _renderer.OperationLog.Count(TestNodeOperationType.PatchProperty).ShouldBe(1);
    }
}
```

Note the container tag in the expected string. `TestNodeSerializer.Serialize` on a container includes
the container element itself — `<root>…</root>` by default — whereas `ComponentWrapper.Html()` does
not, because it serializes only the component's host nodes.

Viu's own renderer fixtures also call the scheduler's reset directly. `Scheduler.Reset()`,
`Scheduler.FlushDispatcher`, and `Renderer<TNode>.PatchVisitCount` are `internal` to
`Assimalign.Viu.RuntimeCore` and reachable only through `InternalsVisibleTo`, so a consumer test
project cannot use them. `TestSchedulerPump.Install()` is public and is enough; when you need the full
reset, mount through `ViuTest.Mount`, which performs it internally.

### `TestSchedulerPump`

`TestSchedulerPump` is what makes any of this deterministic. It installs itself as the scheduler's
flush dispatcher, capturing scheduled flushes instead of letting them run, and runs them only when the
test says so — the stand-in for "let the JS event loop turn" around Vue's `nextTick` flush. It hooks
the scheduler's dispatcher seam rather than an ambient `SynchronizationContext`, so a test framework
hopping threads cannot strand a flush.

| Member | Behavior |
| --- | --- |
| `Install()` | Static factory; installs the pump and remembers the previous dispatcher. The constructor is private. |
| `PendingFlushCount` | Captured flushes waiting to run — the way to assert flush batching. |
| `RunUntilIdle()` | Runs captured flushes, including ones captured while draining, until none remain; returns how many ran. |
| `Dispose()` | Restores the previous dispatcher. Idempotent. |

```csharp
[Fact]
public void MultipleJobsQueuedInOneTurn_ProduceExactlyOneFlush()
{
    var flushedOrder = new List<int>();
    Scheduler.QueueJob(new SchedulerJob(() => flushedOrder.Add(1)) { Identifier = 1 });
    Scheduler.QueueJob(new SchedulerJob(() => flushedOrder.Add(2)) { Identifier = 2 });

    // One posted continuation == one flush for the whole turn.
    _pump.PendingFlushCount.ShouldBe(1);
    _pump.RunUntilIdle();

    flushedOrder.ShouldBe([1, 2]);
}
```

`RunUntilIdle` is the synchronous pump used when driving `TestRenderer` directly;
`ComponentWrapper.NextTickAsync`/`FlushAsync` are the awaitable equivalents used with a mount.

### The node tree and the serializer

| Type | Notes |
| --- | --- |
| `TestNode` | Base of the tree. `Identifier` is process-unique but from a counter that is **never reset** — never assert on specific values. `Parent` is null when detached. |
| `TestElement` | `Tag`, `Namespace` (`"svg"`, `"mathml"`, or null), `Properties`, `Children`, `EventListeners`. |
| `TestText` | `Text`, plus `IsStaticContent` when the node stands in for a raw static-markup chunk. |
| `TestComment` | `Text`. Serializes as `<!--text-->` and contributes nothing to `Text()`. |

`TestElement.Properties` is keyed ordinally by the **raw prop name as written in the vnode** —
`class`, `id`, `onClick`, `data-role`, `value` — and event-handler props are stored there as the
delegate in addition to appearing in `EventListeners`. `EventListeners` is keyed by the **lower-cased**
event name, which is the mapping that makes `Trigger("mouseover")` correct and `Trigger("mouseOver")`
wrong.

`TestNodeSerializer.Serialize(node, indent = 0)` is the port of `serialize` in `@vue/runtime-test`. It
emits content **verbatim with no HTML encoding**, matching upstream; it skips null-valued props,
`Delegate`-valued props, and any name `VirtualNodeFactory.IsEventListenerName` recognizes; and it
emits props in dictionary insertion order. `indent = 0` produces a single line, which is what the
assertions above depend on.

### Asserting patch efficiency

This is the reason the op log exists. On WebAssembly every node operation is a JS-interop call, and
interop is the framework's performance budget, so the CoreCLR-side op count is a direct proxy for
interop cost. The idiomatic pattern is: mount, reset the log to isolate the patch, render again, then
pin what the patch was allowed to do.

```csharp
[Fact]
public void TargetedTextPatch_IsObservableInTheOpLog()
{
    // A compiled-shape vnode: PatchFlags.Text promises only the text child changes, so the patch
    // is allowed exactly one set-text op and nothing else.
    VirtualNode Compiled(string text)
        => VirtualNodeFactory.Element("div", null, text, PatchFlags.Text);

    _renderer.Render(Compiled("a"), _container);
    _renderer.OperationLog.Reset();

    _renderer.Render(Compiled("b"), _container);

    _renderer.OperationLog.Count(TestNodeOperationType.SetElementText).ShouldBe(1);
    _renderer.OperationLog.StructuralOperationCount.ShouldBe(0);
    _renderer.OperationLog.Operations.Count.ShouldBe(1);
}
```

`PatchFlags` lives in `Assimalign.Viu.Shared`, and the five-argument
`Element(tag, properties, textChildren, patchFlag, dynamicProperties)` overload is the one a compiled
render emits. Pinning `Operations.Count` rather than only the per-type counts is what makes the
assertion airtight: it fails if the patch does *anything* extra, not just extra work of the kinds you
thought to count.

`StructuralOperationCount` is `Insert` plus `Remove`; asserting `ShouldBe(0)` is the canonical way to
say "this patch did no structural work". The log's full surface is `Operations` (oldest first),
`Reset()`, `Count(type)`, `OfType(type)`, and `StructuralOperationCount`. `OfType` is what you use to
assert on an operation's arguments, since `TestNodeOperation` is a `readonly record struct` carrying
`Type`, `TargetNode`, `ParentNode`, `AnchorNode`, `PropertyName`, `PreviousValue`, `NextValue`, and
`Text`.

The operation types are `CreateElement`, `CreateText`, `CreateComment`, `SetText`, `SetElementText`,
`Insert`, `Remove`, `PatchProperty`, and `InsertStaticContent`. `SetText` sets a text node's content;
`SetElementText` replaces an element's entire content with text; `InsertStaticContent` inserts a raw
static chunk in one operation. For `CreateElement`, the operation's `Text` field carries the tag.

Two counting caveats: `CreateContainer` does not record a `CreateElement`, so expected counts should
not include the container; and `InsertStaticContent` currently materializes one `TestText` node with
`IsStaticContent = true` standing in for the whole chunk, rather than a parsed element subtree.

## Conventions used by Viu's own tests

Following these makes a consumer test suite read like the framework's:

- **Class naming** — `{Feature}Tests`, in a project named `{Project}.Tests` sitting beside the code it
  covers.
- **Method naming** — `Method_Scenario_ExpectedBehavior`, as in
  `Mount_RendersComponent_ExposesHtmlTextAndInstance` and
  `Trigger_DispatchesThroughTheEventPath_AndAwaitsTheFlush`, with an Arrange / Act / Assert body.
- **Assert run counts, not just values** — for anything touching reactivity or caching, pin the number
  of effect runs or getter invocations. A test that only checks the final value will pass even when
  caching has silently broken.
- **Cite the upstream contract** — where behavior mirrors Vue 3, a comment naming the `vuejs/core`
  file or the vuejs.org page makes a future divergence show up as a failing test rather than becoming
  enshrined.
- **Cover exception paths and lifecycle edges**, not just the happy path.

## Not yet implemented

The harness covers component behavior well, but it is smaller than `@vue/test-utils`. None of the
following exists:

- **`setProps` / `setData` / `setChecked` / `setSelected`** — props can only be supplied at mount time
  through `ComponentMountOptions.Properties`. Re-rendering with new props is not expressible through
  the wrapper.
- **`shallowMount`** — stubbing is per-component only, via `Stub(real, stub)`. There is no way to stub
  every child at once.
- **`findAllComponents`** — only `FindComponent<T>`/`GetComponent<T>` exist, and both return the first
  match. The descendant list is collected internally but nothing public surfaces it.
- **`global.mocks`, `global.plugins`, `global.directives`, `global.mixins`** — `ComponentMountOptions`
  exposes provides, components, stubs, and config only. Custom directives in particular cannot be
  registered app-level through mount options.
- **`attachTo`** — the container is always a detached in-memory element; you cannot supply your own.
- **`classes()` and a full `attributes()` map** — `ElementWrapper` exposes only `Attribute(name)`;
  reading every prop requires the `Element.Properties` escape hatch.
- **`isVisible()`, `props()`, a `vm`-style state accessor, or any emitted-events reset helper.**
- **Modifier and options syntax on `Trigger`** — no `trigger('keydown.enter')`, no
  `trigger('click', { button: 0 })`.
- **Snapshot-testing integration** — no Verify, no approval files. Snapshot-style assertions are done
  by hand with `TestNodeSerializer.Serialize(...).ShouldBe("…")`.
- **Error capture helpers** — wire `ApplicationConfiguration.ErrorHandler` manually through
  `ConfigureApplication`, as shown above.
- **Warning capture of any kind** — `ConfigureApplication` lets you set
  `ApplicationConfiguration.WarnHandler`, but `ViuTest.Mount` never installs it as the warning sink
  (only `Application<TNode>.Mount` does), and the sink is `internal`. Dev warnings raised during a
  mounted component test are unobservable.
- **Op-log assertion sugar** — beyond `Count`, `OfType`, and `StructuralOperationCount` there is no
  sequence matcher and no diff-friendly formatter.
- **Application- or plugin-level testing helpers** — `TestRenderer.Renderer` exposes
  `CreateApplication`, but there is no wrapper-level API over it.
- **A browser end-to-end harness** — planned, not built. Real IME composition, real focus behavior,
  and actual `selectedOptions` reads are explicitly deferred to it, which means `v-model` focus and
  composition nuances cannot be covered by a unit test today.
- **A performance benchmark suite** — planned, not built. Op counts are the available proxy for
  interop cost in the meantime.

See [Project status](../../roadmap/status.md) for the full picture and
[Differences from Vue 3](../../roadmap/vue-differences.md) for the naming map.
