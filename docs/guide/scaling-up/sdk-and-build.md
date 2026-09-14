# The Viu SDK & Build

How `Assimalign.Viu.Sdk` turns a five-line `.csproj` into a WebAssembly app, and what actually happens
during a build.

> **Status:** Implemented. Distribution is local-feed only — nothing is published to nuget.org yet,
> and no CI job builds a real SDK-consuming project. See
> [Project status](../../roadmap/status.md).

Vue's build story is [Vite plus `@vitejs/plugin-vue`](https://vuejs.org/guide/scaling-up/tooling.html):
a Node toolchain, a plugin that compiles `.vue`, and a dev server. Viu's is an **MSBuild project SDK**.
There is no Node, no bundler config, and no plugin array. You write `Sdk="Assimalign.Viu.Sdk"` at the
top of a `.csproj` and the WebAssembly app model, the framework assemblies, the `[Reactive]` and `.viu`
source generators, the `viu-dom.js` interop bridge, and `@style` CSS bundling all arrive implicitly.

## The minimal project

This is a complete Viu application project file. Nothing has been elided.

```xml
<Project Sdk="Assimalign.Viu.Sdk">
    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
    </PropertyGroup>
</Project>
```

Two rules govern that file, and both bite silently when broken.

- **`<TargetFramework>` must be written literally as `net10.0`** — the `KnownFrameworkReference` the SDK
  registers hardcodes `TargetFramework="net10.0"`, so any other value resolves no packs at all. The
  repo-internal aliases (`$(TargetFrameworkLatest)`, `$(TargetFrameworkForLibraries)`) come from
  `build/Targets/Build.TargetFramework.props`, which is **not** part of the SDK package and evaluates
  to empty in a consumer build.
- **`browser-wasm` is the only registered RID** — `RuntimePackRuntimeIdentifiers="browser-wasm"`. There
  is no server, desktop, or `linux-x64` runtime pack.

## How the SDK is resolved

`Assimalign.Viu.Sdk` is a NuGet package resolved by **NuGet's built-in MSBuild SDK resolver** — the same
machinery that delivers SDKs like `Microsoft.Build.Traversal` and `Microsoft.Build.NoTargets`. (This is
not how the in-box SDKs work: `Microsoft.NET.Sdk`, `Microsoft.NET.Sdk.Web`, and
`Microsoft.NET.Sdk.WebAssembly` ship with the .NET SDK and are resolved by the default resolver.) Because
resolution is just a package restore, there is no installer and no admin right involved in any MSBuild
host that uses the NuGet resolver.

Pin the version inline:

```xml
<Project Sdk="Assimalign.Viu.Sdk/10.0.1-preview.2">
```

Or, preferably, in `global.json` so every project in the tree agrees:

```json
{
    "msbuild-sdks": {
        "Assimalign.Viu.Sdk": "10.0.1-preview.2"
    }
}
```

The `msbuild-sdks` block and the `sdk.version` block are **different sections with different jobs**.
`sdk.version` pins the .NET SDK; `msbuild-sdks` pins the MSBuild project SDK. A `global.json` can carry
both:

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

**Pinning the SDK transitively pins the framework.** The SDK package ships a frozen
`Targets/Build.Version.props` snapshot written at pack time, so inside a consumer build `$(ViuVersion)`
equals the SDK package's own version, and `ViuAppFrameworkVersion` defaults to it. Set
`ViuAppFrameworkVersion` explicitly to roll the framework independently.

## What arrives implicitly

| Piece | Mechanism |
| --- | --- |
| WASM browser app model | `Sdk.props`/`Sdk.targets` chain `Microsoft.NET.Sdk.WebAssembly` |
| Framework libraries (`Assimalign.Viu.App` umbrella, `.Shared`, `.Reactivity`, `.RuntimeCore`, `.RuntimeDom`) | Implicit `<FrameworkReference Include="Assimalign.Viu.App" />` |
| The `[Reactive]` and `.viu` source generators | `analyzers/dotnet/cs/` inside the `Assimalign.Viu.App.Ref` targeting pack |
| `.viu` compilation | The `**/*.viu` → `AdditionalFiles` glob plus `CompilerVisibleProperty` declarations |
| `.viu` `@style` CSS bundling | The `ViuBundleCss` MSBuild task in the SDK package's `Tasks/` |
| `viu-dom.js` interop bridge | Packed under `assets/`, copied into the consumer's `wwwroot/_content/` at build |

