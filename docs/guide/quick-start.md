# Quick Start

Create a Viu WebAssembly app, understand its files, and run it in the browser.

> **Status:** Implemented for the Viu PR #379 package. Packages are available through the
> Assimalign GitHub Packages feed; see [Project status](../roadmap/status.md) for preview limits.

Viu's counterpart to Vue's [Quick Start](https://vuejs.org/guide/quick-start.html) uses .NET's
project SDK and template machinery. A generated `.viu` component is a runnable component.

## Prerequisites

- .NET SDK 10 and `net10.0`.
- The WebAssembly workload: `dotnet workload install wasm-tools`.
- Access to the Assimalign feed. Supply `NuGetPackageSourceCredentials_assimalign` through the
  environment; never put a token in a project or NuGet configuration file.

## Create a project from the template

Install the template package from the same feed as the SDK:

```powershell
dotnet new install Assimalign.Viu.Templates::10.0.0-preview.0.pr.379.6 --nuget-source https://nuget.pkg.github.com/assimalign/index.json
dotnet new viu-app --name MyApp
cd MyApp
dotnet run
```

`viu-lib` creates a host-neutral component library. `viu-app --ssr` creates a Browser app with
shared components and an ASP.NET server-rendering host. For Cohesion hosting, see
[The Viu SDK & Build](scaling-up/sdk-and-build.md#cohesion-hosting).

The following walkthrough shows the files behind the Browser template.

## The project layout

```text
MyApp/
  MyApp.csproj
  global.json
  NuGet.config
  Program.cs
  App.viu
  wwwroot/
    index.html
    main.js
```

## Step 1: `MyApp.csproj`

```xml
<Project Sdk="Assimalign.Viu.Sdk.Browser">
    <PropertyGroup>
        <TargetFramework>net10.0</TargetFramework>
        <RootNamespace>MyApp</RootNamespace>
        <OverrideHtmlAssetPlaceholders>true</OverrideHtmlAssetPlaceholders>
    </PropertyGroup>
    <ItemGroup>
        <StaticWebAssetFingerprintPattern Include="JS" Pattern="*.js" Expression="#[.{fingerprint}]!" />
    </ItemGroup>
</Project>
```

The Browser SDK chains the host-neutral `Assimalign.Viu.Sdk` and the WebAssembly SDK. It supplies
the generators, runtime bridge, component CSS delivery, and Browser framework. The base SDK alone
is for component libraries; it does not turn a project into a browser executable.

## Step 2: `global.json`

Pin both Viu SDKs to the same build:

```json
{
    "msbuild-sdks": {
        "Assimalign.Viu.Sdk": "10.0.0-preview.0.pr.379.6",
        "Assimalign.Viu.Sdk.Browser": "10.0.0-preview.0.pr.379.6"
    }
}
```

The optional `sdk` section separately selects the .NET SDK. PR packages are temporary: after
the upstream PR merges, move both pins and any Viu package references to the same merged build.

## Step 3: `NuGet.config`

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
    <packageSources>
        <clear />
        <add key="assimalign" value="https://nuget.pkg.github.com/assimalign/index.json" />
        <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    </packageSources>
</configuration>
```

The source name `assimalign` matches the credential environment variable. For framework
development, `scripts/Install-Local.ps1` in the Viu repository can instead pack a local feed.
Use the version actually produced by that pack when selecting SDKs and templates.

## Step 4: `wwwroot/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <base href="/">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MyApp</title>
    <link rel="preload" id="webassembly">
    <script type="importmap"></script>
    <script type="module" src="main#[.{fingerprint}].js"></script>
</head>
<body>
    <main id="app"></main>
</body>
</html>
```

The WebAssembly SDK resolves the boot placeholders because `OverrideHtmlAssetPlaceholders` is
enabled. Viu injects component stylesheet links independently of that switch. No authored
`MyApp.viu.css` link is needed.

## Step 5: `wwwroot/main.js`

```js
import { dotnet } from './_framework/dotnet.js'

const { runMain } = await dotnet.create()
await runMain()
```

Managed startup initializes `/_content/Assimalign.Viu.Browser/viu-dom.js`. Do not import or copy
that bridge yourself.

## Step 6: `Program.cs`

```csharp
using Assimalign.Viu;
using Assimalign.Viu.Browser;
using Assimalign.Viu.Components;

using MyApp;

await new BrowserApplicationBuilder()
    .ConfigureApplication(options => options.RootComponent = ComponentNode.For<App>())
    .Build()
    .RunAsync();
```

The builder selects `#app` by default and populates the generated component catalogs, including
referenced libraries. `ComponentNode.For<App>()` describes the root without constructing it.
`RunAsync` owns the live application lifetime; an artificial infinite delay is unnecessary.
An explicitly assigned `ApplicationOptions.Components` factory replaces automatic population.

## Step 7: `App.viu`

```viu
<template>
    <section class="counter">
        <p>Count: {{ Count }}</p>
        <button type="button" @click="Increment">+1</button>
    </section>
</template>

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count { get; } = Reactive.Reference(0);
    private void Increment() => Count.Value++;
}

<style>
.counter { font-family: system-ui, sans-serif; }
</style>
```

`App.viu` generates a partial component class in `MyApp`. Its template reads `Count.Value`;
C# code still writes `.Value` explicitly. Each mount gets its own component instance and state.
See [Single-File Components](scaling-up/single-file-components.md) for generated definitions,
custom registered names, parameters, and lifecycle hooks.

## Step 8: the CSS bundle and `.gitignore`

The Browser SDK bundles component styles and injects library links before the application bundle.
Both PackageReference and ProjectReference libraries participate. Ordinary styles are global;
use [CSS Modules](scaling-up/sfc-css-features.md#css-modules) for local class names.

Keep build output out of source control:

```gitignore
bin/
obj/
wwwroot/_content/
wwwroot/_framework/
```

## Build and run

```powershell
dotnet build
dotnet run
dotnet publish -c Release
```

Use `dotnet watch` for the development loop. Style-only changes replace the stylesheet link;
accepted template and script updates remount affected components.

## When it goes wrong

| Symptom | Check |
| --- | --- |
| SDK or package restore fails | Feed credentials and matching base/Browser SDK versions. |
| Browser workload errors | Install `wasm-tools` for the selected .NET SDK. |
| Root cannot resolve | Leave the generated factory default, or populate your explicit factory. |
| A library type is inaccessible | Add an authored `public partial class` companion in that library. |
| CSS is missing | Check bundling/link injection properties and the static-web-assets manifest. |

## Next steps

- [Components](essentials/components.md) — definitions, invocations, and registration.
- [Form Input Bindings](essentials/form-bindings.md) — typed native `v-model`.
- [The Viu SDK & Build](scaling-up/sdk-and-build.md) — libraries and Cohesion hosting.
- [Project Status](../roadmap/status.md) — implemented behavior and remaining limits.
