# AOT & Trimming

Why Viu forbids reflection, dynamic codegen, and assembly scanning — and how that one constraint
explains the shape of nearly every API in this guide.

> **Status:** Implemented. The constraint is honored across every shipping library; the CI size and
> startup budget gates that would enforce it mechanically are not built — see
> [Project status](../../roadmap/status.md).

## The constraint

Viu runs in the browser on WebAssembly, where the whole application is trimmed and ahead-of-time
compiled before it is ever served. Four things are therefore off the table, everywhere in the
framework:

- **No reflection-based serialization or member discovery** — nothing walks a type's members at run
  time to find props, emits, hooks, or state.
- **No dynamic code generation** — no `Reflection.Emit`, no expression-tree compilation, and no
  JavaScript `new Function`, which is what makes runtime template compilation impossible.
- **No assembly scanning** — components, directives, and plugins are never discovered by sweeping
  loaded assemblies for implementations of an interface.
- **No linker-unfriendly activation** — nothing is constructed from a `Type`, a name, or a string;
  you hand the framework instances.

In the Viu repository this is recorded as a hard constraint rather than a preference. Shipping
libraries set `<IsAotCompatible>true</IsAotCompatible>` (centrally, in `libraries/Directory.Build.props`),
and the shared framework registers itself to the .NET SDK with `IsTrimmable="true"`, in
`sdks/Assimalign.Viu.Sdk/Targets/Assimalign.Viu.Sdk.FrameworkReference.props`:

```xml
<KnownFrameworkReference Include="Assimalign.Viu.App"
    TargetFramework="net10.0"
    RuntimeFrameworkName="Assimalign.Viu.App"
    DefaultRuntimeFrameworkVersion="$(ViuAppFrameworkVersion)"
    LatestRuntimeFrameworkVersion="$(ViuAppFrameworkVersion)"
    TargetingPackName="Assimalign.Viu.App.Ref"
    TargetingPackVersion="$(ViuAppFrameworkVersion)"
    RuntimePackNamePatterns="Assimalign.Viu.App.Runtime.**RID**"
    RuntimePackRuntimeIdentifiers="browser-wasm"
    IsTrimmable="true" />
```