The implicit `FrameworkReference` resolves to two NuGet packages, laid out in the same shape as
`Microsoft.AspNetCore.App.Ref` / `.Runtime.<rid>`:

| Package | Contents | Restored for |
| --- | --- | --- |
| `Assimalign.Viu.App.Ref` | `ref/net10.0/` reference assemblies, `data/FrameworkList.xml`, `analyzers/dotnet/cs/` | Compile time |
| `Assimalign.Viu.App.Runtime.browser-wasm` | `runtimes/browser-wasm/lib/net10.0/`, `data/RuntimeList.xml` | App build and publish |

The generators ride in the **Ref** pack rather than as a `PackageReference` because Roslyn resolves a
generator's dependencies exclusively among registered analyzer paths. That is why `FrameworkList.xml`
lists not only the two generator assemblies but their whole parser closure — `Assimalign.Viu.Syntax`,
`.Syntax.Css`, `.Syntax.SingleFileComponent`, `.Syntax.Templates`, and `Assimalign.Viu.Tooling.Css` —
as `<File Type="Analyzer">` entries. Those are compile-time-only libraries and are deliberately *not*
framework assemblies; they never reach your app's runtime.

## Consumer-settable properties

Every one of these goes in a `<PropertyGroup>` in your `.csproj` body. Property evaluation is
document-ordered and the SDK's defaults are all conditioned on emptiness, so a body assignment always
wins.

| Property | Default | Effect |
| --- | --- | --- |
| `EnableSingleFileComponentGeneration` | `true` | Master switch for `.viu` compilation. Gates the `**/*.viu` → `AdditionalFiles` glob and the `RootNamespace`/`ProjectDir` `CompilerVisibleProperty` declarations. |
| `ViuUseSingleFileComponents` | `true` | Under the SDK, **only** a seed for `ViuBundleSingleFileComponentCss`. It does not gate `.viu` compilation. |
| `ViuBundleSingleFileComponentCss` | `true` (follows `ViuUseSingleFileComponents`) | Gates physical `@style` CSS bundling. Set `false` to keep `.viu` compilation but emit no stylesheet. |
| `ViuSingleFileComponentCssBundleName` | `$(PackageId).viu.css` | Renames the emitted bundle. Unfingerprinted, so a hand-written `<link href>` stays stable. |
| `ViuImplicitBrowserPlatform` | on (any value but `false`) | Emits `[assembly: SupportedOSPlatform("browser")]`. |
| `ViuAppFrameworkVersion` | `$(ViuVersion)` | Pins the `Assimalign.Viu.App` framework independently of the SDK version. |
| `ViuAutoIncludeAppFramework` | on (any value but `false`) | While on, the SDK adds the implicit `<FrameworkReference Include="Assimalign.Viu.App" />`. Set it to `false` to suppress that; the `KnownFrameworkReference` registration stays, so an explicit `<FrameworkReference>` keeps working. |
| `EnablePreviewFeatures` | `true` | Must stay `true` — see below. |
| `LangVersion` | `preview` | Set by the SDK so the language features the generators emit against are available. |
| `Nullable` | `enable` | Set by the SDK; the framework surface is nullable-annotated. |
| `ViuBundleCssTaskAssembly` | the packaged `Tasks/Assimalign.Viu.Tooling.Tasks.dll` | Rarely set. Overriding it to a missing path silently disables CSS bundling. |

And one item:

| Item | Effect |
| --- | --- |
| `ViuSingleFileComponentExclude` | Opts a single `.viu` file out of generation, and therefore out of CSS bundling. |

