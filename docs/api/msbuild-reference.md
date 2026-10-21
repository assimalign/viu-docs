# MSBuild Reference

The consumer SDK switches and query targets for component libraries, Browser applications, and hosts.

> **Status:** Implemented. This reference follows the Viu #379 and platforms #4 package sources.

## The canonical consumer project

```xml
<Project Sdk="Assimalign.Viu.Sdk.Browser">
    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
    </PropertyGroup>
</Project>
```

Use the base `Assimalign.Viu.Sdk` for a component library. It adds no Browser runtime or
WebAssembly workload requirement. Browser imports that base SDK and adds application behavior.

## SDK resolution and versioning

Pin both Viu SDK entries in `global.json` for Browser consumers, or pin the selected SDK inline.
Keep ordinary Viu package references on the same version. Cohesion Web consumers also pin both
Cohesion SDK entries to the build used by their Cohesion.Viu packages.
See [The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md).

## Properties

| Property | Default / meaning |
| --- | --- |
| `EnableSingleFileComponentGeneration` | Enables `.viu` and compatible `.vue` compilation. |
| `ViuAutoRegisterGeneratedCatalogs` | Executables aggregate by default; libraries can opt in, and false disables module publication. Explicit catalogs remain. |
| `ViuServerRendering` | Opt into generated direct server bodies and the matching ServerRenderer package. |
| `ViuAutoIncludeAppFramework` | Suppress with false to provide an explicit base FrameworkReference. |
| `ViuAutoIncludeBrowserAppFramework` | Browser-only equivalent for the Browser framework. |
| `ViuAppFrameworkVersion` | Override the base framework version supplied by the SDK snapshot. |
| `ViuBrowserAppFrameworkVersion` | Defaults to ViuAppFrameworkVersion. |
| `ViuBundleSingleFileComponentCss` | Enables component CSS bundling/extraction. |
| `ViuSingleFileComponentCssBundleName` | Defaults to `$(PackageId).viu.css`. |
| `ViuInjectSingleFileComponentCssLink` | Browser injection defaults true; false means authoring every bundle link yourself. |
| `ViuUseFingerprintedSingleFileComponentCssBundleLink` | Defaults false; true requires a manifest-aware host. |
| `OverrideHtmlAssetPlaceholders` | WebAssembly boot placeholder rewriting; independent of Viu CSS injection. |
| `ViuCssHotReloadEnabled` | Debug watch generated-asset worker; not shipped in application output. |
| `ViuCssHotReloadDebounceMilliseconds` | Default 100 millisecond quiet period. |
| `ViuBrowserDevServer` | Defaults WasmAppHost; Custom selects an external child server. |
| `ViuBrowserDevServerCommand` / `ViuBrowserDevServerArguments` | Explicit custom server command and arguments. |
| `ViuEnableDevTools` | Defaults false; opt in alongside the separate DevTools package. |
| `ViuStaticPrerender` | Opt-in static prerender after publish. |
| `ViuStaticPrerenderProject` | Explicit server executable project for static prerender. |
| `ViuStaticPrerenderRoutes` / `ViuStaticPrerenderRoutesFile` | Routes supplied to that executable. |

Do not confuse generation, CSS bundling, and link injection: disabling one does not imply disabling
the others. Scoped CSS has no opt-in switch; use ordinary CSS or CSS Modules.

## Items

Normal ProjectReference and PackageReference items carry component libraries. Library styles flow
through either reference kind. Browser queries project references after they build and includes
transitive library CSS in its static-web-assets graph.

A Cohesion Web host marks the Browser project without referencing its managed assembly:

```xml
<ProjectReference Include="../Client/Client.csproj" ViuClient="true" />
```

The platforms targets set ReferenceOutputAssembly and Private to false, query identity, and stage
`viu-client.json`. The removed `ViuClientReference` item is a migration error; replace it and rebuild.

## Targets

| Target | Contract |
| --- | --- |
| `ViuBundleCss` | Produce the deterministic component stylesheet. |
| `GetViuComponentLibraryStyles` | Base-SDK library styles, including transitive project-reference flow. |
| `GetViuBrowserClientInfo` | Read-only Browser identity and absolute output/manifest paths. |

Browser injects referenced-library links in ordinal order before the app stylesheet during Build
and Publish, preserving matching authored links. Query output loses foreign task metadata before
becoming Content, so CSS survives compression and endpoint processing.

## `GetViuBrowserClientInfo`

The Browser SDK returns one item identified by the absolute client project path:

| Metadata | Value |
| --- | --- |
| `IsViuBrowserApplication` | true |
| `AssemblyName` | Managed assembly name. |
| `TargetFramework` | Selected TFM. |
| `TargetPath` | Absolute managed assembly path. |
| `OutputDirectory` | Absolute output directory. |
| `StaticWebAssetsRuntimeManifestPath` | Runtime manifest path in that directory. |
| `StaticWebAssetsEndpointsManifestPath` | Endpoints manifest path in that directory. |

```powershell
dotnet msbuild Client/Client.csproj -t:GetViuBrowserClientInfo -getTargetResult:GetViuBrowserClientInfo
```

The query computes paths without building or guaranteeing files exist. Build first when consuming
artifacts. Supply TargetFramework explicitly for multi-targeted clients. Base-SDK libraries do not
expose the target; an MSBuild host querying mixed references can use SkipNonexistentTargets.
Host-specific metadata such as ViuClient belongs to the host SDK, not this Viu target.

## The framework reference and package layout

The base framework is targeting-only: `Assimalign.Viu.App.Ref` supplies Components, Reactivity,
State, Core, and analyzers. Browser adds `Assimalign.Viu.App.Browser.Ref` and
`Assimalign.Viu.App.Browser.Runtime.browser-wasm`. ServerRenderer is a separate ordinary package.
The supported application TFM/RID pair is net10.0/browser-wasm.

## Contributor-only mechanisms

The framework repository's `ViuProjectReference` and shared build properties are internal
dogfooding mechanisms. Consumer projects use the packaged SDKs and ordinary references. Templates
provide supported starting points: `viu-app`, `viu-lib`, `viu-cohesion`, and `viu-cohesion-web`.

## See also

- [The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md)
- [SFC CSS Features](../guide/scaling-up/sfc-css-features.md)
- [Application API](application.md)