Breaking the rule requires an explicit, narrowly scoped, commented deviation. Only two projects set
`IsAotCompatible=false` outright: the `Assimalign.Viu.RuntimeCore.CompiledRenderTests` and
`Assimalign.Viu.RuntimeDom.CompiledRenderTests` projects, which drive Roslyn (`CSharpCompilation`),
`Assembly.Load`, and `Activator.CreateInstance` on purpose to prove the compiled-render contract end
to end — and which are test-only and never shipped. Separately, the `netstandard2.0` build-time
parser and generator libraries have the inherited switch cleared centrally (in
`libraries/Directory.Build.targets`) because the AOT analyzers require `net8.0` or later; see
[Not yet implemented](#not-yet-implemented) below.

## What the constraint already explains

Most of the "why is it spelled like that?" questions a Vue developer has while reading this guide have
the same answer. Each of the following is a consequence, not an independent design choice.

### `reactive()` became an attribute plus a source generator

There is no JavaScript [`Proxy`](https://vuejs.org/api/reactivity-core.html#reactive) in C#, and
building one out of reflection would be exactly the thing AOT forbids. So object reactivity is
compiled instead of intercepted:

```csharp
using Assimalign.Viu.Reactivity;

namespace Demo;

[Reactive]
public partial class TodoItem
{
    public partial string Title { get; set; }
    public partial bool Done { get; set; }
}
```

`ReactiveGenerator` emits the tracking into the class itself — a `Dependency` field and a raw backing
field per property, a `Track()` in the getter, and an `EqualityComparer<T>.Default`-guarded
`Trigger()` in the setter:

```csharp
public partial string Title
{
    get
    {
        this.__TitleDependency.Track();
        return this.__TitleValue;
    }
    set
    {
        if (!global::System.Collections.Generic.EqualityComparer<string>.Default.Equals(this.__TitleValue, value))
        {
            this.__TitleValue = value;
            this.__TitleDependency.Trigger();
        }
    }
}
```

Because the tracking is generated, the generator can also refuse shapes it cannot compile, which is
why misuse surfaces at build time rather than as a runtime surprise: `VUER1001` (not `partial`),
`VUER1002` (static), and `VUER1004` (both `[Reactive]` and `[ShallowReactive]`) are **errors**;
`VUER1003` (an unsupported property, such as `{ get; init; }`) is a **warning** — the class still
compiles and that one property is silently left non-reactive, so do not ignore it. See
[Compiler Diagnostics](../../api/diagnostics.md).

The generator only matches `class` declarations, so a `record`, `struct`, `record struct`, or
`interface` carrying `[Reactive]` produces no generated source at all.

### There is no string-keyed `toRef`, and no standalone `toRefs`

Vue's [`toRefs(obj)`](https://vuejs.org/api/reactivity-utilities.html#torefs) and
`toRef(obj, 'key')` both take a property *name* and reach it reflectively. Viu omits both
deliberately. Only the delegate form exists —
`IReference<T> Reactive.ToRef<T>(Func<T> getter, Action<T>? setter = null)`, read-only when you omit
the setter — and per-property refs come from the generated `ToReferences()`:

```csharp
// ReactivePerson is a [Reactive] partial class with partial Name/Age properties.
var person = new ReactivePerson { Name = "Ada", Age = 30 };

// ReactiveReferences is a generated readonly struct with one IReference<T> per reactive property.
var references = person.ToReferences();

references.Name.Value.ShouldBe("Ada");

// Write-through in both directions: the ref and the property are the same dependency.
references.Name.Value = "Hopper";
person.Name.ShouldBe("Hopper");
```

The generator also emits `ToRawValues()`, returning a `RawValues` struct that reads and writes the raw
backing fields directly — the only genuinely untracked view of a `[Reactive]` object, since
`Reactive.ToRaw(obj)` returns the same instance (Viu has no proxy/target split). Details in
[Reactivity Fundamentals](../essentials/reactivity-fundamentals.md).

### Props and emits are precomputed metadata

Vue discovers a component's contract from its options object. Viu cannot, so `IComponentDefinition`
declares it as data you supply:

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace Demo;

public sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public IReadOnlyList<ComponentPropertyDefinition> Properties { get; } =
    [
        new ComponentPropertyDefinition("start") { DefaultValue = 0 },
        new ComponentPropertyDefinition("step")
        {
            DefaultValue = 1,
            Validator = value => value is int step && step > 0,
        },
    ];

    public IReadOnlyList<ComponentEmitDefinition> Emits { get; } =
    [
        new ComponentEmitDefinition("change"),
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var count = Reactive.Reference(properties.Get<int>("start"));
        var step = properties.Get<int>("step");

        void Increment()
        {
            count.Value += step;
            context.Emit("change", count.Value);
        }

        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(("onClick", (Action)Increment)),
            count.Value.ToString(CultureInfo.InvariantCulture));
    }
}
```

`ComponentPropertyDefinition` carries `Name`, `KebabName`, `DefaultValue`, `DefaultFactory`,
`Required`, and `Validator`; `ComponentEmitDefinition` carries `Name` and a
`Func<object?[], bool>? Validator`. For a `.viu` single-file component the generator emits this same
metadata, so nothing is reflected in either authoring style. See
[Props & Fallthrough Attributes](../components/props.md).

### Nothing is discovered by assembly scanning

`IComponentDefinition`, `IDirective`, and `IPlugin<TNode>` are never swept for. Registration is
explicit and fluent, and every argument is an instance:

```csharp
using Assimalign.Viu.RuntimeDom;

