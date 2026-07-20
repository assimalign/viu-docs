# Quick Start

Hand-author a Viu WebAssembly app from an empty folder and run it in the browser.

> **Status:** Partial. The `Assimalign.Viu.Sdk` build chain is implemented and verified, but nothing
> is published to nuget.org, there is no `dotnet new` template, and the `.viu` compiler still emits a
> partial-class scaffold rather than a mountable component. See
> [Project status](../roadmap/status.md).

This is Viu's counterpart to Vue's [Quick Start](https://vuejs.org/guide/quick-start.html), with one
structural difference: Vue scaffolds with `npm create vue@latest`, and Viu has no scaffolding command
at all. Every file below is hand-authored. The upside is that there are only seven of them, and each
one is short enough to read in full.

## Prerequisites

- **.NET SDK 10** — the framework reference is registered for `net10.0` only, so no other target
  framework resolves.
- **The `wasm-tools` workload** — install it with `dotnet workload install wasm-tools`. Nothing in
  the Viu SDK checks for the workload and its absence produces no friendly error, so install it
  first. Viu's own CI uses `dotnet workload install wasm-tools --skip-manifest-update`.
- **A local package feed** — see [Step 3](#step-3-nugetconfig) below. There is no public install
  story yet.

## The project layout

```sh
MyApp/
  MyApp.csproj
  global.json
  nuget.config
  Program.cs
  App.viu
  wwwroot/
    index.html
    main.js
    _content/                 # created by MSBuild — gitignore it
    _framework/               # created by the WebAssembly SDK at build
```

Only the first six files (plus `wwwroot/index.html` and `wwwroot/main.js`) are yours.
`wwwroot/_content/` and `wwwroot/_framework/` are build output.

## Step 1: `MyApp.csproj`

A complete Viu app project is two lines of content:

```xml
<Project Sdk="Assimalign.Viu.Sdk">
    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
    </PropertyGroup>
</Project>
```

That is the whole file. `Assimalign.Viu.Sdk` is an MSBuild **project SDK**, not a
`PackageReference` — it chains `Microsoft.NET.Sdk.WebAssembly`, registers the `Assimalign.Viu.App`
shared framework, wires the `[Reactive]` and `.viu` source generators, bundles `.viu` `@style` CSS,
and flows the `viu-dom.js` interop bridge into your `wwwroot`. NuGet's built-in MSBuild SDK resolver
handles it, so it works in Visual Studio, Rider, and the `dotnet` CLI with no installer.

Write `net10.0` **literally**. The `KnownFrameworkReference` that registers the framework hardcodes
`TargetFramework="net10.0"`, so any other value silently resolves no packs. In particular, do not
copy `$(TargetFrameworkLatest)` out of the in-repo example — that property is repo-internal and
evaluates to empty in a consumer build.

The SDK also sets these defaults for you, each overridable in your csproj body:

| Property | Default | Why it matters |
| --- | --- | --- |
| `EnablePreviewFeatures` | `true` | **Required.** The framework assemblies carry `[assembly: RequiresPreviewFeatures]`, which is viral — setting this to `false` makes your project fail to compile against the framework. |
| `LangVersion` | `preview` | Needed for partial properties, which the `[Reactive]` generator requires. |
| `Nullable` | `enable` | The framework's reference assemblies are annotated. |
| `ViuUseSingleFileComponents` | `true` | Under the SDK this seeds `ViuBundleSingleFileComponentCss` only. |
| `EnableSingleFileComponentGeneration` | `true` | The master switch for `.viu` compilation and the `**/*.viu` glob. |
| `ViuBundleSingleFileComponentCss` | `true` | Whether the physical `.viu` CSS bundle is written. |
| `ViuAutoIncludeAppFramework` | on | Emits the implicit `<FrameworkReference Include="Assimalign.Viu.App" />`. |
| `ViuImplicitBrowserPlatform` | on | Emits `[assembly: SupportedOSPlatform("browser")]` so `BrowserRuntime` calls do not raise CA1416. |

See the [MSBuild reference](../api/msbuild-reference.md) for the full surface and
[The Viu SDK & Build](scaling-up/sdk-and-build.md) for how the pieces fit together.

## Step 2: `global.json`

Pin the SDK version so restores are reproducible:

```json
{
    "msbuild-sdks": {
        "Assimalign.Viu.Sdk": "10.0.1-preview.2"
    }
}
```

The `msbuild-sdks` section is a **different section** from the `sdk` section that pins your .NET SDK
version. They solve unrelated problems and you can use both in one file:

```json
{
    "sdk": {
        "version": "10.0.301"
    },
    "msbuild-sdks": {
        "Assimalign.Viu.Sdk": "10.0.1-preview.2"
    }
}
```

If you would rather not add a `global.json`, pin inline instead:
`<Project Sdk="Assimalign.Viu.Sdk/10.0.1-preview.2">`.

Because the SDK package ships a frozen version snapshot, pinning the SDK transitively pins the
`Assimalign.Viu.App` framework to the same version. Set `ViuAppFrameworkVersion` to decouple them.

## Step 3: `nuget.config`

**Nothing is published to nuget.org.** The only distribution today is a repo-local feed produced by
running `scripts/Install-Local.ps1` in a clone of [github.com/assimalign/viu](https://github.com/assimalign/viu),
which packs the SDK, the runtime pack, and the targeting pack into `_out/packages`:

```sh
# in your clone of the viu repo
./scripts/Install-Local.ps1
```

Then point your app at that folder:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
    <packageSources>
        <add key="viu-local" value="C:\Source\repos\assimalign\viu\_out\packages" />
        <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    </packageSources>
</configuration>
```

Substitute your own clone path. Decide deliberately whether to add `<clear />` before the sources —
without it your machine-global sources are inherited too, which is usually what you want here since
the .NET 10 preview packages come from elsewhere.

One local-feed hazard worth knowing: NuGet caches by package **version**, so re-packing the same
`10.0.1-preview.2` will be served stale from `~/.nuget/packages` unless the extracts are pruned.
`Install-Local.ps1` prunes them on every run; a manual `dotnet pack` does not.

## Step 4: `wwwroot/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>MyApp</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preload" id="webassembly" />
  <script type="importmap"></script>
  <script type="module" src="main#[.{fingerprint}].js"></script>
  <link rel="stylesheet" href="MyApp.viu.css" />
</head>
<body>
  <main id="app"></main>
</body>
</html>
```

Four things in there are load-bearing:

- **`<link rel="preload" id="webassembly" />`** — a placeholder the WebAssembly SDK rewrites at
  build with the real preload set. Leave it empty.
- **The empty `<script type="importmap"></script>`** — a second placeholder, rewritten the same way.
  Leave it empty.
- **`<script type="module" src="main#[.{fingerprint}].js">`** — the `#[.{fingerprint}]` token is
  expanded by a static web asset fingerprint pattern. `type="module"` is required because
  `main.js` uses top-level `await`.
- **`<main id="app"></main>`** — the container `Mount("#app")` resolves. `Mount` **clears the
  container's existing content** on the first mount, so do not put fallback markup inside it and
  expect it to survive.

Both placeholder rewrites and the fingerprint expansion are opt-in properties that
`Assimalign.Viu.Sdk` does **not** set for you today. Either add them yourself:

```xml
<PropertyGroup>
    <OverrideHtmlAssetPlaceholders>true</OverrideHtmlAssetPlaceholders>
</PropertyGroup>

<ItemGroup>
    <StaticWebAssetFingerprintPattern Include="JS" Pattern="*.js" Expression="#[.{fingerprint}]!" />
</ItemGroup>
```

…or drop the fingerprint token and reference `src="main.js"` plainly.

## Step 5: `wwwroot/main.js`

```js
import { dotnet } from './_framework/dotnet.js'

const { runMain } = await dotnet.create()

await runMain()
```

That is the entire JavaScript half of a Viu app. Note what is **not** here: it never imports
`viu-dom.js`. The DOM bridge ships inside the SDK package, is copied to
`wwwroot/_content/Assimalign.Viu.RuntimeDom/viu-dom.js` at build, and is loaded from managed code by
`BrowserRuntime.InitializeAsync` — which hardcodes that exact URL. You never author, import, or
commit that file.

## Step 6: `Program.cs`

```csharp
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new App()).Mount("#app");

// Keep the WASM main loop alive; rendering is reactive from here.
await Task.Delay(Timeout.Infinite);
```

Three statements, and each one earns its place:

- **`BrowserRuntime.InitializeAsync()`** — imports the `viu-dom.js` bridge module. It is idempotent,
  and every other `BrowserRuntime` member throws `InvalidOperationException` until it has completed.
- **`BrowserRuntime.CreateApp(root).Mount("#app")`** — Viu's
  [`createApp`](https://vuejs.org/api/application.html#createapp). The two optional parameters are
  `VirtualNodeProperties? rootProperties` and `bool useCommandBuffer`; the latter batches node
  operations across the interop boundary, and the default is direct mode — buffered and direct
  produce byte-identical DOM. `Mount` returns `ComponentInstance?`, and throws `BrowserDomException`
  when the selector matches no element.
- **`await Task.Delay(Timeout.Infinite)`** — without it, `Main` returns, the WASM main loop shuts
  down, and your app dies immediately after its first paint. Rendering is reactive from this point:
  the component tree owns its own state, timers, and event handlers, and nothing further needs to run
  on the main path.

`BrowserApplication` is fluent, so registration chains before the mount:

```csharp
BrowserRuntime.CreateApp(new App())
    .Component("MyChild", new MyChild())
    .Directive("focus", FocusDirective.Instance)
    .Provide(ThemeKeys.Palette, new Palette())
    .Mount("#app");
```

Set `Config.ErrorHandler` and `Config.WarnHandler` **before** `Mount`. See the
[Application API](../api/application.md).

## Step 7: `App.viu`

A `.viu` single-file component is Viu's counterpart to a
[Vue SFC](https://vuejs.org/guide/scaling-up/sfc.html), with one deliberate divergence: blocks use an
**`@`-block container** rather than HTML-like tags. There is no `<template>` tag anywhere in Viu.

```viu
@template {
    <div class="counter">
        <p>Count: {{ Count }}</p>
        <button type="button" @click="Increment()">+1</button>
    </div>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count = Reactive.Reference(0);

    public void Increment() => Count.Value++;
}

@style scoped {
    .counter { font-family: system-ui; }
}
```

The single rule the whole format rests on is that **column 0 is structural**. At the top level, a
line whose first character is `@` opens a block; inside a block, a line whose first character is `}`
closes it. The parser inspects nothing else — it knows no C#, CSS, or HTML — so braces inside your
content never terminate a block, and **block bodies must be indented**. CSS written flush-left will
close its `@style` block early.

A few more rules worth internalizing before you write your second component:

- **Block names are lowercase and case-sensitive** — `@Template` is a *custom* block, not a template.
- **The `{` must be the last non-whitespace character on the header line.** Content starts on the
  next line.
- **Option values must be double-quoted with no spaces around `=`** — `lang="scss"`, never
  `lang=scss`.
- **At most one `@template` and one `@script`** per file; any number of `@style` and custom blocks.
- **The file name becomes the class name, the folder path becomes the namespace** — `App.viu`
  generates `partial class App` under your `RootNamespace`, and with `RootNamespace` set to `Demo`,
  `Components/Counter.viu` generates `Demo.Components.Counter`. Top-level statements in `Program.cs`
  live in the *global* namespace, so mounting a generated component needs a matching
  `using <RootNamespace>;` — the hand-written equivalent below declares no namespace, which is why
  `new App()` resolves there without one.
- **`Reference<T>` members auto-unwrap in templates** — you write `{{ Count }}`, the compiler emits
  `_ctx.Count.Value`. This is the C# spelling of Vue's setup-binding ref unwrapping.

Template expressions are **C#, not JavaScript**. `{{ Items.Where(x => x.Active).Count() }}` works;
`typeof`, template literals, `JSON`, and `parseInt` do not. See
[Template Syntax](essentials/template-syntax.md).

### What actually compiles today

The `.viu` generator currently emits a partial-class scaffold — the compiled render function
(`internal static object? Render(App _ctx, object?[] _cache)` plus an `internal const int
RenderCacheSize`), your merged `@script` C# under a `#line` map, and the `ScopeId`/`ExtractedStyles`
constants — but the generated class does **not** yet implement `IComponentDefinition`, and nothing
calls `Render`. So `new App()` above is the intended developer experience rather than a shape you can
build end to end right now. The equivalent hand-written component is fully working today:

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

internal sealed class App : IComponentDefinition
{
    public string? Name => "App";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var count = Reactive.Reference(0);

        void Increment() => count.Value++;

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", "counter")),
            VirtualNodeFactory.Element(
                "p",
                VirtualNodeFactory.Text($"Count: {count.Value}")),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("type", "button"), ("onClick", (Action)Increment)),
                VirtualNodeFactory.Text("+1")));
    }
}
```

Note the shape: `Setup` runs **once** per instance and *returns* the render function. State lives in
refs the returned closure captures. There is no `this`, no `Render` member on the interface, and no
Options API — that closure is the proxy-free realization of Vue's state object. See
[Components](essentials/components.md).

## Step 8: the CSS bundle and `.gitignore`

Every `@style` block across your `.viu` files compiles into one deterministic bundle named
`<PackageId>.viu.css` — for a normal app, `MyApp.viu.css`. **There is no automatic `<link>`
injection.** You must reference it by hand, which is why Step 4 already includes:

```html
<link rel="stylesheet" href="MyApp.viu.css" />
```

This was a deliberate reversal, not an oversight: rewriting the host page's static web asset in place
desyncs the .NET SDK's compression and endpoint-negotiation graph, so the explicit reference is the
shipped, publish-safe path. If you set `<PackageId>` explicitly the bundle is renamed with it and
your hand-written `href` will 404 — rename both, or set `ViuSingleFileComponentCssBundleName`.

Scoped blocks are rewritten with a `data-v-<hash>` scope id derived from the component's
**project-relative path**, so moving or renaming a `.viu` file changes its scope id but editing its
body does not.

> **Not yet implemented — the scope attribute is never stamped.** The rewrite above is real and the
> CSS ships in the bundle, but `RendererOptions<TNode>.SetScopeId` is declared and never called, so no
> element carries `data-v-<hash>` and a `@style scoped` rule matches nothing in the browser today.
> CSS Modules (`@style module`) is unaffected, because it renames classes at compile time rather than
> relying on a runtime attribute. See [SFC CSS Features](scaling-up/sfc-css-features.md).

Finally, add a `.gitignore` rule. `wwwroot/_content/` is written into your **source** tree on every
build (a dev-host constraint — the WASM dev host only serves the app's source `wwwroot`), so it is a
build artifact that must not be committed:

```sh
wwwroot/_content/
wwwroot/_framework/
```

## Build and run

```sh
dotnet restore
dotnet run
```

## When it goes wrong

| Symptom | Cause |
| --- | --- |
| Restore resolves no framework packs | `TargetFramework` is not literally `net10.0`. The `KnownFrameworkReference` is registered for that TFM only. |
| Build fails: `Could not find System.Runtime.dll in ...assimalign.viu.app.runtime.browser-wasm...` | The WebAssembly SDK picked the Viu runtime pack over the Mono one. The SDK ships a shim target that pins the correct pack — if you see this, your SDK version predates it. |
| CA1416 on every `BrowserRuntime` call | `ViuImplicitBrowserPlatform=false`, **or** `GenerateAssemblyInfo=false` (which silently suppresses the implicit attribute). Declare `[assembly: SupportedOSPlatform("browser")]` by hand. |
| Cannot compile against the framework at all | `EnablePreviewFeatures` was set to `false`. The framework's `[assembly: RequiresPreviewFeatures]` is viral. |
| 404 on `/_content/Assimalign.Viu.RuntimeDom/viu-dom.js` | The copy target runs only under the WebAssembly SDK. Confirm you are on `Assimalign.Viu.Sdk` and not a plain `Microsoft.NET.Sdk`. |
| No CSS bundle is produced, no warning | The CSS bundling targets are all conditioned on the task assembly existing and **fail silently** when it does not. Check `ViuBundleCssTaskAssembly` if you overrode it. |
| `.viu` file is ignored | It matched `ViuSingleFileComponentExclude`, or `EnableSingleFileComponentGeneration` is `false`. |
| A `@style` or `@script` block ends early | Content was written flush-left. A `}` at column 0 closes the block; the real closing brace then reports stray top-level content. |

Compiler diagnostics from `.viu` files are reported on the `.viu` file itself at the exact line and
column, via a `#line` map. See [Compiler Diagnostics](../api/diagnostics.md).

