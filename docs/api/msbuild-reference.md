# MSBuild Reference

Every property, item, and target that `Assimalign.Viu.Sdk` defines, defaults, or exposes to a
consumer project.

> **Status:** Implemented. Every property, item, and target below exists in the shipped SDK
> package. Distribution does not — nothing is published to nuget.org and no CI job builds a
> consumer project. See [Project status](../roadmap/status.md).

Viu ships an MSBuild **project SDK**, not a bundler. Where a Vue app wires
[Vite and `@vitejs/plugin-vue`](https://vuejs.org/guide/scaling-up/tooling.html) through a
`vite.config.js`, a Viu app declares one SDK on the `<Project>` element and gets the WebAssembly
app model, the framework assemblies, the `[Reactive]` and `.viu` source generators, the
`viu-dom.js` interop bridge, and `@style` CSS bundling implicitly.

## The canonical consumer project

A complete Viu app csproj is two lines of content:

```xml
<Project Sdk="Assimalign.Viu.Sdk">
    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
    </PropertyGroup>
</Project>
```

`net10.0` must be written **literally**. The `KnownFrameworkReference` registration hardcodes
`TargetFramework="net10.0"`, so any other target framework moniker resolves no packs and fails
without a useful error. The repo-internal `$(TargetFrameworkLatest)` alias is not available to
consumers — see [Contributor-only mechanisms](#contributor-only-mechanisms).

## SDK resolution and versioning

Resolution goes through NuGet's built-in MSBuild SDK resolver, so it works in Visual Studio,
Rider, and `dotnet` with no installer. Pin the version in `global.json`:

```json
{
    "msbuild-sdks": {
        "Assimalign.Viu.Sdk": "10.0.1-preview.2"
    }
}
```

The `msbuild-sdks` block is a **different section** from `sdk.version`, which pins the .NET SDK
itself. The two are unrelated and a project may set both. Alternatively, pin inline:

```xml
<Project Sdk="Assimalign.Viu.Sdk/10.0.1-preview.2">
```

Because nothing is published publicly, restore has to point at a local feed produced by
`scripts/Install-Local.ps1` in the Viu repository:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
    <packageSources>
        <add key="viu-local" value="C:\Source\repos\assimalign\viu\_out\packages" />
        <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    </packageSources>
</configuration>
```

The SDK package carries a **frozen** `Targets/Build.Version.props` written at pack time, so
`$(ViuVersion)` inside a consumer build always equals the SDK package's own version. Pinning the
SDK therefore transitively pins the framework, unless `ViuAppFrameworkVersion` overrides it.

## Properties

| Property | Default | Gates | Consequence of changing |
| --- | --- | --- | --- |
| `ViuUseSingleFileComponents` | `true` | Under the SDK, **only** the seed for `ViuBundleSingleFileComponentCss` | Setting `false` disables CSS bundling; it does **not** disable `.viu` compilation |
| `EnableSingleFileComponentGeneration` | `true` | The `**/*.viu` → `AdditionalFiles` glob and the `CompilerVisibleProperty` declarations | `false` disables `.viu` compilation entirely |
| `ViuBundleSingleFileComponentCss` | `true` when `ViuUseSingleFileComponents` is `true`, else `false` | Physical `@style` CSS bundling | `false` keeps `.viu` compilation but emits no CSS bundle |
| `ViuSingleFileComponentCssBundleName` | `$(PackageId).viu.css` | The bundle's logical file name | Renaming it invalidates any hand-written `<link href>` |
| `ViuBundleCssTaskAssembly` | The packaged `Tasks/Assimalign.Viu.Tooling.Tasks.dll` | Which assembly supplies the `ViuBundleCss` task | A path that does not exist silently disables all CSS bundling — no warning |
| `ViuImplicitBrowserPlatform` | on (any value but `false`) | Emitting `[assembly: SupportedOSPlatform("browser")]` | `false` means CA1416 on every `BrowserRuntime` call unless declared by hand |
| `ViuAppFrameworkVersion` | `$(ViuVersion)` | `DefaultRuntimeFrameworkVersion`, `LatestRuntimeFrameworkVersion`, `TargetingPackVersion` | Pins or rolls the `Assimalign.Viu.App` framework independently of the SDK |
| `ViuAutoIncludeAppFramework` | on (any value but `false`) | The implicit `<FrameworkReference Include="Assimalign.Viu.App" />` | `false` suppresses the implicit reference; the registration stays, so an explicit `FrameworkReference` still works |
| `EnablePreviewFeatures` | `true` | Compiling against `[assembly: RequiresPreviewFeatures]` framework assemblies | `false` **breaks the build** — the attribute is viral |
| `LangVersion` | `preview` | C# language version | Lowering it may break generated code |
| `Nullable` | `enable` | Nullable reference type analysis | Consumer preference only |

An assignment in the consumer's csproj body wins in every case, but the rows get there three
different ways:

- **Defaulted in `Sdk.props`, so document order decides.** `ViuUseSingleFileComponents`,
  `ViuBundleCssTaskAssembly`, `EnablePreviewFeatures`, `LangVersion`, and `Nullable` come from
  `Common.props`; `ViuAppFrameworkVersion` from `FrameworkReference.props`;
  `EnableSingleFileComponentGeneration` from `Syntax.Generators.props`. Each is written
  `Condition="'$(X)' == ''"` and the consumer's body is evaluated afterwards.
- **Never assigned a default at all.** `ViuImplicitBrowserPlatform` and
  `ViuAutoIncludeAppFramework` are only ever *tested*, as `'$(X)' != 'false'`. Unset therefore
  reads as on, and `false` is the single value that turns them off — `0`, `no`, and `off` do
  nothing.
- **Defaulted late, after the consumer's body.** `ViuBundleSingleFileComponentCss` is set in
  `Css.Bundling.targets` at the bottom of `Sdk.targets`, and `ViuSingleFileComponentCssBundleName`
  later still, inside the `_ViuResolveSingleFileComponentCssConfiguration` target body. Both read
  the consumer's value because it is already final by then, not because they evaluate first.

### The three `.viu` switches are not a hierarchy

`ViuUseSingleFileComponents`, `EnableSingleFileComponentGeneration`, and
`ViuBundleSingleFileComponentCss` read like a nested set of master switches. They are not:

- **`EnableSingleFileComponentGeneration=false` alone** — stops `.viu` compilation, but leaves
  `ViuBundleSingleFileComponentCss` at `true`. The bundle target still runs and receives an empty
  `@(ViuSingleFileComponent)`; the `ViuBundleCss` task finds no `@style` block, sets `BundlePath`
  to the empty string and `BundleWritten` to `false`, logs a low-importance message, and succeeds
  without writing. No bundle file, so no static web asset is registered. Harmless, but not what
  the names imply.
- **`ViuUseSingleFileComponents=false` alone** — turns off CSS bundling only. `.viu` files still
  compile.
- **To disable `.viu` end to end** — set `EnableSingleFileComponentGeneration=false`.

`ViuUseSingleFileComponents` additionally means something **different** in the Viu repository's own
build, where it is the opt-in that imports the generator wiring at all. Under the SDK that wiring
is imported unconditionally.

### `ViuImplicitBrowserPlatform` has a second off-switch

The `AssemblyAttribute` item group is also conditioned on `'$(GenerateAssemblyInfo)' != 'false'`. A
project with `GenerateAssemblyInfo=false` gets no implicit attribute regardless of
`ViuImplicitBrowserPlatform`, and must declare it manually:

```csharp
// Properties/AssemblyInfo.cs
[assembly: System.Runtime.Versioning.SupportedOSPlatform("browser")]
```

### The CSS bundle name follows `PackageId`, not `AssemblyName`

`ViuSingleFileComponentCssBundleName` defaults to `$(PackageId).viu.css`. For a normal app the two
coincide, because NuGet defaults `PackageId` to `AssemblyName`. A project that sets `<PackageId>`
explicitly gets a differently named bundle, and its hand-written `<link>` will 404. There is no
automatic `<link>` injection — the reference is always hand-authored:

```xml
<!-- inside <head> of wwwroot/index.html -->
<link rel="stylesheet" href="MyApp.viu.css" />
```

See [SFC CSS Features](../guide/scaling-up/sfc-css-features.md) for what lands in that bundle.

## Items

| Item | Kind | Purpose |
| --- | --- | --- |
| `ViuSingleFileComponent` | Auto-globbed | Every `.viu` file in the project, flowed to `AdditionalFiles` with `KeepDuplicates="false"` |
| `ViuSingleFileComponentExclude` | Consumer-settable | Opts individual `.viu` files out of generation, and therefore out of CSS bundling |

The glob is the C# analogue of `@vitejs/plugin-vue`'s file handling — no per-file wiring:

```xml
<ItemGroup Condition="'$(EnableSingleFileComponentGeneration)' == 'true'">
    <ViuSingleFileComponent Include="**/*.viu"
                            Exclude="@(ViuSingleFileComponentExclude);$(DefaultItemExcludes);$(DefaultExcludesInProjectFolder)" />
    <AdditionalFiles Include="@(ViuSingleFileComponent)" KeepDuplicates="false" />
</ItemGroup>
```

To exclude one component:

```xml
<ItemGroup>
    <ViuSingleFileComponentExclude Include="Experimental.viu" />
</ItemGroup>
```

## Targets

| Target | Hook | Visible effect |
| --- | --- | --- |
| `ViuFlowFrameworkWebAssets` | `BeforeTargets="ResolveProjectStaticWebAssets;AssignTargetPaths"`, only when `$(UsingMicrosoftNETSdkWebAssembly)` is `true` | Copies `viu-dom.js` into the **source** `wwwroot/_content/` |
| `_ViuResolveSingleFileComponentCssConfiguration` | `DependsOnTargets="ResolveStaticWebAssetsConfiguration"` | Derives `obj/<config>/<tfm>/viu/<name>.viu.css` |
| `_ViuBundleSingleFileComponentCss` | `Inputs="@(ViuSingleFileComponent)"`, `Outputs="$(_ViuCssBundlePath)"` | Runs the `ViuBundleCss` task and writes the bundle |
| `ResolveViuSingleFileComponentCssAssets` | `BeforeTargets="ResolveStaticWebAssetsInputs"` | Registers the bundle as a `Computed` static web asset |
| `_ViuPinMicrosoftNetCoreAppRuntimePack` | `BeforeTargets="_InitializeCommonProperties"`, only when `$(MicrosoftNetCoreAppRuntimePackDir)` is still empty | None when healthy — a workaround shim |

### `ViuFlowFrameworkWebAssets` writes into your source tree

`BrowserRuntime.InitializeAsync` drives a private `InitializeCoreAsync` that hardcodes
`JSHost.ImportAsync(BrowserDomBridge.ModuleName, "/_content/Assimalign.Viu.RuntimeDom/viu-dom.js", …)`.
A `FrameworkReference` delivers DLLs only, so the JavaScript half rides in the SDK package under
`assets/` and is copied on every build to:

```text
<ProjectDir>/wwwroot/_content/Assimalign.Viu.RuntimeDom/viu-dom.js
```

That destination is `$(MSBuildProjectDirectory)`, **not** `obj/` or `bin/`. Add this line to
`.gitignore`:

```text
wwwroot/_content/
```

The `%(RecursiveDir)` metadata is what carries the library folder name into the URL — the asset
folder name inside the package *is* the URL segment.

### The CSS bundling flow is three targets and doubly incremental

`_ViuBundleSingleFileComponentCss` is gated by MSBuild `Inputs`/`Outputs`, and the `ViuBundleCss`
task additionally content-compares before writing, so a no-op rebuild never moves the timestamp.
`ResolveViuSingleFileComponentCssAssets` deliberately runs on **every** build so the asset stays
registered even when the file was unchanged — the same `DefineStaticWebAssets` path Blazor scoped
CSS uses for `<App>.styles.css`.

`_ViuBundleSingleFileComponentCss` and `ResolveViuSingleFileComponentCssAssets` — and the
`UsingTask` declaration itself — carry `Exists('$(ViuBundleCssTaskAssembly)')` in their conditions
and **fail silently** when it is missing. `_ViuResolveSingleFileComponentCssConfiguration` does
not: it is gated only on `'$(ViuBundleSingleFileComponentCss)' == 'true'`, so it still runs and
still computes `$(_ViuCssBundlePath)`, but nothing downstream consumes it. The net effect is the
same — no bundle, no warning. Note the packaged file is `Assimalign.Viu.Tooling.Tasks.dll`, not
`Assimalign.Viu.Sdk.Tasks.dll` (which is the packable shell whose `PackageId` is the SDK id).

### `_ViuPinMicrosoftNetCoreAppRuntimePack` resolves a real failure

`Microsoft.NET.Runtime.WebAssembly.Sdk`'s `_InitializeCommonProperties` batches over **all**
`@(ResolvedRuntimePack)` items. With the Viu runtime pack resolved alongside the Mono one, the
wrong pack can win and the build fails with:

```text
Could not find System.Runtime.dll in ...assimalign.viu.app.runtime.browser-wasm...
```

The shim pins `$(MicrosoftNetCoreAppRuntimePackDir)` to the `Microsoft.NETCore.App` pack first. If
you see that error, confirm the target is not being suppressed — do not work around it by editing
the runtime pack.

## Import order

Understanding evaluation order explains most surprises. At the top of the build, `Sdk/Sdk.props`:

```xml
<Import Sdk="Microsoft.NET.Sdk.WebAssembly" Project="Sdk.props" />
<Import Project="..\Targets\Build.Version.props" />
<Import Project="..\Targets\Assimalign.Viu.Sdk.Common.props" />
<Import Project="..\Targets\Assimalign.Viu.Sdk.FrameworkReference.props" />
<Import Project="..\Targets\Assimalign.Viu.Syntax.Generators.props" Condition="Exists(...)" />
```

`Build.Version.props` **must** come first. Without `$(ViuVersion)` defined,
`FrameworkReference.props` evaluates `KnownFrameworkReference` with `TargetingPackVersion=""` and
restore fails with `'[]' is not a valid version string` before any pack is extracted.

At the bottom, after the consumer's own properties and items are known, `Sdk/Sdk.targets`:

```xml
<Import Sdk="Microsoft.NET.Sdk.WebAssembly" Project="Sdk.targets" />
<Import Project="..\Targets\Assimalign.Viu.Sdk.WebAssembly.targets" Condition="Exists(...)" />
<Import Project="..\Targets\Assimalign.Viu.Syntax.Generators.targets" Condition="Exists(...)" />
<Import Project="..\Targets\Assimalign.Viu.Sdk.Css.Bundling.targets" Condition="Exists(...)" />
<Import Project="..\Targets\Assimalign.Viu.Sdk.StaticWebAssets.targets" Condition="Exists(...)" />
```

## The framework reference

The SDK registers one shared framework:

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

**`browser-wasm` is the only registered RID.** `IsTrimmable="true"` is what makes the framework
participate in trimming — see [AOT & Trimming](../guide/best-practices/aot-and-trimming.md).

The framework delivers five assemblies: `Assimalign.Viu.App`, `Assimalign.Viu.Shared`,
`Assimalign.Viu.Reactivity`, `Assimalign.Viu.RuntimeCore`, and `Assimalign.Viu.RuntimeDom`, plus
two generators — `Assimalign.Viu.Reactivity.Generators` and `Assimalign.Viu.Syntax.Generators`.
Compile-time-only libraries are deliberately **not** framework assemblies. The five that a
consumer actually receives — `Assimalign.Viu.Syntax`, `.Syntax.Css`, `.Syntax.SingleFileComponent`,
`.Syntax.Templates`, and `Assimalign.Viu.Tooling.Css` — arrive only inside the Ref pack's
`analyzers/dotnet/cs/`, as the generators' parser closure. `Assimalign.Viu.Syntax.Html` and
`Assimalign.Viu.Syntax.JavaScript` exist under `libraries/` but ship in **no** pack;
`Assimalign.Viu.Testing` is a dev-time harness and is likewise not a framework member.

## Package layout

Three packages resolve for a consumer build.

**`Assimalign.Viu.Sdk`** — a pure SDK package with no `lib/` folder and an empty dependency group:

```text
README.md
Sdk/Sdk.props
Sdk/Sdk.targets
Targets/Assimalign.Viu.Sdk.Common.props
Targets/Assimalign.Viu.Sdk.Css.Bundling.targets
Targets/Assimalign.Viu.Sdk.FrameworkReference.props
Targets/Assimalign.Viu.Sdk.StaticWebAssets.targets
Targets/Assimalign.Viu.Sdk.WebAssembly.targets
Targets/Assimalign.Viu.Syntax.Generators.props
Targets/Assimalign.Viu.Syntax.Generators.targets
Targets/Build.Version.props
Tasks/Assimalign.Viu.Tooling.Tasks.dll   (+ its parser and Roslyn closure)
assets/Assimalign.Viu.RuntimeDom/viu-dom.js
```

**`Assimalign.Viu.App.Ref`** — the targeting pack, compile-time half:

```text
ref/net10.0/Assimalign.Viu.{App,Reactivity,RuntimeCore,RuntimeDom,Shared}.dll
data/FrameworkList.xml
analyzers/dotnet/cs/Assimalign.Viu.Reactivity.Generators.dll
analyzers/dotnet/cs/Assimalign.Viu.Syntax.Generators.dll
analyzers/dotnet/cs/Assimalign.Viu.Syntax{,.Css,.SingleFileComponent,.Templates}.dll
analyzers/dotnet/cs/Assimalign.Viu.Tooling.Css.dll
```

`FrameworkList.xml` lists ref assemblies as `<File Type="Managed">` and every analyzer DLL —
generators **and** their parser closure — as `<File Type="Analyzer">`. Roslyn resolves a
generator's dependencies exclusively among registered analyzer paths, which is why the whole
closure ships.

**`Assimalign.Viu.App.Runtime.browser-wasm`** — the runtime pack, app-build/publish half:

```text
runtimes/browser-wasm/lib/net10.0/Assimalign.Viu.{App,Reactivity,RuntimeCore,RuntimeDom,Shared}.dll
data/RuntimeList.xml
```

## Contributor-only mechanisms

These exist only inside the Viu repository and resolve to **nothing** in a consumer project. Never
put them in an app csproj.

| Mechanism | Scope | Consumer equivalent |
| --- | --- | --- |
| `ViuProjectReference` / `ViuPrivateProjectReference` | In-repo by-name project resolution | The implicit `FrameworkReference` |
| `ViuPackageReference` / `ViuAnalyzerReference` | In-repo central version/analyzer resolution | Ordinary `PackageReference` |
| `$(TargetFrameworkLatest)` and every `TargetFrameworkFor*` alias | In-repo TFM aliases | Literal `net10.0` |
| `$(ViuRepositoryDirectory)`, `$(ViuOutputPath*)` | In-repo paths | None |
| `ViuFlowReferencedLibraryWebAssets` | In-repo asset flow | `ViuFlowFrameworkWebAssets` |
| `PackViuProjects` | In-repo pack opt-in | None |

**The in-repo example app is not a consumer template.** `examples/Assimalign.Viu.WebApp` uses
`Sdk="Microsoft.NET.Sdk.WebAssembly"`, `$(TargetFrameworkLatest)`, and `ViuProjectReference` — all
dogfooding mechanisms. The Viu repository does **not** consume its own SDK; its `global.json` has
no `msbuild-sdks` block at all. Start from
[the Quick Start](../guide/quick-start.md), never from that csproj.

## Known issues and gotchas

- **`wasm-tools` is required and the Viu SDK does not check for it** — install with
  `dotnet workload install wasm-tools`. Nothing in `Assimalign.Viu.Sdk` verifies the workload; the
  error you get is the .NET SDK's own `NETSDK1147`, which does name the missing workload but says
  nothing about Viu.
- **A same-version repack is served stale from the global cache** — `Install-Local.ps1` prunes
  `~/.nuget/packages/{assimalign.viu.sdk,assimalign.viu.app.ref,assimalign.viu.app.runtime.browser-wasm}`
  on every run. Anyone packing by hand must replicate that pruning or bump the version.
- **Pack order matters** — the runtime pack must be built before the ref pack, because the Refs
  project collects assemblies from the Runtime project's RID-less `bin/`.
- **Version bumps happen in exactly one place** — `<ViuPatchVersion>` in
  `build/Targets/Build.Version.props`. Never set `<Version>` directly; a prerelease semver
  propagates to `AssemblyVersion` and trips `CS7034`.
- **The framework is not strong-named** — every `PublicKeyToken=""` in `FrameworkList.xml` and
  `RuntimeList.xml` is a placeholder.
- **`_ViuSdk` is the only "am I under the Viu SDK?" probe** — it is set unconditionally to `true`
  by `Common.props`, but its leading underscore marks it private. There is no guaranteed public
  detection story.

## Not yet implemented

- **No public distribution** — nothing is on nuget.org. The gitignored repo-local `_out/packages`
  feed is the only channel.
- **No project template** — there is no `dotnet new` template or scaffolding command. A consumer
  hand-authors `csproj`, `global.json`, `nuget.config`, `Program.cs`, `wwwroot/index.html`, and
  `wwwroot/main.js`.
- **No consumer smoke test** — CI runs `Install-Local.ps1` and asserts only that three `.nupkg`
  files exist. Nothing ever restores and builds a `<Project Sdk="Assimalign.Viu.Sdk">` project, so
  the consumer path is not CI-verified.
- **The SDK cannot be a `PackageReference`** — it declares no `buildTransitive/` entry point, so
  `Sdk="..."` is the only consumption form.
- **Automatic `<link>` injection is a deferred follow-up** — the source records the reason
  (rewriting the host page's static web asset in place desyncs the .NET SDK's compression and
  endpoint negotiation graph), so the explicit hand-authored reference is the shipped,
  publish-safe path. It is parked on a known obstacle, not scheduled.
- **Transitive static web asset flow does not exist** — the in-repo
  `ViuFlowReferencedLibraryWebAssets` batches over `%(ProjectReference)` only, so a library that
  consumes another library's `wwwroot/` assets does not flow them. Consumers are unaffected: the
  SDK's `ViuFlowFrameworkWebAssets` copies from the SDK package's own `assets/` folder instead.
- **`.NET 11` is not supported** — the `KnownFrameworkReference` is `net10.0`-only. The
  commented-out `11.0.100-preview` line in the repo's `global.json` is a parked experiment.
- **Only one framework family exists** — `$(ViuFrameworkName)` is built to host additional families
  (a server/SSR one is named in a comment), but only `Assimalign.Viu.App` is registered.
- **`@(ViuFrameworkPrivateAssembly)` is empty** — the runtime-pack-only bucket is wired but ships
  nothing.

## See also

- [The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md) — the narrative walkthrough.
- [Quick Start](../guide/quick-start.md) — a project from nothing to running.
- [SFC CSS Features](../guide/scaling-up/sfc-css-features.md) — what the CSS bundle contains.
- [Compiler Diagnostics](./diagnostics.md) — the generator diagnostic catalog.
- [Project Status](../roadmap/status.md) — area-by-area coverage.