// App, MyChild, FocusDirective, and AnalyticsPlugin are your own types — Viu ships none of them.
// App and MyChild implement IComponentDefinition, FocusDirective implements IDirective, and
// AnalyticsPlugin implements IPlugin<int>.

// BrowserRuntime.CreateApp throws InvalidOperationException until the viu-dom.js bridge module
// has finished loading, so the bootstrap is async.
await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new App())
    .Component("MyChild", new MyChild())
    .Directive("focus", new FocusDirective())
    .Use(new AnalyticsPlugin())
    .Mount("#app");
```

`Component`, `Directive`, `Provide`, and `Use` each return the same `BrowserApplication` so the chain
composes (`Mount` ends it, returning the root `ComponentInstance?`), and every argument is a
constructed object. `IDirective`'s seven hooks — `Created`, `BeforeMount`, `Mounted`, `BeforeUpdate`,
`Updated`, `BeforeUnmount`, `Unmounted` — are default-null interface members of type `DirectiveHook`,
and the renderer dispatches them through an internal enum switch (`DirectiveHookKind`) — never by
looking hooks up by name. A browser plugin implements `IPlugin<int>`, because DOM nodes cross the
interop boundary as `int` handles.

### `app.config.globalProperties` is excluded

Vue's [`globalProperties`](https://vuejs.org/api/application.html#app-config-globalproperties) works
by augmenting a component instance proxy, which does not exist here. The sanctioned replacement is
typed app-level provide plus inject:

```csharp
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new App())
    .Provide(Keys.Clock, new SystemClock())
    .Mount("#app");

public static class Keys
{
    // Reference identity, not name equality — declare these once, share the instance.
    // The "clock" string is a diagnostic label only; it takes no part in key identity.
    public static readonly InjectionKey<IClock> Clock = new("clock");
}
```

Inside any descendant's `Setup`, inject against the same key instance:

```csharp
using Assimalign.Viu.RuntimeCore;

// The Func<T> overload supplies the fallback, so this returns a non-nullable IClock. The
// no-fallback overload, Inject<T>(InjectionKey<T>), returns T?.
IClock clock = DependencyInjection.Inject(Keys.Clock, () => new SystemClock());
```

See [Provide / Inject](../components/provide-inject.md).

### Templates compile at build time, never at run time

Vue ships a build with a runtime compiler that calls `new Function` on a template string. WASM has no
`new Function` and AOT has no dynamic codegen, so Viu has exactly one path: `.viu` files and templates
are compiled to C# render methods by Roslyn source generators during the build. There is no runtime
`compile()`, no template-string component option, and no way to construct a component from markup at
run time.

The compiler itself never reaches the browser. Both generators and their parser closure are analyzer
references consumed at build time: the `Assimalign.Viu.App.Ref` targeting pack ships
`Assimalign.Viu.Reactivity.Generators` (the `[Reactive]` generator) and
`Assimalign.Viu.Syntax.Generators` (the `.viu` generator) under `analyzers/dotnet/cs/`, listed as
`<File Type="Analyzer">` entries in its `data/FrameworkList.xml`. The `Assimalign.Viu.Syntax.*`
parser libraries are deliberately *not* framework assemblies — they reach a consumer only inside that
analyzer folder. So a consumer gets both generators from a one-line SDK reference, with no compiler
in the shipped output. (The standalone `Assimalign.Viu.Reactivity` NuGet package also carries the
`[Reactive]` generator inside itself, for the non-SDK package path.) See
[The Viu SDK & Build](../scaling-up/sdk-and-build.md).

### Introspection is interface checks, not reflection

Vue's [`isRef`](https://vuejs.org/api/reactivity-utilities.html#isref)/`isReactive`/`isReadonly` read
proxy flags. Viu's are one-line type tests against dedicated marker interfaces, so they stay O(1) and
trim-safe (this is the actual body of the three `Reactive` members; `RawMarkers` is internal to
`Assimalign.Viu.Reactivity`):

```csharp
public static bool IsRef(object? value) => value is IReference;

