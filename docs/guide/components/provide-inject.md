# Provide / Inject

Passing values down an arbitrarily deep component tree without threading them through every
intermediate component's props.

> **Status:** Implemented.

Viu ports Vue's [provide / inject](https://vuejs.org/guide/components/provide-inject.html) as the
static class `DependencyInjection` in `Assimalign.Viu.RuntimeCore`, paired with the typed key type
`InjectionKey<T>`. An ancestor calls `DependencyInjection.Provide`; any descendant, at any depth,
calls `DependencyInjection.Inject` and gets the value. A nearer provider shadows a farther one.

This is also the API that fills the hole left by `app.config.globalProperties`, which Viu
deliberately does not have — see [Replacing globalProperties](#replacing-globalproperties) below.

## The shape of the API

Both halves live on one static class and both bind to `ComponentInstance.Current`, which means
**both must be called synchronously inside `Setup`**. Called with no current instance, `Provide`
warns and writes nothing; `Inject` warns and returns whatever fallback the chosen overload supplies
(`default`/`null` when there is none).

```csharp
namespace Assimalign.Viu.RuntimeCore;

public static class DependencyInjection
{
    public static void Provide<T>(InjectionKey<T> key, T value);
    public static void Provide(string key, object? value);

    public static T? Inject<T>(InjectionKey<T> key);
    public static T Inject<T>(InjectionKey<T> key, T defaultValue);
    public static T Inject<T>(InjectionKey<T> key, Func<T> defaultFactory);

    public static object? Inject(string key);
    public static object? Inject(string key, object? defaultValue, bool treatDefaultAsFactory = false);
}
```

The upstream counterparts are `provide()` and `inject()` from
`packages/runtime-core/src/apiInject.ts`. The overload set replaces upstream's optional-argument
signature: choosing the `Func<T>` overload is the idiomatic C# spelling of Vue's
`treatDefaultAsFactory: true`.

## Injection keys

`InjectionKey<T>` stands in for the ES `Symbol` upstream uses. It carries a phantom type argument so
that `Provide` and `Inject` round-trip strongly typed with no cast at the call site.

```csharp
using System;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

public static class AppKeys
{
    public static readonly InjectionKey<Uri> ApiBaseUrl = new("api-base-url");
    public static readonly InjectionKey<Reference<string>> Theme = new("theme");
}
```

Three rules govern keys, and the first one is the trap:

- **Identity is reference identity** — `InjectionKey<T>` is deliberately a `class`, not a `record`.
  A record's value equality would make every same-typed key collide, which would break the `Symbol`
  contract it is standing in for.
- **`Name` is diagnostic only** — it appears in warnings and `ToString()`, and does **not**
  participate in identity. Two keys constructed with the same `Name` are two *different* keys and
  will never resolve each other's values.
- **Declare keys `static readonly`** — the provider and the injector must hold the *same instance*.
  A key created inside `Setup` is a fresh identity per component instance and nothing will ever
  find it.

`InjectionKey<T>` is trimming-safe: `T` is phantom and is never activated reflectively.

### String keys

The `string` overloads exist for parity and for interop with loosely-typed code. They match by
value, so they collide easily and return `object?`. Prefer `InjectionKey<T>` everywhere you can.

## Providing a value

`Provide` is called during `Setup`, before the returned render closure ever runs. Providing the same
key twice from one instance overwrites the earlier value.

```csharp
using System;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

public sealed class ThemeProvider : IComponentDefinition
{
    public string? Name => "ThemeProvider";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var theme = Reactive.Reference("light");
        DependencyInjection.Provide(AppKeys.Theme, theme);

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", $"app app--{theme.Value}")),
            VirtualNodeFactory.RenderSlot(context.Slots, "default"));
    }
}
```

## Injecting a value

```csharp
using System;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

public sealed class ThemeToggle : IComponentDefinition
{
    public string? Name => "ThemeToggle";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        // The factory overload: no warning on a miss, and the fallback is built only if needed.
        var theme = DependencyInjection.Inject(AppKeys.Theme, () => Reactive.Reference("light"));

        void Toggle() => theme.Value = theme.Value == "light" ? "dark" : "light";

        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(("onClick", (Action)Toggle)),
            $"Theme: {theme.Value}");
    }
}
```

Because the injected value here is a `Reference<string>`, the render closure's read of `theme.Value`
is tracked exactly like any other ref read — the toggle re-renders both itself and the provider.
See [Reactivity Fundamentals](../essentials/reactivity-fundamentals.md).

### Choosing an `Inject` overload

| Overload | Returns on a hit | Returns on a miss | Warns on a miss |
| --- | --- | --- | --- |
| `Inject<T>(InjectionKey<T>)` | the value | `default(T)` | yes — `injection "{key}" not found.` |
| `Inject<T>(InjectionKey<T>, T)` | the value | `defaultValue` | no |
| `Inject<T>(InjectionKey<T>, Func<T>)` | the value | `defaultFactory()` | no |
| `Inject(string)` | the value as `object?` | `null` | yes |
| `Inject(string, object?, bool)` | the value as `object?` | the resolved default | no |

Two details worth committing to memory:

- **Supplying any default suppresses the miss warning** — that is the only way to make an optional
  injection quiet. It is deliberate: a bare `Inject<T>(key)` declares the dependency mandatory.
- **`treatDefaultAsFactory` only fires for a `Func<object?>`** — the string overload invokes
  `defaultValue` only when the flag is true *and* the value is specifically a `Func<object?>`.
  Any other delegate type is returned as-is, unconverted.

## A worked example: depth and shadowing

Provide and inject are indifferent to how many components sit between them, and the nearest
provider on the ancestor chain wins. The excerpt below is lifted verbatim from
`Assimalign.Viu.RuntimeCore/test/DependencyInjectionTests.cs`, so `TestComponent` (an `internal`
test-support definition with a settable `SetupFunction`), `_renderer`, and Shouldly's `ShouldBe` are
test-project fixtures, not shipping API — the provide/inject calls are the part to read.

```csharp
var key = new InjectionKey<string>("message");
string? injected = null;

var grandchild = new TestComponent
{
    SetupFunction = (_, _) =>
    {
        injected = DependencyInjection.Inject(key);
        return static () => VirtualNodeFactory.Text("leaf");
    },
};
var child = new TestComponent
{
    SetupFunction = (_, _) => () => VirtualNodeFactory.Component(grandchild),
};
var parent = new TestComponent
{
    SetupFunction = (_, _) =>
    {
        DependencyInjection.Provide(key, "hello");
        return () => VirtualNodeFactory.Component(child);
    },
};

_renderer.Render(VirtualNodeFactory.Component(parent), _container);

injected.ShouldBe("hello");
```

`child` never mentions the key. It does not have to.

## Providing a reactive bundle

The most useful thing to provide is rarely a bare value — it is a small record holding refs plus the
functions permitted to mutate them. Descendants read reactively; only the provider owns the writes.

```csharp
using System;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

public sealed record UserSession(
    Reference<string> DisplayName,
    Computed<bool> IsSignedIn,
    Action SignOut);

public static class SessionKeys
{
    public static readonly InjectionKey<UserSession> Session = new("user-session");
}

public sealed class SessionProvider : IComponentDefinition
{
    public string? Name => "SessionProvider";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var displayName = Reactive.Reference(string.Empty);
        var isSignedIn = Reactive.Computed(() => displayName.Value.Length > 0);

        DependencyInjection.Provide(
            SessionKeys.Session,
            new UserSession(displayName, isSignedIn, () => displayName.Value = string.Empty));

        return () => VirtualNodeFactory.RenderSlot(context.Slots, "default");
    }
}
```

A consumer injects the record once and reads through it for the life of the component:

```csharp
using System;
using Assimalign.Viu.RuntimeCore;

public sealed class AccountBadge : IComponentDefinition
{
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var session = DependencyInjection.Inject(SessionKeys.Session);

        return () => session is null || !session.IsSignedIn.Value
            ? VirtualNodeFactory.Element("span", "Signed out")
            : VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", (Action)session.SignOut)),
                $"Sign out {session.DisplayName.Value}");
    }
}
```

Note the null check: `Inject<T>(InjectionKey<T>)` returns `T?`, so a mandatory-but-missing injection
shows up as `null` at the use site rather than as an exception.

## App-level provide

`Application<TNode>.Provide` — and its browser wrapper `BrowserApplication.Provide` — registers a
value on the application context. It is the **final fallback** in the lookup chain: an inject that
misses every component ancestor resolves against the app. This is the port of
[`app.provide`](https://vuejs.org/api/application.html#app-provide).

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new App())
    .Provide(AppKeys.ApiBaseUrl, new Uri("https://api.example.com/"))
    .Provide(AppKeys.Theme, Reactive.Reference("light"))
    .Provide("locale", "en-US")
    .Component("ThemeToggle", new ThemeToggle())
    .Mount("#app");

await Task.Delay(Timeout.Infinite);
```

Every registration member returns the application, so they chain. Two dev warnings guard misuse:

- **Duplicate key** — `App already provides property with key "{key}". It will be overwritten with
  the new value.`
- **After mount** — `Provide() cannot be called on an already mounted app — the registration will
  not affect the rendered tree. Configure the app before Mount().` The value is still written, but
  the mounted tree will not see it.

`Application<TNode>` exposes only `Component`, `Directive`, `Provide`, `Use`, `Mount`, `Unmount`,
`Config`, `IsMounted`, and `RootInstance`. There is no `app.mixin`, `app.version`, or
`app.runWithContext`. See the [Application API](../../api/application.md).

### Providing from a plugin

`IPlugin<TNode>.Install(Application<TNode>, object?)` is handed the `Application<TNode>` itself, so a
plugin's natural job is to register components and app-level provides in one call. On the browser
`TNode` is `int` — DOM nodes cross the interop boundary as integer handles — and note the seam:
`BrowserApplication.Use(IPlugin<int>, object?)` forwards to the `Application<int>` it wraps, so
`Install` receives that inner application, never the `BrowserApplication` wrapper.

`ITelemetry` and `ConsoleTelemetry` below are your own types; everything else is real API.

```csharp
using Assimalign.Viu.RuntimeCore;

public sealed class TelemetryPlugin : IPlugin<int>
{
    public static readonly InjectionKey<ITelemetry> Key = new("telemetry");

    public void Install(Application<int> application, object? options)
    {
        application.Provide(Key, new ConsoleTelemetry());
    }
}

// Installed exactly once; a repeat Use of the same instance is skipped with the dev warning
// `Plugin has already been applied to target app.`
app.Use(new TelemetryPlugin());
```

## Behavior you need to know

### Inject reads the *parent's* table, never its own

A component that both provides and injects the same key sees the **ancestor's** value, not the one
it just provided for its descendants. This is upstream parity, and it is what makes a "decorating
provider" work:

```csharp
public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
{
    // Reads the ANCESTOR's value — not the one provided two lines down.
    var inherited = DependencyInjection.Inject(AppKeys.ApiBaseUrl, new Uri("https://localhost/"));

    DependencyInjection.Provide(AppKeys.ApiBaseUrl, new Uri(inherited, "v2/"));

    return () => VirtualNodeFactory.RenderSlot(context.Slots, "default");
}
```

### Provides use copy-on-first-provide, not a prototype chain

Upstream gives each instance a provides object whose prototype is the parent's, so `inject` walks a
chain. C# has no prototype chain, so Viu uses **copy-on-first-provide**: an instance shares its
parent's provides table *by reference* until it provides a value of its own, at which point it forks
a flat dictionary seeded with a copy of the parent's entries.

| Operation | Cost | Why |
| --- | --- | --- |
| `Inject` (component-provider hit) | O(1), no allocation | one flat dictionary probe, no chain walk |
| `Inject` (app-level hit, or miss) | O(1) | the parent table misses, then the app-context table is probed |
| `Provide` (first on an instance) | O(n) in ancestor provide-count | forks and copies the inherited table |
| `Provide` (subsequent) | O(1) | the table is already forked |

The bias is deliberate — injects vastly outnumber provides and run on the render hot path. The flat
copy is correct only because `Setup` runs parent-before-child, so an ancestor's table is always
complete before a descendant copies it.

One consequence worth stating plainly: because the fork is a **snapshot**, a provide added by an
ancestor *after* a descendant has already forked its own table will not appear in that descendant's
view. In practice this never bites, because all provides happen during `Setup` and setups run in
tree order — but do not try to add provides late and expect them to propagate.

### Warnings

| Situation | Warning text |
| --- | --- |
| `Provide` outside `Setup` | `provide() can only be used inside Setup().` |
| `Inject` outside `Setup` | `inject() can only be used inside Setup().` |
| `Inject` miss with no default | `injection "{key}" not found.` |

Warnings route through the runtime warning sink. When `Config.WarnHandler` is set *before* `Mount`,
`Application<TNode>.Mount` redirects the sink to it for the mounted lifetime and `Unmount` restores
the previous one; with no handler set they go to `Debug.WriteLine` prefixed `[Vue warn]`. Set a
handler if you want them anywhere else.

## Replacing globalProperties

Vue's [`app.config.globalProperties`](https://vuejs.org/api/application.html#app-config-globalproperties)
works by installing values on the component instance proxy so templates can reach them as `$foo`.
Viu has no instance proxy — C# has no `Proxy`, and synthesizing one would require the reflection and
dynamic dispatch the AOT/trimming contract forbids. `ApplicationConfiguration` therefore exposes
only `ErrorHandler`, `WarnHandler`, and `Performance`; there is no `GlobalProperties` member and
there will not be one.

**Typed app-level provide plus inject is the sanctioned replacement.** It is strictly better on
every axis that matters here: it is statically typed, it is trimming-safe, the dependency is visible
at the point of use rather than ambient, and it is testable by swapping one provide.

`ApiClient` and `AppKeys.Api` below stand in for your own types — add
`public static readonly InjectionKey<ApiClient> Api = new("api");` to the `AppKeys` class shown
earlier.

```csharp
// Vue:  app.config.globalProperties.$api = new ApiClient(baseUrl)
//       // then, in any template: {{ $api.Name }}
//
// Viu:
app.Provide(AppKeys.Api, new ApiClient(baseUrl));

// ...and in any descendant's Setup:
var api = DependencyInjection.Inject(AppKeys.Api, () => ApiClient.Offline);
```

If you find yourself injecting the same bundle in many components, wrap the inject in a composable —
`UseSession()`, `UseApi()` — so the key and the fallback live in one place. See
[Composables](../reusability/composables.md).

## Testing components that inject

`Assimalign.Viu.Testing` seeds app-level provides through `ComponentMountOptions`, which is the port
of `@vue/test-utils`'s `global.provide`. `Provides` is a get-only dictionary keyed by the same
`InjectionKey<T>`/string identities `Inject` uses, and the fluent `Provide` overloads populate it.

```csharp
using System;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.Testing;
using Shouldly;
using Xunit;

[Fact]
public void Provides_FromGlobalConfig_AreInjectableByTheComponent()
{
    var options = new ComponentMountOptions().Provide("theme", "dark");
    using var wrapper = ViuTest.Mount(new InjectingComponent(), options);

    wrapper.Text().ShouldBe("dark");
}

// Both members below live on the same test class — `private` is legal only nested.
// Injects an app-level provide and renders it.
private sealed class InjectingComponent : IComponentDefinition
{
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var theme = DependencyInjection.Inject("theme") as string ?? "default";
        return () => VirtualNodeFactory.Element("div", theme);
    }
}
```

More in [Testing](../scaling-up/testing.md).

## In a `.viu` component

The intended authoring shape puts the same calls in an `@script` block:

```viu
@template {
    <button @click="Toggle()">Theme: {{ Theme.Value }}</button>
}