## Do not copy the in-repo example

The `examples/Assimalign.Viu.WebApp` project inside the Viu repository is **not** a consumer
template. It builds on `Microsoft.NET.Sdk.WebAssembly` with `ViuProjectReference` items and
`$(TargetFrameworkLatest)` — all in-repo dogfooding mechanisms that resolve to nothing outside the
repo. The in-repo build deliberately does not consume the SDK, so the framework can be developed
without a pack/restore cycle in the loop. Its `Program.cs`, `wwwroot/index.html`, and `wwwroot/main.js`
*are* good references; its `.csproj` is not.

Likewise, the `.designing/SampleApp/` folder is a set of empty placeholders, and the
`Assimalign.Viu.Routing` namespace referenced in its skeleton does not exist.

## Not yet implemented

- **No project template** — there is no `dotnet new` template, template package, or scaffolding
  command. Every file above is hand-authored by design of circumstance, not preference.
- **No public packages** — nothing ships to nuget.org. The repo-local `_out/packages` feed is the
  only distribution.
- **The consumer path is not CI-verified** — CI packs the three packages and asserts the `.nupkg`
  files exist. Nothing in CI creates a `<Project Sdk="Assimalign.Viu.Sdk">` project and builds it.
- **`.viu` components are not end-to-end** — the generator emits the render function, merged script,
  and style constants, but not the `IComponentDefinition` implementation that would make the
  generated class mountable.
- **No `<link>` auto-injection** for the CSS bundle, and no CSS pre-processors — `lang="scss"` is
  parsed and preserved but nothing compiles it.
- **One RID, one TFM** — `browser-wasm` and `net10.0` are the only registered combination.
- **No Router, Store, SSR/hydration, or DevTools** — these do not exist on disk in any form.
  `Teleport`, `KeepAlive`, and `Suspense` exist only as markers that throw `NotSupportedException`;
  see [KeepAlive, Teleport & Suspense](built-ins/deferred-built-ins.md).

## Next steps

- [Introduction](introduction.md) — what Viu is, and the five founding divergences from Vue.
- [Essentials](essentials/index.md) — components, reactivity, templates, and events, in reading order.
- [Single-File Components](scaling-up/single-file-components.md) — the `.viu` format in full.
- [The Viu SDK & Build](scaling-up/sdk-and-build.md) — how the SDK, packs, and generators fit together.
- [Stopwatch](../examples/stopwatch.md) — the one demo that runs today, end to end.
- [Differences from Vue 3](../roadmap/vue-differences.md) — start here if you already know Vue.
