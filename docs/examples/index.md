# Examples

An honest inventory of the runnable example code that exists in the Viu repository today.

> **Status:** Partial. Exactly one example application ships. See [Project status](../roadmap/status.md)
> for area-by-area coverage.

Vue has [an examples gallery](https://vuejs.org/examples/) spanning dozens of demos from a counter to a
full TodoMVC. Viu does not. This page tells you precisely what exists so you never go looking for a
sample that was planned but never written.

## What ships today

There is one example project in the repository: `examples/Assimalign.Viu.WebApp`, a **stopwatch**. It
is written entirely with hand-written `VirtualNodeFactory` calls — the Viu counterpart of Vue's
[`h()`](https://vuejs.org/api/render-function.html#h) — and it does not use a `.viu` single-file
component.

| Artifact | Kind | Location | Status |
| --- | --- | --- | --- |
| Stopwatch app | Browser WASM app | `examples/Assimalign.Viu.WebApp` | Runs. Builds and mounts in a browser. |
| `StopwatchApplication` | Root `IComponentDefinition` | `StopwatchApplication.cs` | Refs, lifecycle hooks, child component, emits. |
| `ElapsedDisplay` | Child `IComponentDefinition` | `StopwatchApplication.cs` | Declared `Properties` and `Emits`. |
| `ViuDiagnostics` | Interop stress harness | `ViuDiagnostics.cs` | Reachable via a `?diagnostics=1` query string. |
| `DiagnosticsInterop` | `[JSImport]` shims for the harness | `DiagnosticsInterop.cs` | Example-only tooling; the JSObject-marshaling counterparts. |
| `benchmark.js` | Ad-hoc marshaling benchmark | `wwwroot/benchmark.js` | Not a benchmark suite; a single ADR-backing measurement. |

The full walkthrough — the render closure, the equal-value-write coalescing trick, and the same
component re-expressed as a `.viu` file — lives on the [Stopwatch](./stopwatch.md) page.

Its bootstrap is the entire browser entry point for a Viu application. This is the demo path of
`examples/Assimalign.Viu.WebApp/Program.cs`, abridged — the real file additionally imports
`benchmark.js` via `JSHost.ImportAsync` and branches into `ViuDiagnostics` when the query string
matches, which is why it also carries `using System;` and
`using System.Runtime.InteropServices.JavaScript;`:

```csharp
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new StopwatchApplication()).Mount("#app");

// Keep the WASM main loop alive; rendering is reactive from here.
await Task.Delay(Timeout.Infinite);
```

`BrowserRuntime.CreateApp` returns a `BrowserApplication`; its `Mount` takes either a CSS selector
(`Mount("#app")`) or an existing container handle (`Mount(int)`), and returns the root
`ComponentInstance?`.

Run it from a clone of the framework repository:

```sh
dotnet build Assimalign.Viu.slnx
dotnet run --project examples/Assimalign.Viu.WebApp
```

## What does not exist

The repository's own `docs/PLAN.md` names several demos as wave exit criteria. **None of them were ever
written.** If you have read that plan, correct your expectations against this table rather than that
one.

| Named in the plan | Work item | Reality |
| --- | --- | --- |
| TodoMVC built from render functions | W02 exit demo | Does not exist in any form. |
| TodoMVC rewritten as `.viu` components | W03 exit demo | Does not exist in any form. |
| HackerNews-style sample application | `V01.01.13.06`, W04 exit demo | Does not exist. |
| Sample application gallery | `V01.01.13.02` | Does not exist. There is exactly one example project. |
| Getting-started guide | `V01.01.13.03` | Does not exist in the framework repo. |
| Documentation site built by Viu itself | `V01.01.13.05`, W06 exit demo | Does not exist. |

Two related absences shape what an example could even demonstrate today:

- **There is no `dotnet new` template** — `dotnet new viu-app` does not exist and there is no
  `templates/` directory. Consumer projects are hand-authored; see [Quick Start](../guide/quick-start.md).
- **There is no public NuGet feed** — nothing is published to nuget.org. The only distribution today is
  a repo-local `_out/packages` feed produced by `scripts/Install-Local.ps1`.

## No shipping example compiles a `.viu` file

This is the single most important caveat on this page. Exactly one `.viu` file exists anywhere in the
framework repository — `.designing/SampleApp/App.viu` — and it is an empty design sketch, not a
component:

```viu
@template {

}

@script {
using Assimalign.Viu;
using Assimalign.Viu.Routing;



}
```

Note that it imports `Assimalign.Viu.Routing`, a namespace that does not exist: there is no router in
the codebase. The `.designing/` folder is a scratch design area, not a buildable project — its other
files (`SampleApp/Program.cs`, `SampleApp/Routing/Router.cs`) are zero-byte placeholders, and its
project file is deliberately parked as `SampleApp.csproj-example` so no build ever picks it up.

That does **not** mean the `.viu` pipeline is vapor. It means the pipeline is proven by tests rather
than by a sample app:

- **`Assimalign.Viu.Syntax.Generators.Tests`** — the single-file-component generator is exercised
  in-memory, feeding `.viu` source as strings and asserting the emitted partial class and its
  diagnostics (`SingleFileComponentGeneratorTests`, `SingleFileComponentScriptTests`,
  `SingleFileComponentDiagnosticMappingTests`, and siblings).
- **`Assimalign.Viu.RuntimeCore.CompiledRenderTests`** — feeds template source through the compiler and
  compiles the generated render body with `Microsoft.CodeAnalysis` in-process, then renders it. It
  carries an explicit `Assimalign.Viu.RuntimeDom` reference despite being a runtime-core test, because
  the generator emits a `using static global::Assimalign.Viu.RuntimeDom.DomRenderHelpers;` into *every*
  render-bearing `.viu` — even templates that use no DOM directive — so the generated body will not
  bind without it.
- **`Assimalign.Viu.RuntimeDom.CompiledRenderTests`** — the same proof against the DOM helper surface,
  asserting that a template using DOM directives binds against both facades.

## How to read the `.viu` examples in this documentation

`.viu` examples appear throughout the [Guide](../guide/index.md) — in
[Single-File Components](../guide/scaling-up/single-file-components.md),
[Components](../guide/essentials/components.md), and the Essentials chapters. Read them under this
contract:

- **They are grounded in implemented behavior** — the directives, block header rules, and generated
  members they rely on are backed by the shipping template compiler, the `.viu` parser, and the source
  generator, all of which are implemented. The exception is the component-like built-ins: `Teleport`,
  `Suspense`, and `KeepAlive` exist only as inert `BuiltInVirtualNodeType` markers in
  `RenderHelpers` with no renderer support, so nothing that reaches them renders. Router, store, SSR,
  hydration, and DevTools do not exist in the repository at all.
- **They represent the target authoring experience** — they show how Viu is meant to be written, which
  is the point of documenting a framework rather than cataloguing a demo folder.
- **They are not copied from a runnable sample app** — no example application in the repository
  compiles a `.viu` file, so these snippets have not been exercised as part of a running program.
- **Anything genuinely unbuilt is labelled inline** — a `> **Status:**` callout or a "Not yet
  implemented" tail marks it, and [Project status](../roadmap/status.md) is the authoritative list.

## Working code you can run today

Two places to look, and they are verified in different senses — the distinction matters.

**The stopwatch.** Hand-written `VirtualNodeFactory` calls, a real reactive root component, a child
component fed by declared `Properties` and reporting back through `Emits`. It is the best available
reference for the render-function authoring style. **No unit test covers it** — nothing in any test
project references `StopwatchApplication`. What it does have is the in-browser `?diagnostics=1`
harness, which mounts and unmounts it 25 times in both direct and command-buffer mode and asserts the
interop registries return to their pre-mount baseline. That is a leak check run by hand in a browser,
not a passing CI test suite. See [Stopwatch](./stopwatch.md) and
[Render Functions & VirtualNode](../api/render-function.md).

**The testing library.** `Assimalign.Viu.Testing` is the port of
[`@vue/test-utils`](https://test-utils.vuejs.org/) over a DOM-free in-memory renderer, and its own test
suite — `ComponentWrapperTests.cs` and `TestRendererTests.cs`, about 400 lines in total — is verified,
executable component code. These two facts are verbatim from `ComponentWrapperTests`, which declares
`using Shouldly; using Xunit; using Assimalign.Viu.Reactivity; using Assimalign.Viu.RuntimeCore;` and
defines `CounterComponent`, `HostComponent`, and `SelectorComponent` as private nested
`IComponentDefinition` classes:

```csharp
[Fact]
public void Mount_RendersComponent_ExposesHtmlTextAndInstance()
{
    using var wrapper = ViuTest.Mount(new CounterComponent());

    wrapper.Instance.ShouldNotBeNull();
    wrapper.Exists().ShouldBeTrue();
    wrapper.Html().ShouldBe("<div class=\"counter\"><span class=\"count\">0</span><button>+</button></div>");
    wrapper.Text().ShouldBe("0+");
}

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
```

`ViuTest.Mount` returns a `ComponentWrapper` exposing `Html()`, `Text()`, `Find`/`Get`,
`FindComponent<T>`/`GetComponent<T>`, `Emitted`, `Trigger`, `SetValue`, `NextTickAsync`, and
`FlushAsync`. Full coverage is in [Testing](../guide/scaling-up/testing.md).

## Do not copy the example's project file

`examples/Assimalign.Viu.WebApp` is **in-repo dogfooding infrastructure, not a consumer template.** Its
project file uses `ViuProjectReference` and `$(TargetFrameworkLatest)`, repository-internal mechanisms
defined in `build/Targets/Build.References.Projects.targets` and `build/Targets/Build.TargetFramework.props`
respectively. They resolve against sibling projects in the framework solution and are undefined outside
it, so a copied project file simply fails to evaluate. (`Microsoft.NET.Sdk.WebAssembly` is *not* the
problem — it is an in-box Microsoft SDK, and `Assimalign.Viu.Sdk` chains through it.) Abridged; the real
file also sets `AllowUnsafeBlocks`, `OverrideHtmlAssetPlaceholders`, and a
`StaticWebAssetFingerprintPattern`:

```xml
<!-- In-repo dogfooding. Do NOT copy this into your own application. -->
<Project Sdk="Microsoft.NET.Sdk.WebAssembly">
  <PropertyGroup>
    <TargetFramework>$(TargetFrameworkLatest)</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <ViuProjectReference Include="Assimalign.Viu.RuntimeDom" />
  </ItemGroup>
</Project>
```

A real consumer project is the `Assimalign.Viu.Sdk` shape, and it is much shorter:

```xml
<Project Sdk="Assimalign.Viu.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
</Project>
```

That shape is real and is the documented consumer entry point, but remember the feed caveat above: with
nothing on nuget.org, `Sdk="Assimalign.Viu.Sdk"` only resolves against the repo-local `_out/packages`
feed that `scripts/Install-Local.ps1` produces. The full consumer setup — `global.json` SDK pinning,
`nuget.config`, `wwwroot/index.html`, and `wwwroot/main.js` — is in
[Quick Start](../guide/quick-start.md), and the SDK's own properties and targets are documented in
[The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md).

## Where the missing examples sit

Every demo listed above as absent is roadmap work, not a documentation gap. The wave-by-wave picture,
including which libraries exist and which are marker-only or absent entirely, is on
[Project Status](../roadmap/status.md). If you are arriving from Vue and want to know which
differences are deliberate rather than unbuilt, start with
[Differences from Vue 3](../roadmap/vue-differences.md).