```xml
<ItemGroup>
    <ViuSingleFileComponentExclude Include="Experimental.viu" />
</ItemGroup>
```

### The three `.viu` switches are not synonyms

Their names imply a hierarchy that does not exist. Read this table before assuming one implies another.

| Switch | Actually gates | Does **not** gate |
| --- | --- | --- |
| `EnableSingleFileComponentGeneration` | The `.viu` → `AdditionalFiles` glob and the generator's visible properties | CSS bundling |
| `ViuUseSingleFileComponents` | Nothing directly, under the SDK — it seeds the CSS switch | `.viu` compilation |
| `ViuBundleSingleFileComponentCss` | The `ViuBundleCss` task run and static-web-asset registration | `.viu` compilation |

The practical consequence: setting `EnableSingleFileComponentGeneration=false` alone leaves
`ViuBundleSingleFileComponentCss` at `true`. The bundle target still runs, receives an empty
`@(ViuSingleFileComponent)`, the task returns `null`, and nothing is written. Harmless, but not what
the names suggest.

`ViuUseSingleFileComponents` additionally means something **different** inside the Viu repository
itself, where it is the opt-in that imports the generator wiring at all. Under the SDK that wiring is
imported unconditionally. Same name, two semantics — do not carry in-repo advice into a consumer build.

### `EnablePreviewFeatures` must stay `true`

This is not cosmetic. The `Assimalign.Viu.App` framework assemblies carry
`[assembly: RequiresPreviewFeatures]`, which is viral: a consumer that sets `EnablePreviewFeatures` to
`false` cannot compile against the framework at all. The SDK defaults it precisely so nobody has to
discover this.

### `ViuImplicitBrowserPlatform` and CA1416

`BrowserRuntime` and `BrowserApplication` are annotated `[SupportedOSPlatform("browser")]`. Without a
matching assembly-level attribute, every call raises CA1416. The SDK emits it for you:

```xml
<ItemGroup Condition="'$(ViuImplicitBrowserPlatform)' != 'false' and '$(GenerateAssemblyInfo)' != 'false'">
    <AssemblyAttribute Include="System.Runtime.Versioning.SupportedOSPlatformAttribute">
        <_Parameter1>browser</_Parameter1>
    </AssemblyAttribute>
</ItemGroup>
```

Note the **second condition**: `GenerateAssemblyInfo != 'false'`. A project that disables assembly-info
generation gets no implicit attribute even with `ViuImplicitBrowserPlatform` untouched, and must declare
it by hand:

```csharp
// Properties/AssemblyInfo.cs

[assembly: System.Runtime.Versioning.SupportedOSPlatform("browser")]
```

## What happens during a build

Four things happen that a reader will actually notice in their working tree or their browser.

### 1. `.viu` files are globbed into `AdditionalFiles`

```xml
<ItemGroup Condition="'$(EnableSingleFileComponentGeneration)' == 'true'">
    <ViuSingleFileComponent Include="**/*.viu"
                            Exclude="@(ViuSingleFileComponentExclude);$(DefaultItemExcludes);$(DefaultExcludesInProjectFolder)" />
    <AdditionalFiles Include="@(ViuSingleFileComponent)" KeepDuplicates="false" />
</ItemGroup>
```

This is the C# analogue of `@vitejs/plugin-vue`'s file matching, and it requires zero wiring — drop an
`App.viu` next to your `.csproj` and it compiles. `KeepDuplicates="false"` guards against a
hand-added duplicate producing colliding generated hint names. The generator reads `RootNamespace` and
`ProjectDir` to derive the namespace, class name, and stable CSS Module naming salt. Scoped CSS
was removed on 2026-09-14; no style-scope identifier is emitted. See
[Single-File Components](single-file-components.md) for the format itself.

### 2. `viu-dom.js` is copied into your source `wwwroot`

