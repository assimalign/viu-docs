# The Viu SDK & Build

Choose the right SDK for libraries and Browser apps, then compose a development or Web host.

> **Status:** Implemented. PR packages cover generated catalogs, referenced styles, and Cohesion hosting.

## The minimal project

Use `Assimalign.Viu.Sdk` for a host-neutral library and `Assimalign.Viu.Sdk.Browser` for a browser
application. Both compile components; only Browser adds WebAssembly, DOM interop, application
static assets, and the browser runtime framework.

```xml
<Project Sdk="Assimalign.Viu.Sdk">
    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
    </PropertyGroup>
</Project>
```

A base-SDK library needs no `wasm-tools` workload. To make it server-renderable, set
`ViuServerRendering=true`. This adds the matching ServerRenderer package and generated direct
server render bodies; it is a project-level choice, not a per-file switch.

Browser-specific templates still need Browser types. Native `v-model` and event modifier wrappers
reference `Assimalign.Viu.Browser`; the base SDK does not implicitly add that package. Keep portable
components on host-neutral contracts, or add an explicit Browser reference for Browser behavior.

## How the SDK is resolved

NuGet's MSBuild SDK resolver reads `global.json`. Pin the base and Browser entries to the same
Viu version in app repositories. The Browser SDK imports the base SDK through an unversioned
import, so pinning only Browser is insufficient. See [Quick Start](../quick-start.md).

## What arrives implicitly

| SDK | Contents |
| --- | --- |
| Base | Targeting-only `Assimalign.Viu.App`, component/reactivity generators, library CSS extraction and packing. |
| Browser | Base SDK plus `Assimalign.Viu.App.Browser`, browser-wasm runtime pack, bridge, CSS link injection, development loop, publish budgets. |

`Assimalign.Viu.ServerRenderer` is an ordinary opt-in package. It is not a third framework family.
UtilityCss and DevTools are separate optional packages.

## Generated component catalogs

Executable compilations publish their own and referenced catalogs by default. Browser builders
populate a generated factory unless supplied an explicit factory. Other hosts call
`ComponentFactory.RegisterGeneratedComponents()` and
`ServerRenderRegistry.RegisterGeneratedRenders()`. Full assembly identity makes shared namespaces
and diamond references unambiguous; different registrations with conflicting names fail.

Libraries can opt into publication with `ViuAutoRegisterGeneratedCatalogs=true`. Any project can
disable publication with `false` while retaining explicit `GeneratedViuComponents.Register` and
`GeneratedViuServerRenders.Register` entry points. There is no runtime reflection or assembly scan.

## Component libraries and stylesheet delivery

Base-SDK libraries carry extracted `<PackageId>.viu.css` and generated buildTransitive registration
when packed. For ProjectReference libraries, Browser builds the references first and queries
`GetViuComponentLibraryStyles`, including transitive libraries. Both forms deliver styles at
`_content/<PackageId>/<PackageId>.viu.css`.

Build and Publish inject library links in ordinal order before the application bundle. Matching
authored links are preserved without duplication; manual links are unnecessary under the default
policy. Foreign task-output metadata is removed before CSS becomes a Content item, so compression
reads the stylesheet correctly. See [SFC CSS Features](sfc-css-features.md).

Expose a generated library type with an authored `public partial class` companion if consumers
need `ComponentNode.For<T>()` or typed route helpers. Otherwise its registered name remains usable.

## Consumer-settable properties

| Property | Purpose |
| --- | --- |
| `EnableSingleFileComponentGeneration` | Enable component compilation. |
| `ViuAutoRegisterGeneratedCatalogs` | Control module publication; executables default on. |
| `ViuServerRendering` | Generate direct server renders and add ServerRenderer. |
| `ViuBundleSingleFileComponentCss` | Bundle application CSS / extract library CSS. |
| `ViuInjectSingleFileComponentCssLink` | Browser link injection, on by default. |
| `ViuUseFingerprintedSingleFileComponentCssBundleLink` | Opt into the labeled immutable app CSS endpoint. |
| `ViuCssHotReloadEnabled` | Generated stylesheet worker for the Debug watch loop. |

The [MSBuild Reference](../../api/msbuild-reference.md) describes identity queries and additional
build controls. `dotnet watch` drives generated asset regeneration; ordinary Visual Studio Hot
Reload does not invoke the same watch contract.

## Getting the packages

The repository uses Viu `10.0.0-preview.0.pr.379.6` and platforms
`10.0.0-preview.0.pr.4.8` from the Assimalign GitHub Packages feed. Provide credentials through
`NuGetPackageSourceCredentials_assimalign`. These PR pins need replacing with compatible merged
CI builds after the upstream PRs merge. Local framework development can instead use
`scripts/Install-Local.ps1` and its `_out/packages` feed.

Templates are available: `viu-app` and `viu-lib` from `Assimalign.Viu.Templates`;
`viu-cohesion` and `viu-cohesion-web` from `Assimalign.Cohesion.Viu.Templates`.
Use the same package train as the SDKs and hosting libraries.

## Cohesion hosting

The Browser client uses the Browser SDK and the Hosting, Hosting.Browser, and Routing packages:

```csharp
using Assimalign.Cohesion.Viu.Hosting;
using Assimalign.Cohesion.Viu.Hosting.Browser;
using Assimalign.Cohesion.Viu.Routing;
using Assimalign.Viu.Router;

ViuApplicationBuilder builder = ViuApplication.CreateBuilder();
builder.Services.AddComponents();
builder.Services.AddRouting(routing => routing.Routes.Add<HomePage>("/", "Home"));
builder.UseRootComponent<App>();
builder.ConfigureBrowser();

await using ViuApplication application = builder.Build();
await application.UseRouter().RunAsync();
```

In a Web project using `Assimalign.Cohesion.Sdk.Web` and
`Assimalign.Cohesion.Viu.Server`, declare a normal marked reference:

```xml
<ProjectReference Include="../Client/Client.csproj" ViuClient="true" />
```

This replaces `ViuClientReference`. Restore/build ordering follows normal project references;
the build suppresses the client assembly reference and queries `GetViuBrowserClientInfo` for
identity and manifests. Rebuild to regenerate `viu-client.json`.

```csharp
using Assimalign.Cohesion.Viu.Server;
using Assimalign.Cohesion.Web.Hosting;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Services.AddViuClient();
await using WebApplication application = builder.Build();
application.UseViuApplication();
await application.RunAsync();
```

`AddViuClient()` infers the sole marked client in development and published `wwwroot` after
publication. When supplying a callback, call `options.UseClientOutput()` to retain inference.
The explicit `UseClientOutput("Client.Assembly")` form remains available. Publishing Web also
publishes the client and bundles its complete wwwroot.

For server-rendered pages, add `builder.Services.AddViuServerRendering(...)` in that same Web
container and use predicate-only `application.UseViuServerRenderer(...)` before the SPA fallback.
Generated component/render catalogs are defaults; no second server ViuApplicationBuilder is needed.
See [Application API](../../api/application.md#cohesion-web-assets-and-server-rendering).

## See also

- [Quick Start](../quick-start.md)
- [Single-File Components](single-file-components.md)
- [SFC CSS Features](sfc-css-features.md)
- [MSBuild Reference](../../api/msbuild-reference.md)