@script {
using System;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

  public Reference<string> Theme { get; } =
      DependencyInjection.Inject(AppKeys.Theme, () => Reactive.Reference("light"));

  public void Toggle() => Theme.Value = Theme.Value == "light" ? "dark" : "light";
}
```

> **Aspirational.** This is the target developer experience, not today's behavior, and the inject
> line above would not work if you wrote it now. The `.viu` generator emits only `Render`,
> `RenderCacheSize`, `ScopeId`, `ExtractedStyles`, `ApplyCssVariables`, and CSS-module accessors into
> the partial class alongside the merged `@script` members (with the block's leading `using`
> directives hoisted above the namespace). It does **not** emit the `IComponentDefinition`
> implementation that would bind `Render` to a `Setup` closure — and a property initializer runs at
> construction, not inside a `Setup` window, so `ComponentInstance.Current` is null there and the
> call would warn `inject() can only be used inside Setup().` and return the fallback. What the
> finished seam has to supply is a real `Setup` window for these members. Hand-written
> `IComponentDefinition` components — every other example on this page — work today. See
> [Single-File Components](../scaling-up/single-file-components.md) and
> [Project Status](../../roadmap/status.md).

## Not yet implemented

- **No `app.runWithContext`** — there is no way to call `Inject` outside a component `Setup` and
  still resolve app-level provides.
- **No injection-key debugging surface** — nothing enumerates an instance's resolved provides;
  `ComponentInstance.Provides` is internal.
- **No override mechanism other than shadowing** — a descendant changes what its subtree sees only
  by providing the key again; there is no way to remove or reset an inherited provide.
- **No readonly *wrapper function* for a provided ref** — Vue's `readonly(someRef)` takes an existing
  ref and returns a read-only view of it. That form needs a `Proxy` and has no AOT-safe equivalent,
  so a provided `Reference<T>` is writable by anyone who injects it. Viu's read-only shapes are
  declared, not wrapped: a getter-only `Computed<T>` (no setter) and a source-generated
  `[Reactive(Readonly = true)]`/`[ShallowReactive(Readonly = true)]` object, both of which report
  through `Reactive.IsReadonly`. So provide a getter-only `Computed<T>` projection, or a record
  exposing the ref plus explicit mutator delegates as shown above, when you want writes controlled.

## See also

- [Components](../essentials/components.md) — the `Setup` contract every call on this page depends on
- [Props & Fallthrough Attributes](props.md) — the other, explicit way to pass data down one level
- [Composables](../reusability/composables.md) — where an inject usually belongs
- [Application API](../../api/application.md) — `Provide`, `Use`, `Component`, `Directive`, `Config`
- [Differences from Vue 3](../../roadmap/vue-differences.md) — the full naming and behavior map