`BrowserRuntime.InitializeAsync` hardcodes its bridge import URL. This is framework source, not something
you write — `BrowserDomBridge` is `internal`, and the literal lives in the private `InitializeCoreAsync`
that `InitializeAsync` delegates to (`libraries/Assimalign.Viu.RuntimeDom/src/BrowserRuntime.cs`):

```csharp
await JSHost.ImportAsync(
    BrowserDomBridge.ModuleName,
    "/_content/Assimalign.Viu.RuntimeDom/viu-dom.js",
    cancellationToken);
```

A `FrameworkReference` delivers DLLs only, so the JavaScript half rides in the SDK package under
`assets/` and the `ViuFlowFrameworkWebAssets` target copies it into place on every build:

```text
wwwroot/
  index.html
  main.js
  _content/
    Assimalign.Viu.RuntimeDom/
      viu-dom.js     <-- copied in by MSBuild; gitignore this
  _framework/        <-- emitted by the WebAssembly SDK at build
```

Two things about this deserve attention.

- **The copy targets your source tree, not `obj/` or `bin/`.** The destination is
  `$(MSBuildProjectDirectory)\wwwroot\_content\...`. Add `wwwroot/_content/` to your `.gitignore` or the
  artifact gets committed. The asset folder name inside the package **is** the URL segment — MSBuild's
  `%(RecursiveDir)` metadata carries `Assimalign.Viu.RuntimeDom/` straight into the destination path.
- **It exists because of a dev-host constraint.** `WasmAppHost` only serves the app's own source
  `wwwroot`, and — measured on .NET SDK 10.0.10 — it stops serving the app entirely when the project
  references a Razor-SDK class library. So `Assimalign.Viu.RuntimeDom` deliberately stays on the plain
  `Microsoft.NET.Sdk` and its JavaScript is copied rather than served as a real static web asset.

### 3. The `@style` CSS bundle is written

Three targets run in sequence when `ViuBundleSingleFileComponentCss` is `true`:

| Target | Job |
| --- | --- |
| `_ViuResolveSingleFileComponentCssConfiguration` | Derives `obj/<config>/<tfm>/viu/<name>.viu.css` and its content root |
| `_ViuBundleSingleFileComponentCss` | Runs the `ViuBundleCss` task over `@(ViuSingleFileComponent)` |
| `ResolveViuSingleFileComponentCssAssets` | Registers the result as a `Computed` static web asset |

`ViuBundleCss` runs **outside** the Roslyn analyzer sandbox, which is the whole reason it exists: RS1035
forbids `System.IO` inside a source generator, so the generator emits an `ExtractedStyles` constant with
no I/O and the task does the writing. Both run the same compile core —
`Assimalign.Viu.Tooling.Css.SingleFileComponentStyleCompiler.Compile` — over the same `.viu` inputs, so
each of the task's bundle segments is byte-identical to that component's generated `ExtractedStyles`
constant. These are not two generation paths. The task reaches that core through
`SingleFileComponentStyleBundler.Bundle`, which compiles each component, drops the styleless ones, orders
the survivors, and concatenates; the generator calls the compiler directly, per component.

The bundling is doubly incremental: MSBuild `Inputs`/`Outputs` skip the target when no `.viu` changed,
and the task itself content-compares and skips the write when the bytes match, so a no-op rebuild never
moves the timestamp. Determinism is a contract — components are ordered by ascending **ordinal**
comparison of their forward-slash project-relative path, every newline the bundler itself emits is LF
(verbatim pass-through `@style` blocks keep their source newlines), and the file is written UTF-8 without
a BOM.

Then the manual step. **There is no automatic `<link>` injection.** Add it to `wwwroot/index.html`
yourself, inside `<head>`:

```html
<link rel="stylesheet" href="MyApp.viu.css" />
```

Automatic injection was deliberately rejected: rewriting the host page's static web asset in place
desyncs the .NET SDK's compression and endpoint-negotiation graph, so the explicit reference is the
shipped, publish-safe path. Two traps follow from the naming:

- **The bundle is `$(PackageId).viu.css`, not `$(AssemblyName).viu.css`.** For a normal app they
  coincide, because NuGet defaults `PackageId` to `AssemblyName` — but a project that sets `<PackageId>`
  explicitly gets a differently named bundle and a 404 on the hand-written `<link>`.
- **Bundling fails silently when the task assembly is missing.** The `UsingTask`,
  `_ViuBundleSingleFileComponentCss`, and `ResolveViuSingleFileComponentCssAssets` all carry
  `Exists('$(ViuBundleCssTaskAssembly)')` in their conditions and emit no warning. If your
  styles vanish, check that path first. Note the packaged file is `Assimalign.Viu.Tooling.Tasks.dll`,
  not `Assimalign.Viu.Sdk.Tasks.dll` (which is only the packable shell whose `PackageId` is the SDK id).

[SFC CSS Features](sfc-css-features.md) covers what goes *into* that bundle.

### 4. The Mono runtime pack is pinned first

`_ViuPinMicrosoftNetCoreAppRuntimePack` is an internal workaround, but it is worth knowing the failure it
resolves. `Microsoft.NET.Runtime.WebAssembly.Sdk`'s `_InitializeCommonProperties` batches over *all*
`@(ResolvedRuntimePack)` items; with the Viu runtime pack resolved alongside the Mono one, the wrong pack
can win and the build fails with:

```text
Could not find System.Runtime.dll in ...assimalign.viu.app.runtime.browser-wasm...
```

The target pins `$(MicrosoftNetCoreAppRuntimePackDir)` to the `Microsoft.NETCore.App` pack before that
runs. If you see that error, something has re-ordered or suppressed it.

## Getting the packages

