# Stopwatch

The stopwatch is the one example application that ships in the Viu repository, and it is the reference
for the hand-written render-function authoring style.

> **Status:** Implemented. This example builds and runs today.

The example lives at `examples/Assimalign.Viu.WebApp` in
[github.com/assimalign/viu](https://github.com/assimalign/viu). It is a stopwatch: a root component
that owns a `System.Diagnostics.Stopwatch` and a ticking timer, and a child component that receives
the formatted elapsed time as a prop and emits a `reset` event back to its parent. Between them they
exercise `Setup`, refs, lifecycle hooks, declared props with defaults, declared emits, and DOM event
handlers — the whole component contract in about a hundred lines.

Run it with:

```sh
dotnet run --project examples/Assimalign.Viu.WebApp
```

## What this example is, and what it is not

Three things are worth stating before you read the code, because the project's own planning documents
will otherwise mislead you.

- **It is the only shipping example** — `docs/PLAN.md` names a TodoMVC application as the exit demo for
  both the render-function wave and the single-file-component wave. TodoMVC does not exist in any form,
  and neither does the HackerNews-style sample or the example gallery those documents mention. See
  [Examples](./index.md) and [Project status](../roadmap/status.md).
- **It does not compile a `.viu` file** — the entire component tree is built from hand-written
  `VirtualNodeFactory` calls. No shipping example anywhere in the repository compiles a single-file
  component. That makes this example the best available reference for the render-function style, and it
  makes the `.viu` projection later on this page a projection rather than a transcript.
- **Its project file is not a template** — `Assimalign.Viu.WebApp.csproj` uses
  `Microsoft.NET.Sdk.WebAssembly` plus `<ViuProjectReference>`, which are in-repo dogfooding
  mechanisms. A real consumer project uses `<Project Sdk="Assimalign.Viu.Sdk">`. See
  [Do not copy this project file](#do-not-copy-this-project-file) at the end of this page.

## The bootstrap

`Program.cs` is the whole browser bootstrap. It is a top-level-statements file, so the `using`
directives are the file's first lines. The demo path is three calls (the file also carries the
`?diagnostics=1` branch shown under [Diagnostics mode](#diagnostics-mode), elided here):

```csharp
using System;
using System.Runtime.InteropServices.JavaScript;
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

// ... the ?diagnostics=1 branch goes here ...

BrowserRuntime.CreateApp(new StopwatchApplication()).Mount("#app");

// Keep the WASM main loop alive; rendering is reactive from here.
await Task.Delay(Timeout.Infinite);
```

Three calls, in this order:

- **`BrowserRuntime.InitializeAsync()`** — loads the `viu-dom.js` bridge module that ships inside the
  `Assimalign.Viu.RuntimeDom` package and wires up event dispatch. It is idempotent: later calls await
  the same initialization task. Every other `BrowserRuntime` member throws `InvalidOperationException`
  until it has completed.
- **`BrowserRuntime.CreateApp(rootComponent)`** — the counterpart to Vue's
  [`createApp()`](https://vuejs.org/api/application.html#createapp). It returns a `BrowserApplication`,
  which also carries the fluent `Component`, `Directive`, `Provide`, and `Use` registration methods.
- **`Mount("#app")`** — resolves the selector through `BrowserRuntime.QuerySelector`, clears the
  container's existing markup, and mounts. A selector that matches nothing throws `BrowserDomException`
  naming the selector.

The final `await Task.Delay(Timeout.Infinite)` is not idle padding. `Main` returning would tear down
the WASM main loop, and everything after mount is driven reactively by the renderer and by the
component's own timer, so the entry point simply has to stay alive.

## The root component

`StopwatchApplication` implements `IComponentDefinition`. The shape to internalise is that **`Setup`
runs exactly once per instance and returns the render function** — it does not render. State lives in
locals that the returned closure captures. There is no `this` proxy, no `Render` member on the
interface, and no Options API anywhere in Viu.

```csharp
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

internal sealed class StopwatchApplication : IComponentDefinition
{
    public string? Name => "StopwatchApplication";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var stopwatch = new Stopwatch();
        var isRunning = Reactive.Reference(false);
        var elapsedText = Reactive.Reference("00:00:00");
        var display = new ElapsedDisplay();
        CancellationTokenSource? ticking = null;

        void Toggle()
        {
            if (stopwatch.IsRunning)
            {
                stopwatch.Stop();
            }
            else
            {
                stopwatch.Start();
            }
            isRunning.Value = stopwatch.IsRunning;
        }

        void Reset()
        {
            if (stopwatch.IsRunning)
            {
                stopwatch.Restart();
            }
            else
            {
                stopwatch.Reset();
            }
            elapsedText.Value = stopwatch.Elapsed.ToString(@"hh\:mm\:ss");
        }

        Lifecycle.OnMounted(() =>
        {
            ticking = new CancellationTokenSource();
            _ = TickAsync(ticking.Token);
        });
        Lifecycle.OnUnmounted(() =>
        {
            ticking?.Cancel();
            ticking = null;
        });

        async Task TickAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(100, CancellationToken.None);
                if (stopwatch.IsRunning)
                {
                    // Equal-value writes do not notify: ten ticks a second coalesce to one
                    // re-render per displayed second.
                    elapsedText.Value = stopwatch.Elapsed.ToString(@"hh\:mm\:ss");
                }
            }
        }

        return () => VirtualNodeFactory.Element(
            "section",
            VirtualNodeFactory.Properties(("class", "shell")),
            VirtualNodeFactory.Element(
                "article",
                VirtualNodeFactory.Properties(("class", "card")),
                VirtualNodeFactory.Element(
                    "span",
                    VirtualNodeFactory.Properties(("class", "eyebrow")),
                    VirtualNodeFactory.Text("Viu Components")),
                VirtualNodeFactory.Element("h1", VirtualNodeFactory.Text("Stopwatch rendered from C#")),
                VirtualNodeFactory.Element(
                    "p",
                    VirtualNodeFactory.Properties(("class", "lead")),
                    VirtualNodeFactory.Text(
                        "A component tree: the display below is a child component fed by props, "
                        + "emitting reset back to its parent.")),
                VirtualNodeFactory.Component(display, VirtualNodeFactory.Properties(
                    ("text", elapsedText.Value),
                    ("running", isRunning.Value),
                    ("onReset", (Action)Reset))),
                VirtualNodeFactory.Element(
                    "div",
                    VirtualNodeFactory.Properties(("class", "actions")),
                    VirtualNodeFactory.Element(
                        "button",
                        VirtualNodeFactory.Properties(
                            ("class", "primary"),
                            ("onClick", (Action)Toggle),
                            ("type", "button")),
                        VirtualNodeFactory.Text(isRunning.Value ? "Pause" : "Start")))));
    }
}
```

### Why the closure is the component

Vue's `setup()` returns a state object that the framework wraps in a `this` proxy the template reads
through. C# has no `Proxy`, so Viu takes the other branch of the same idea: `Setup` returns the render
function directly, and the closure it captures *is* the state object. `stopwatch`, `isRunning`,
`elapsedText`, `ticking`, `Toggle`, and `Reset` are ordinary C# locals and local functions. Nothing is
reflected over, nothing is looked up by string, and the whole thing survives trimming and AOT.

The render closure re-executes on every update, so every reactive read inside it — `elapsedText.Value`
and `isRunning.Value` — is tracked. Writing either one from `Toggle`, `Reset`, or the timer marks the
render effect dirty and schedules a re-render.

### Ten ticks a second, one re-render

`TickAsync` polls at 100 ms but the display only has one-second resolution. The comment in the source
is the whole trick:

```csharp
elapsedText.Value = stopwatch.Elapsed.ToString(@"hh\:mm\:ss");
```

`Reference<T>`'s setter compares the incoming value with `EqualityComparer<T>.Default` and **triggers
only when they differ**. Nine writes out of ten produce the same `"00:00:07"` string and notify
nothing. This is the C# spelling of Vue's `ref()` change check — with the difference that Viu uses
`EqualityComparer<T>.Default` rather than `Object.is`. The two agree on `NaN` (self-equal in both) and
diverge on signed zero: `+0.0` and `-0.0` compare *equal* under `EqualityComparer<double>.Default`, so a
ref moving between them does not trigger. See
[Computed Properties](../guide/essentials/computed.md).

The example deliberately keeps the derivation in a plain ref because the source of truth
(`stopwatch.Elapsed`) is a non-reactive clock read that nothing can track. When the source *is*
reactive, `Reactive.Computed<T>` is the right tool — see
[Computed Properties](../guide/essentials/computed.md).

### The timer is owned by the lifecycle

`Lifecycle.OnMounted` and `Lifecycle.OnUnmounted` must be called synchronously inside `Setup`; they
read the ambient `ComponentInstance.Current` to find the instance to attach to. Starting the timer in
`OnMounted` and cancelling it in `OnUnmounted` is what makes `BrowserApplication.Unmount()` a genuinely
clean teardown — no orphaned `Task` keeps writing to a ref whose renderer is gone. The example's
diagnostics mode relies on exactly this, running 25 mount/unmount cycles and asserting the interop
registries return to baseline. See
[Lifecycle Hooks & Template Refs](../guide/essentials/lifecycle-and-template-refs.md).

## The child component

`ElapsedDisplay` lives in the same `StopwatchApplication.cs` file, under the same `using` directives
shown above. It is where declared props and declared emits appear.

```csharp
internal sealed class ElapsedDisplay : IComponentDefinition
{
    public string? Name => "ElapsedDisplay";

    public IReadOnlyList<ComponentPropertyDefinition>? Properties { get; } =
    [
        new ComponentPropertyDefinition("text") { DefaultValue = "00:00:00" },
        new ComponentPropertyDefinition("running") { DefaultValue = false },
    ];

    public IReadOnlyList<ComponentEmitDefinition>? Emits { get; } =
    [
        new ComponentEmitDefinition("reset"),
    ];

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
        => () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", "meter")),
            VirtualNodeFactory.Element(
                "span",
                VirtualNodeFactory.Properties(("class", "meter-label")),
                VirtualNodeFactory.Text("Elapsed")),
            VirtualNodeFactory.Element(
                "strong",
                VirtualNodeFactory.Properties(("class", "meter-value")),
                VirtualNodeFactory.Text(properties.Get<string>("text") ?? "00:00:00")),
            VirtualNodeFactory.Element(
                "span",
                VirtualNodeFactory.Properties(("class", "status-pill")),
                VirtualNodeFactory.Text(properties.Get<bool>("running") ? "Running" : "Paused")),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(
                    ("class", "secondary"),
                    ("type", "button"),
                    ("onClick", (Action)(() => context.Emit("reset")))),
                VirtualNodeFactory.Text("Reset")));
}
```

Points worth pulling out:

- **Props are declared metadata, not discovered attributes** — `Properties` returns an
  `IReadOnlyList<ComponentPropertyDefinition>` precomputed on the definition. Reflection is forbidden
  under AOT, so the list is the only source of truth for defaults, `Required`, and `Validator`. It is
  the counterpart to Vue's [`props` option](https://vuejs.org/guide/components/props.html).
- **`Get<T>` never throws on a type mismatch** — `properties.Get<string>("text")` returns `default`
  both when the prop is absent and when it holds a value of a different type, which is why the example
  still writes `?? "00:00:00"` even though the definition declares a `DefaultValue`. See
  [Props & Fallthrough Attributes](../guide/components/props.md).
- **An emitted `"reset"` is handled by an `onReset` prop** — the parent passes
  `("onReset", (Action)Reset)`, matching Vue's `emit('reset')` / `@reset` pairing. The mapping is
  upstream's `toHandlerKey` — `on` plus the event name with its first character upper-cased, so
  `"reset"` becomes `"onReset"` and `"update:modelValue"` becomes `"onUpdate:modelValue"`. A kebab-case
  emit falls back to a camelized lookup, so `"my-event"` also finds `onMyEvent`. See
  [Component Events](../guide/components/events.md).
- **Setup can be an expression body** — `ElapsedDisplay` holds no state, so its `Setup` is a single
  arrow returning the render closure. The closure reads `properties`, which the runtime updates in
  place, so each re-render sees current values.

### Delegates need an explicit cast

Every handler in this example is written `(Action)Toggle`, `(Action)Reset`,
`(Action)(() => context.Emit("reset"))`. This is not stylistic. `VirtualNodeFactory.Properties` takes
`(string Name, object? Value)` tuples, and C# will not implicitly convert a method group or a lambda to
`object?` — there is no target delegate type to infer. Without the cast the code does not compile,
which is the friendly failure mode.

The *unfriendly* failure mode is casting to the wrong delegate type, because the shapes differ by
channel and the mismatch is caught at runtime, not compile time:

| Handler kind | Accepted delegate shapes | Failure mode on a mismatch |
| --- | --- | --- |
| Native DOM listener (`onClick`, `onInput`, …) | `Action`, `Action<BrowserEvent>` | Throws inside the invoker registry's `try`/`catch`, routed to a `Debug.WriteLine` error sink — invisible in a Release WASM build |
| Component emit handler (`onReset`, `onUpdate:modelValue`, …) | `Action`, `Action<object?>`, `Action<object?[]>` | Dev warning, and the handler is simply not invoked |

Both channels accept a bare `Action`, which is why the stopwatch never trips either trap. Read
[Event Handling](../guide/essentials/event-handling.md) before you reach for a handler that needs
arguments.

## The wwwroot files

The example's `wwwroot` is deliberately thin, because the DOM bridge ships in the runtime package
rather than in the app.

`wwwroot/index.html` — the placeholders the WebAssembly SDK rewrites at build time, plus the mount
container:

```html
<link rel="preload" id="webassembly" />
<script type="importmap"></script>
<script type="module" src="main#[.{fingerprint}].js"></script>
<style>
  /* ~180 lines of global CSS: .shell, .card, .meter, .meter-value, .primary, ... */
</style>
...
<main id="app"></main>
```

That `<style>` block is the whole reason the `.viu` projection below is interesting: today every class
the components reference is a global rule in this file.

`wwwroot/main.js` — the entire JavaScript the app author writes:

```js
// App bootstrap only: the DOM bridge now ships with the Assimalign.Viu.RuntimeDom package
// (loaded by BrowserRuntime.InitializeAsync as /_content/Assimalign.Viu.RuntimeDom/viu-dom.js).
import { dotnet } from './_framework/dotnet.js'

const { runMain } = await dotnet.create()

await runMain()
```

Note what is absent: no framework bundle, no import map entries, no hand-written interop. Only three
files are tracked in git — `index.html`, `main.js`, and `benchmark.js` (which exists only for the
diagnostics mode described below).

A fourth appears after a build: `wwwroot/_content/Assimalign.Viu.RuntimeDom/viu-dom.js`. That is a
build artifact, not source — the repository's `.gitignore` excludes `examples/**/wwwroot/_content/`,
and the in-repo build copies the bridge there because the WASM dev host serves only the app's source
`wwwroot`. A consumer project using `Assimalign.Viu.Sdk` gets the identical copy from the SDK's
`ViuFlowFrameworkWebAssets` target and should ignore it the same way — see
[Quick Start](../guide/quick-start.md).

## The same component as a `.viu` single-file component

> **Status:** Not yet implemented as a runnable path. The template compiler, the `.viu` block parser,
> and the source generator all exist and are exercised by their own test suites, but no shipping
> example compiles a `.viu` file, and the generated partial class does not yet implement
> `IComponentDefinition` or supply a `Setup` — the generator emits the compiled `Render` method, the
> merged `@script` body, and the compiled `@style` constants, and stops there. Treat the code below as
> the target authoring experience, not as something you can drop into the example project today.

This is the single most useful before-and-after in these docs: the same component, expressed the way
the single-file-component pipeline is designed to accept. The file name is load-bearing — the
generator derives the partial class name from it — so this is `StopwatchApplication.viu`.

```viu
@template {
    <section class="shell">
        <article class="card">
            <span class="eyebrow">Viu Components</span>
            <h1>Stopwatch rendered from C#</h1>
            <p class="lead">
                A component tree: the display below is a child component fed by props,
                emitting reset back to its parent.
            </p>
            <ElapsedDisplay :text="ElapsedText" :running="IsRunning" @reset="Reset" />
            <div class="actions">
                <button class="primary" type="button" @click="Toggle">
                    {{ IsRunning ? "Pause" : "Start" }}
                </button>
            </div>
        </article>
    </section>
}

@script {
using System.Diagnostics;

using Assimalign.Viu.Reactivity;

    private readonly Stopwatch _stopwatch = new();

    public readonly Reference<bool> IsRunning = Reactive.Reference(false);
    public readonly Reference<string> ElapsedText = Reactive.Reference("00:00:00");

    public void Toggle()
    {
        if (_stopwatch.IsRunning)
        {
            _stopwatch.Stop();
        }
        else
        {
            _stopwatch.Start();
        }
        IsRunning.Value = _stopwatch.IsRunning;
    }

    public void Reset()
    {
        if (_stopwatch.IsRunning)
        {
            _stopwatch.Restart();
        }
        else
        {
            _stopwatch.Reset();
        }
        ElapsedText.Value = _stopwatch.Elapsed.ToString(@"hh\:mm\:ss");
    }
}

@style scoped {
    .lead {
        margin: 0;
        color: #42556d;
        line-height: 1.6;
    }
}
```

What the container buys you, and what to notice:

- **The container is the only divergence from Vue** — `.viu` uses `@`-block headers rather than
  `<template>` / `<script>` / `<style>` tags, a design decision dated 2026-07-17. The block
  *semantics* follow the [Vue SFC spec](https://vuejs.org/api/sfc-spec.html) unchanged, and the markup
  inside `@template` is standard Vue template syntax. See
  [Single-File Components (.viu)](../guide/scaling-up/single-file-components.md).
- **Column 0 is structural, in both directions** — at the top level, a line whose first character is
  `@` opens a block, so an indented `@template {` is not a block header; and the opening `{` must be
  the last non-whitespace character on the header line. Inside a block, a line whose first character
  is `}` *closes* it. That second rule is why every member in the `@script` body above is indented: an
  unindented closing brace would end the block mid-method. The parser only slices — it never looks
  inside content — so braces in C# strings, nested CSS braces, and brace-bearing HTML text all survive
  verbatim as long as they are indented. The flush-left `using` directives are safe (they start with
  neither `@` nor `}`) and the generator hoists them above the namespace.
- **Expression bodies are C#, not JavaScript** — `{{ IsRunning ? "Pause" : "Start" }}` is parsed with
  Roslyn. The compiler rewrites identifiers through `_ctx.` and inserts `.Value` on refs in both read
  and write positions, so that interpolation emits as `_ctx.IsRunning.Value ? "Pause" : "Start"`.
- **`<ElapsedDisplay>` resolves by name at render time** — the compiler emits
  `_resolveComponent("ElapsedDisplay")`, so the child must be registered on the application
  (`app.Component("ElapsedDisplay", new ElapsedDisplay())`). Registration lookup is case-insensitive at
  render time even though the registry getter is exact-name.
- **`@style scoped` is compiled, not shipped as CSS-in-JS** — the generator rewrites the block with a
  `data-v-<hash>` scope id and emits it as `ScopeId` and `ExtractedStyles` constants on the partial
  class. **Not yet implemented: the renderer never stamps that attribute onto an element.**
  `RendererOptions<TNode>.SetScopeId` is declared and no code path in the repository ever calls it, so
  a scoped rule compiles, bundles, and serves correctly while matching nothing in the browser. CSS
  Modules is unaffected — it renames classes at compile time. Physical bundling is a separate
  MSBuild step: the `ViuBundleCss` task re-parses the same `.viu` inputs and writes
  `<AssemblyName>.viu.css` as a static web asset, which the host page must reference with an explicit
  `<link>` — injection is not automatic. The WASM runtime does zero CSS work. Note that scoping is
  per-component: a scoped rule in this file cannot reach `.meter-value`, which belongs to
  `ElapsedDisplay`'s own template. See [SFC CSS Features](../guide/scaling-up/sfc-css-features.md).
- **The render function is generated, not written** — the emitted partial class carries
  `internal static object? Render(StopwatchApplication _ctx, object?[] _cache)` alongside an
  `internal const int RenderCacheSize` constant, wrapped in `#line` directives that map compiler errors
  and debugger steps back into the `.viu` file. The `_ctx` parameter is typed as the component's own
  class, which is why the file cannot be named `Stopwatch.viu` — the generated `Stopwatch` class would
  shadow `System.Diagnostics.Stopwatch` inside its own `@script` body.

One thing the projection does *not* show: the ticking timer. `TickAsync`, `Lifecycle.OnMounted`, and
`Lifecycle.OnUnmounted` have no `@`-block equivalent — they would live in a hand-written `.cs` partial
alongside the generated one, which is exactly what the `partial class` scaffold is designed to allow.
The projection covers the template, the state, and the handlers; the lifecycle stays C#.

With that caveat, comparing the two forms makes the value proposition concrete: the template block
replaces about thirty lines of nested `VirtualNodeFactory` calls, the compiler assigns `PatchFlags`
that the hand-written form leaves unset, and the scoped rules stop being global `<style>` entries in
`index.html`.

## Diagnostics mode

Appending `?diagnostics=1` to the URL runs a different program entirely. `Program.cs` checks the query
string before creating the app:

```csharp
await JSHost.ImportAsync("benchmark", "/benchmark.js");
if (DiagnosticsInterop.GetQuery().Contains("diagnostics", StringComparison.Ordinal))
{
    try
    {
        await ViuDiagnostics.RunAsync(BrowserRuntime.QuerySelector("#app"));
    }
    catch (Exception exception)
    {
        DiagnosticsInterop.ReportCrash(exception.ToString());
    }
    await Task.Delay(Timeout.Infinite);
}
```

`ViuDiagnostics.RunAsync` renders a plain-text report covering four checks:

- **Handle-lifecycle stress** — 100 render/unrender cycles of a large tree carrying listeners, checking
  that `BrowserRuntime.GetRegistryDiagnostics()` — which returns
  `(int JsNodes, int JsListenerMaps, int DotnetListeners)` — comes back to its baseline triple.
- **Application-lifecycle stress, direct mode** — 25 `CreateApp` / `Mount` / `Unmount` cycles of the
  stopwatch itself, with its components, props, emits, and timers, asserting the same baseline return.
- **Application-lifecycle stress, buffered mode** — the identical loop with
  `BrowserRuntime.CreateApp(root, useCommandBuffer: true)`, which routes every node operation through
  the batched interop command buffer applied once per scheduler flush. Buffered and direct modes must
  clean up identically.
- **Marshaling benchmark** — the same creation, text-set, attribute-set, and tree build/teardown mixes
  driven twice, once over `int` node handles and once over `JSObject` proxies, reporting microseconds
  per operation and the ratio between them.

That last one exists to back `libraries/Assimalign.Viu.RuntimeDom/docs/ADR-0001-interop-marshaling.md`,
the decision record behind Viu passing DOM nodes across the WASM boundary as positive `int` handles
rather than as `JSObject` proxies. Treat the numbers as indicative dev-build measurements: this is
example-level tooling, not a benchmark suite. A real end-to-end browser test harness and performance
suite are both unbuilt — see [Project status](../roadmap/status.md).

## Do not copy this project file

The example's csproj is short and tempting, and it is wrong for a consumer:

```xml
<Project Sdk="Microsoft.NET.Sdk.WebAssembly">
  <PropertyGroup>
    <TargetFramework>$(TargetFrameworkLatest)</TargetFramework>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <OverrideHtmlAssetPlaceholders>true</OverrideHtmlAssetPlaceholders>
  </PropertyGroup>

  <ItemGroup>
    <StaticWebAssetFingerprintPattern Include="JS" Pattern="*.js" Expression="#[.{fingerprint}]!" />
  </ItemGroup>

  <ItemGroup>
    <ViuProjectReference Include="Assimalign.Viu.RuntimeDom" />
  </ItemGroup>
</Project>
```

The fingerprint pattern is what makes the `main#[.{fingerprint}].js` placeholder in `index.html`
resolve; `OverrideHtmlAssetPlaceholders` is what lets the WebAssembly SDK rewrite it.

`ViuProjectReference` and the `$(TargetFrameworkLatest)` alias are in-repo build-system constructs that
only resolve inside the Viu repository's central targets. In-repo projects dogfood the libraries by
project reference and must never use the SDK; external consumers use the SDK and never see
`ViuProjectReference`. A real consumer project is the whole of:

```xml
<Project Sdk="Assimalign.Viu.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
</Project>
```

See [Quick Start](../guide/quick-start.md) for the complete consumer project, and
[The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md) for what that one line pulls in.

## Where to go next

- **[Components](../guide/essentials/components.md)** — the `IComponentDefinition` contract this
  example implements twice, and the reasoning behind `Setup` returning a render function.
- **[Render Functions & VirtualNode](../api/render-function.md)** — the full `VirtualNodeFactory`
  surface, of which this example uses `Element`, `Text`, `Component`, and `Properties`.
- **[Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md)** — `Reference<T>`, the
  `[Reactive]` source generator, and why there is no runtime `reactive()`.
- **[Testing](../guide/scaling-up/testing.md)** — `ViuTest.Mount` and the in-memory renderer, the other
  place in the repository where verified-working component code lives.
- **[Examples](./index.md)** — the honest index of what runnable example code exists.