public static bool IsReactive(object? value)
    => value is IReactiveTraversable traversable && !RawMarkers.IsMarked(traversable);

public static bool IsReadonly(object? value)
    => value is IReadonlyReactive readonlyReactive && readonlyReactive.IsReadonly;
```

The same interface-first design drives deep traversal. `ReactiveTraversal` descends only through
`IReference` cells and `IReactiveTraversable` values, because enumerating an arbitrary object's
members would require reflection. **Plain CLR objects are leaves** — a deep watch never sees a
mutation inside an un-annotated POCO. `Reactive.MarkRaw` likewise records identities in a
`ConditionalWeakTable` rather than tagging the object.

### Delegate shapes are fixed because nothing may call `DynamicInvoke`

Reflective invocation is forbidden, so every dispatcher accepts a small closed set of delegate shapes
and invokes them directly.

| Dispatcher | Accepted shapes | Failure mode for anything else |
| --- | --- | --- |
| DOM event handlers (`BrowserEventInvokerRegistry`) | `Action`, `Action<BrowserEvent>` | `NotSupportedException` caught inside the registry and routed to `ErrorSink` — a `Debug.WriteLine`, invisible in a Release WASM build |
| Component emit handlers (`ComponentInstance.EmitEvent`) | `Action`, `Action<object?>`, `Action<object?[]>` | Dev warning through `RuntimeWarnings.Warn`; the handler is **not invoked** |
| `TestEventDispatcher.Trigger` | `Action`, `Action<object?>` | `NotSupportedException` thrown at trigger time |

This is the single most common way an AOT-shaped API bites in practice, and the first two rows fail
silently: both the DOM `ErrorSink` and `RuntimeWarnings.Sink` default to `Debug.WriteLine`, which is
`[Conditional("DEBUG")]` and therefore compiled out of the shipped Release framework assemblies. Only
the test dispatcher fails loudly. Cast handlers explicitly at the point you build the prop bag:

```csharp
using System;

using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom; // BrowserEvent

// Increment is a void() method or local function; OnInput takes a single BrowserEvent.
VirtualNodeFactory.Properties(
    ("onClick", (Action)Increment),
    ("onInput", (Action<BrowserEvent>)OnInput));
```

See [Event Handling](../essentials/event-handling.md) and [Component Events](../components/events.md)
— note that the two lists differ, and confusing them is exactly the kind of mistake the silent
failure hides.

### Interop is source-generated, and it is trimming-sensitive

Every DOM operation crosses the boundary through a `[JSImport]` partial stub (there are ~39 of them
in `BrowserDomBridge`), and every live browser event returns through a single `[JSExport]` entry
point, `BrowserEventDispatch.DispatchBrowserEvent`. Both stub sets are filled in by the .NET
runtime's own `System.Runtime.InteropServices.JavaScript` source generator — not by Viu, and not by
reflection or by-name marshalling at run time.

One hazard is worth committing to memory. The JavaScript side resolves that export by the literal
member path `exports.Assimalign.Viu.RuntimeDom.BrowserEventDispatch.DispatchBrowserEvent`. Renaming
the assembly or namespace, or trimming `BrowserEventDispatch` away, breaks **all** event dispatch at
startup — with no compile-time error and no exception at the call site.

### Tests activate instances, not types

`Assimalign.Viu.Testing` sets `IsAotCompatible=true` and holds the same line the runtime does. You
mount an instance, stubs are plain component definitions rather than reflectively generated proxies,
and `FindComponent<TComponent>` matches with `candidate.Definition is TComponent`:

```csharp
using Assimalign.Viu.Testing;

using var wrapper = ViuTest.Mount(new Counter());

await wrapper.Get("button").Trigger("click");