Nothing is published to nuget.org. **The only distribution today is a repo-local feed**, produced by
`scripts/Install-Local.ps1` in the Viu repository at
[github.com/assimalign/viu](https://github.com/assimalign/viu).

```powershell
# full chain into _out/packages (Release, browser-wasm)
./scripts/Install-Local.ps1

# re-pack the framework only
./scripts/Install-Local.ps1 -SkipSdk

# re-pack the SDK only
./scripts/Install-Local.ps1 -SkipFramework
```

It issues three `dotnet pack` calls, in this order, each with `-p:PackageOutputPath` aimed at the feed:

```powershell
dotnet pack sdks/Assimalign.Viu.Sdk/Tasks/Assimalign.Viu.Sdk.Tasks.csproj `
    --configuration Release -p:PackageOutputPath=_out/packages
dotnet pack frameworks/Assimalign.Viu.App.Runtime/src/Assimalign.Viu.App.Runtime.csproj `
    --configuration Release -p:RuntimeIdentifier=browser-wasm -p:PackageOutputPath=_out/packages
dotnet pack frameworks/Assimalign.Viu.App.Refs/src/Assimalign.Viu.App.Refs.csproj `
    --configuration Release -p:PackageOutputPath=_out/packages
```

The Ref pack collects its assemblies out of the **Runtime project's RID-less `bin/`**, but it does not
depend on the script's ordering to get one: `Assimalign.Viu.App.Refs.csproj` carries a build-order
`<ProjectReference>` to the Runtime project with `ReferenceOutputAssembly="false"` and
`UndefineProperties="TargetFramework;RuntimeIdentifier"`, so packing the Ref pack alone still produces
the RID-less build it reads from. The RID-qualified runtime pack (`-p:RuntimeIdentifier=browser-wasm`) is
a separate output.

The script also deletes `~/.nuget/packages/{assimalign.viu.sdk, assimalign.viu.app.ref,
assimalign.viu.app.runtime.browser-wasm}` on every run. That pruning is what makes a repeated
`10.0.1-preview.2` pack pick up fresh content instead of being served stale from the global cache. If you
pack by hand, replicate it or bump the version.

Point your consumer project at the feed:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
    <packageSources>
        <add key="viu-local" value="C:\Source\repos\assimalign\viu\_out\packages" />
        <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    </packageSources>
</configuration>
```

Decide deliberately whether you want a `<clear/>` above those entries; without one your machine's global
sources are inherited too.

Finally, the `wasm-tools` workload is required and **nothing checks for it** — its absence produces no
friendly error:

```powershell
dotnet workload install wasm-tools --skip-manifest-update
```

## The in-repo example is not a template

This is the single most common way to get a Viu project wrong. `examples/Assimalign.Viu.WebApp` in the
Viu repository looks like a starting point and is not one. Reproduced verbatim — the file carries no
warning of its own:

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

Every distinctive line there is repo-internal. `Microsoft.NET.Sdk.WebAssembly` is what the Viu SDK chains
*to*, not what a consumer writes. `$(TargetFrameworkLatest)` is defined by repo build props a consumer
never imports. `ViuProjectReference` is a by-name resolution mechanism that indexes
`libraries/**/*.csproj` and `analyzers/**/*.csproj` inside the Viu repository and resolves to nothing
anywhere else. The repo build deliberately does not consume its own SDK, so the framework can be
developed without a pack/restore cycle in the loop.

Use `<Project Sdk="Assimalign.Viu.Sdk">` — the five-line file at the top of this page. The full consumer
layout, file by file, is in [Quick Start](../quick-start.md).

## Not yet implemented

The SDK path works, but its surrounding developer experience is thin. Everything below is absent from the
codebase today.

- **No project templates** — there is no `dotnet new` template, no template package, and no scaffolding
  command. A consumer hand-authors `.csproj`, `global.json`, `nuget.config`, `Program.cs`,
  `wwwroot/index.html`, and `wwwroot/main.js`. There is no `create-vue` counterpart.
- **No public NuGet feed** — the local `_out/packages` feed is the only distribution. Every install
  instruction on this page is a local-feed instruction.
- **No CI-verified consumer smoke test** — the packaging workflow runs `Install-Local.ps1` and then only
  asserts that three `.nupkg` files exist by filename glob. Nothing in CI ever creates a
  `<Project Sdk="Assimalign.Viu.Sdk">` project, restores it against the feed, and builds it. Treat the
  consumer path as documented-and-hand-verified, not machine-verified.
- **No hot reload or dev loop** — there is no watch mode, no HMR, and no counterpart to Vite's dev
  server. `dotnet run` and a browser refresh is the loop.
- **No size or AOT budget gates** — WASM payload-size and startup budgets are planned but unbuilt, so no
  published size numbers exist. See [AOT & Trimming](../best-practices/aot-and-trimming.md).
- **The SDK cannot be a `<PackageReference>`** — the package declares no `buildTransitive/` entry point,
  so `Sdk="Assimalign.Viu.Sdk"` is the only supported consumption form.
- **No second framework family** — `$(ViuFrameworkName)` and the shared framework props/targets are built
  to host more families (a server/SSR one is named in a comment), but only `Assimalign.Viu.App` is
  registered. There is no server renderer to package.
- **The framework is not strong-named** — `ViuPublicKeyToken` is hardcoded empty, so every
  `PublicKeyToken=""` in `FrameworkList.xml` and `RuntimeList.xml` is a placeholder.
- **No transitive static-web-asset flow** — only the SDK package's own `assets/` folder flows to the
  consumer's `wwwroot`. A library that wants to ship its own web assets to a consuming app has no
  supported path.
- **.NET 11 is not supported** — the commented-out `11.0.100-preview` line in the repo's `global.json` is
  a parked experiment. The `KnownFrameworkReference` is `net10.0`-only.

## See also

- [Quick Start](../quick-start.md) — the complete consumer project, file by file.
- [MSBuild Reference](../../api/msbuild-reference.md) — every property, item, and target in one table.
- [Single-File Components (.viu)](single-file-components.md) — what the generators consume.
- [SFC CSS Features](sfc-css-features.md) — what goes into the CSS bundle.
- [Project Status](../../roadmap/status.md) — area-by-area implementation coverage.