wrapper.Text().ShouldBe("1");
wrapper.Emitted().ShouldContainKey("change");
```

`Mount` *is* generic — `ComponentWrapper Mount<TComponent>(TComponent component, ComponentMountOptions? options = null) where TComponent : IComponentDefinition`
— but the type parameter is inferred from the instance you pass, purely so `FindComponent<T>` stays
typed. There is no parameterless `Mount<TComponent>()` that news up a type for you. See
[Testing](../scaling-up/testing.md).

## Practical rules for application authors

- **Set `<IsAotCompatible>true</IsAotCompatible>` on your own libraries** — it turns on the .NET AOT
  and trim analyzers so a reflective call in your code is a build warning instead of a browser-only
  failure. It requires `net8.0` or later; on a `netstandard2.0` build-time helper library, leave it
  off.
- **Keep `[Reactive]` models as `partial` classes with `partial` properties** — both a getter and a
  non-`init` setter. Fields are ignored, and structs, records, and interfaces are not supported.
- **Prefer typed `InjectionKey<T>` over string keys** — the typed overloads keep the value's type in
  the signature, and key identity is reference identity, so two keys with the same `Name` are
  different keys. Declare them `static readonly`.
- **Keep reflection out of composables** — a composable is a plain static method returning refs and
  actions; if you need per-property access to a model, use its generated `ToReferences()` rather than
  a name lookup. See [Composables](../reusability/composables.md).
- **Cast every handler delegate to an accepted shape** at the point of use, per the table above.
- **Do not rename or trim away the interop surface** — `Assimalign.Viu.RuntimeDom` and its
  `BrowserEventDispatch` type must survive trimming intact.

## Why some hot paths are abstract classes, not interfaces

Reading the source you will notice the design preference: interfaces for public contracts and cold
paths only. On engine hot paths — per-trigger notification, patching, diffing — the framework
deliberately uses an abstract base class instead, because .NET interface dispatch is measurably
costlier than a vtable virtual call and the gap widens on mono-wasm and NativeAOT. Shared per-instance
state lives on the base as *fields* (direct loads, no property-getter dispatch) and concrete leaf
types are `sealed` so the JIT and AOT compiler can devirtualize.

`Assimalign.Viu.Reactivity`'s `Subscriber` is the reference example: a `public abstract class` with
internal members and a `private protected` constructor, so it is public enough for
`ReactiveEffect` and `Computed<T>` to derive from and opaque enough that nothing outside the assembly
can subclass it. This is a performance decision that AOT sharpens, not a separate constraint — see
[Performance](./performance.md).

## Not yet implemented

- **WASM size and AOT budget gates** — planned as V01.01.12.06 but not built. No MSBuild target,
  workflow, or props file enforces a size or startup budget anywhere in the repository.
- **No published size or startup numbers** — because nothing measures them yet, this page quotes none,
  and any figure you see elsewhere should be treated as unverified.
- **No trimming or AOT publish configuration is applied for you** — the Viu SDK registers the shared
  framework as trimmable and stops there. Turning on publish trimming or AOT compilation for your app
  remains a .NET SDK concern, and no Viu gate currently verifies the result.
- **The build-time compiler libraries are exempt, not compliant** — the `netstandard2.0` parser and
  generator projects cannot host the AOT analyzers and are excluded centrally. They run inside the
  compiler and never ship into an application, so this does not weaken the runtime guarantee.
- **Nothing on this page implies a Router, Store, SSR/hydration, or DevTools story** — those four
  areas do not exist on disk at all, and `Teleport`, `KeepAlive`, and `Suspense` exist only as
  `RenderHelpers` markers that throw `NotSupportedException`. There is consequently no AOT surface
  for any of them to have or to lack. See [Project status](../../roadmap/status.md).

## See also

- [Project status](../../roadmap/status.md) — area-by-area implementation state.
- [Differences from Vue 3](../../roadmap/vue-differences.md) — the naming map and behavioral divergences.
- [MSBuild Reference](../../api/msbuild-reference.md) — every Viu MSBuild property and item.
- [Introduction](../introduction.md) — the five founding divergences this constraint produced.
