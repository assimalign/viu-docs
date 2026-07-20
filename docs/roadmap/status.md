# Project Status

The authoritative record of what Viu has actually built, what is partial, what is an inert marker, and
what does not exist on disk at all.

> **Status:** Partial. This page supersedes the `PLAN.md` and `README.md` in the
> [assimalign/viu](https://github.com/assimalign/viu) repository, both of which carry stale claims.

Viu's rendering stack is real and deep. `Assimalign.Viu.Shared`, `Assimalign.Viu.Reactivity`,
`Assimalign.Viu.RuntimeCore`, `Assimalign.Viu.RuntimeDom`, the `Assimalign.Viu.Syntax.*` compiler
cluster, `Assimalign.Viu.Testing`, and the `Assimalign.Viu.Sdk` MSBuild SDK are implemented — a
version-counter reactivity engine ported from `@vue/reactivity` v3.5, a `Renderer<TNode>` with a
genuine longest-increasing-subsequence keyed diff, a handle-based WASM/JS bridge, and a full
template → transform → C# render-function compiler that runs inside a Roslyn source generator.
Four areas that the repository's plan names — Router, Store, ServerRenderer, and DevTools — **do not
exist on disk in any form**. Three Vue built-ins (`Teleport`, `KeepAlive`, `Suspense`) exist only as
marker objects that throw. Everything below is stated against the code, not the plan.

## How to read the status column

| Status | Meaning |
| --- | --- |
| **Implemented** | Shipping code with tests; the documented API behaves as described. |
| **Partial** | The core works, but a named piece of the contract is missing or inert. |
| **Marker only** | A symbol exists so the compiler can name it; using it throws at runtime. |
| **Absent** | No folder, no csproj, no source, no solution entry, no string reference anywhere. |

## Implemented areas

| Area | Assembly | Status | Evidence |
| --- | --- | --- | --- |
| Shared contracts | `Assimalign.Viu.Shared` | Implemented | `PatchFlags`/`ShapeFlags`/`SlotFlags`, `StyleAndClassNormalization`, `DomKnowledge`, `DisplayStringFormatter`, `LooseEquality`, `NumberCoercion`. |
| Reactivity | `Assimalign.Viu.Reactivity` | Implemented | `Reactive` facade, `Reference<T>`/`ShallowReference<T>`/`CustomReference<T>`/`Computed<T>`, `ReactiveEffect`, `EffectScope`, `Reactive.Watch`/`Reactive.WatchEffect`, `ReactiveList<T>`/`ReactiveDictionary<TKey,TValue>`/`ReactiveSet<T>`. |
| `[Reactive]` generator | `Assimalign.Viu.Reactivity.Generators` | Implemented | `ReactiveGenerator` emits track/trigger bodies for `partial` properties; diagnostics `VUER1001`–`VUER1004`. |
| Runtime core | `Assimalign.Viu.RuntimeCore` | Implemented, minus built-ins | `VirtualNode`/`VirtualNodeFactory`, `Renderer<TNode>`, `Scheduler`, `IComponentDefinition`, `Lifecycle`, `DependencyInjection`, `Directives`, `TemplateReference`, `Application<TNode>`, `BaseTransition`. |
| Browser runtime | `Assimalign.Viu.RuntimeDom` | Implemented | `BrowserRuntime`, `BrowserApplication`, int-handle interop bridge, `BrowserPropertyPatcher`, one pooled DOM listener per element/event/options with `BrowserEvent` marshaled in a single dispatch call, command buffer, `VShow` and the five `VModel*` directives, `Transition`/`TransitionGroup`. |
| Template compiler | `Assimalign.Viu.Syntax.Templates` | Implemented | `TemplateParser` → `Transformer` → `RenderFunctionEmitter`; every Vue 3 directive parses and compiles to C# render calls. |
| `.viu` format and generator | `Assimalign.Viu.Syntax.SingleFileComponent`, `Assimalign.Viu.Syntax.Generators` | Partial — see below | `SingleFileComponentParser` plus `SingleFileComponentGenerator` emit a compiled `Render`, the merged `@script`, and style constants. |
| CSS modules | `Assimalign.Viu.Syntax.Css`, `Assimalign.Viu.Tooling.Css`, `Assimalign.Viu.Tooling.Tasks` | Implemented | `CssModuleRewriter` renames classes at compile time, so it needs no runtime seam and works end to end. |
| CSS scoping, `v-bind()` in CSS | same | **Partial — compile-time only** | `CssSyntaxParser`, `CssScopedRewriter`, and the `ViuBundleCss` task all produce correct output, but the two runtime seams are unwired: `SetScopeId` is never invoked (no element is stamped `data-v-<hash>`, so scoped and `:slotted()` rules match nothing) and the generated `ApplyCssVariables()` is never called. See [SFC CSS Features](../guide/scaling-up/sfc-css-features.md). |
| Testing | `Assimalign.Viu.Testing` | Implemented | `ViuTest.Mount`, `ComponentWrapper`, `ElementWrapper`, `TestRenderer`, `TestSchedulerPump` — a DOM-free in-memory renderer. |
| SDK and packaging | `Assimalign.Viu.Sdk` | Implemented | `<Project Sdk="Assimalign.Viu.Sdk">` plus the `Assimalign.Viu.App.Ref` / `.Runtime.browser-wasm` shared-framework packs, version `10.0.1-preview.2`. |

This is what "implemented" buys you today — a component, a bootstrap, and a reactive re-render, with
no JavaScript framework at runtime:

```csharp
// Counter.cs
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

internal sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    // Setup runs once per instance and RETURNS the render function.
    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var count = Reactive.Reference(0);

        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(
                ("type", "button"),
                ("onClick", (Action)(() => count.Value++))),
            VirtualNodeFactory.Text($"Clicked {count.Value} times"));
    }
}
```

```csharp
// Program.cs — the whole browser bootstrap. Top-level statements must live in their own
// file; C# rejects them after a type declaration (CS8803).
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Viu.RuntimeDom;

await BrowserRuntime.InitializeAsync();

BrowserRuntime.CreateApp(new Counter()).Mount("#app");

// Keep the WASM main loop alive; rendering is reactive from here.
await Task.Delay(Timeout.Infinite);
```

## Partial: single-file components

The `.viu` pipeline is real end to end *as a compiler* and incomplete *as a runtime contract*.

- **What works** — `SingleFileComponentParser` slices a `.viu` file into `@template`, `@script`, and
  `@style` blocks; `SingleFileComponentGenerator` compiles the template through the full template
  compiler, merges the `@script` C# under a `#line` map so errors resolve back to the `.viu` file,
  and emits `ScopeId`, `ExtractedStyles`, the CSS-module accessor classes, and `ApplyCssVariables`.
- **What is missing** — the generated `partial class` carries `internal static object? Render(<the
  component's own class> _ctx, object?[] _cache)` (the emitter substitutes the class name; there is no
  generic parameter) and `internal const int RenderCacheSize`, but it does **not** implement `IComponentDefinition`
  and does not emit a `Setup`. Wiring the compiled `Render` into the component runtime — including
  the call to `ApplyCssVariables()` during setup — is separate, unlanded work.
- **No shipping example compiles a `.viu` file.** Exactly one `.viu` file exists in the repository,
  `.designing/SampleApp/App.viu`, and it is an empty design sketch. The compilation path is proven
  only by generator tests and two `CompiledRenderTests` projects that feed `.viu` source as strings
  and compile the output with Roslyn in-process.
- **Pre-processors are parsed, not run.** `lang="scss"`, `lang="less"`, and `@template lang="html"`
  are preserved on the block and then ignored; every `@style` block goes through the plain
  `CssSyntaxParser`. Nothing in the repository compiles SCSS.

See [Single-File Components (.viu)](../guide/scaling-up/single-file-components.md) for the format and
[SFC CSS Features](../guide/scaling-up/sfc-css-features.md) for the style pipeline.

## Marker only: Teleport, KeepAlive, Suspense

`RenderHelpers._Teleport`, `RenderHelpers._Suspense`, and `RenderHelpers._KeepAlive` are
`BuiltInVirtualNodeType` marker objects. They exist so the template compiler can resolve the tag
names; the runtime has no implementation for any of them. `RenderHelpers._createVNode` throws the
moment it is handed one, so the failure surfaces the first time the enclosing render function runs:

```csharp
using Assimalign.Viu.RuntimeCore;

// Compiles. Throws NotSupportedException:
//   "The built-in component <Teleport> is not yet supported by the runtime renderer."
// The props bag is irrelevant — the dispatch throws on the marker tag before reading it.
var node = RenderHelpers._createVNode(RenderHelpers._Teleport);
```

There is no `to` or `disabled` prop for Teleport, no async boundary or `#fallback` slot handling for
Suspense, and no component cache for KeepAlive. Do not treat the surrounding scaffolding as support:
`ShapeFlags.Teleport`, `ShapeFlags.Suspense`, `ShapeFlags.ComponentShouldKeepAlive`, and
`ShapeFlags.ComponentKeptAlive` are declared and `ShapeFlagsExtensions` exposes `IsTeleport`,
`IsSuspense`, `ShouldKeepAlive`, and `IsKeptAlive` predicates, but nothing in the renderer ever sets
or reads them. The upstream counterparts are Vue's
[`<Teleport>`](https://vuejs.org/guide/built-ins/teleport.html),
[`<KeepAlive>`](https://vuejs.org/guide/built-ins/keep-alive.html), and
[`<Suspense>`](https://vuejs.org/guide/built-ins/suspense.html).
[KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md) documents the workarounds
available today. `Transition` and `TransitionGroup` are the two built-ins that *are* implemented —
see [Transition & TransitionGroup](../guide/built-ins/transition.md).

## Registered but never invoked

These members accept your registration, store it, and then do nothing. Each compiles cleanly, which
is exactly why they need to be named here. The last row is an `internal` field you cannot set from
consumer code; it is listed because its inertness is observable.

| Member | Behavior today |
| --- | --- |
| `Lifecycle.OnActivated` / `Lifecycle.OnDeactivated` | The hooks are stored, but nothing ever invokes them — they only fire under a KeepAlive parent, and KeepAlive is a marker. |
| `Lifecycle.OnServerPrefetch` | The hook is stored; there is no server renderer to await it. Inert in client-only rendering. |
| `ApplicationConfiguration.Performance` | Settable and ignored. The instrumentation ships with the devtools work. |
| `RendererOptions<TNode>.SetScopeId` | Declared for scoped styles; the renderer never calls it. |
| `RendererOptions<TNode>.CloneNode` / `QuerySelector` | Declared as optional node-ops; never invoked by the current renderer. |
| `BrowserEventInvokerRegistry.ErrorSink` (internal) | Still a `Debug.WriteLine` placeholder — `ApplicationConfiguration.ErrorHandler` is not yet wired to it, so handler exceptions are invisible in a Release WASM build. |

```csharp
using System;

using Assimalign.Viu.RuntimeCore;

// Compiles, registers, and never runs — there is no KeepAlive to activate this component.
Lifecycle.OnActivated(() => Console.WriteLine("never printed"));

// Compiles, registers, and never runs — there is no server renderer.
Lifecycle.OnServerPrefetch(async () => await LoadAsync());
```

## Absent entirely

For each of the four libraries below the evidence is identical and total: **no folder under
`libraries/`, no csproj, no source file, no entry in `Assimalign.Viu.slnx`, and no CI workflow.** The
only place their names appear at all is `docs/PLAN.md`, which schedules them; no source or build file
in the tree references them. The nine path-filtered CI workflows are `area-shared`,
`area-reactivity`, `area-runtimecore`, `area-runtimedom`, `area-syntax`, `area-generators`,
`area-testing`, `area-packaging`, and `webapp` — there is no workflow for any of these.

| Planned library | Vue counterpart | Planned scope |
| --- | --- | --- |
| `Assimalign.Viu.Router` | [vue-router](https://router.vuejs.org/) | Route table and matcher, history integration, `RouterView`/`RouterLink`, navigation guards, lazy route components. |
| `Assimalign.Viu.Store` | [Pinia](https://pinia.vuejs.org/) | Store definition over `EffectScope`, state/getters/actions, SSR serialization, plugins. |
| `Assimalign.Viu.ServerRenderer` | [`@vue/server-renderer`](https://vuejs.org/guide/scaling-up/ssr.html) | SSR string renderer, SSR codegen transforms, hydration walker, host-agnostic server adaptor, static prerendering. |
| `Assimalign.Viu.DevTools` | [Vue DevTools](https://devtools.vuejs.org/) | Runtime inspection protocol, reactivity timeline, inspector UI. |

A `using Assimalign.Viu.Routing;` line inside the empty `.designing/SampleApp/App.viu` sketch is the
only trace of routing in the tree. It refers to a namespace that does not exist.

Also absent, in areas that otherwise ship:

- **Functional components** — `ShapeFlags.FunctionalComponent` is declared, but the component vnode
  factory always sets `ShapeFlags.StatefulComponent`. There is no functional-component code path.
- **Async components** — there is no `defineAsyncComponent` equivalent anywhere.
- **Custom elements** — `ParserOptions`/`TransformOptions` carry an `IsCustomElement` predicate for
  the compiler, but there is no runtime Web Components integration.
- **Hydration of any kind** — `BrowserRuntime`'s mount is explicitly non-hydrating and *clears* the
  container's existing content on first mount. Server-rendered markup cannot be adopted.
- **Options API surfaces** — `Application<TNode>` exposes only `Component`, `Directive`, `Provide`,
  `Use`, `Mount`, `Unmount`, `Config`, `IsMounted`, and `RootInstance`. There is no `app.mixin`, no
  `app.version`, no `app.runWithContext`, and no `app.config.globalProperties` (deliberately — see
  [Differences from Vue 3](./vue-differences.md)).
- **Reactivity debug hooks** — no `onTrack`/`onTrigger` on `ReactiveEffect`, `Computed<T>`, or
  `WatchOptions`; no `onRenderTracked`/`onRenderTriggered` lifecycle slots.
- **Runtime `reactive()` / `readonly()`** — object reactivity exists only through the compile-time
  `[Reactive]` and `[ShallowReactive]` attributes. There is no `Reactive.ToRefs(obj)` and no
  string-key `toRef(obj, "key")`, both omitted for AOT safety.
- **Element-level HTML and statement-level JavaScript parsing** — `HtmlSyntaxParser` and
  `JavaScriptSyntaxParser` are explicit scaffolds that return a single node holding the entire raw
  source with no diagnostics.

## Forward-looking seams that consume nothing

These exist so the eventual work has somewhere to attach. None of them constitutes support, and none
changes behavior if you set it.

| Seam | Reality |
| --- | --- |
| `TransformOptions.Ssr` / `InSSR` | Threaded through and honored by individual transforms, but there is no SSR transform preset and no SSR emitter. Setting `Ssr = true` produces no server-render output. |
| `DomKnowledge.IsSsrSafeAttributeName` | A working predicate with no SSR renderer to call it. |
| `PatchFlags.NeedHydration` | Honored only insofar as it excludes a vnode from block collection. |
| `ShapeFlags.Teleport` / `.Suspense` / `.ComponentShouldKeepAlive` / `.ComponentKeptAlive` | Declared with predicates; never set, never read. |
| `Scheduler.FlushBoundaryCallback` (internal) | The command-buffer seam; RuntimeCore leaves it null, RuntimeDom arms it. Not settable from consumer code. |
| `TransformContext.Hoist` / `TransformResult.Hoists` | Reserved; the static-optimization pass routes everything through the per-instance `_cache` slot, so `Hoists` is always empty. |
| `TransformOptions.CacheHandlers` | Honored by the v-on transform but kept off — upstream's `(...args) => …` wrapper has no C# spelling yet. |

## Tooling gaps

- **No `dotnet new` template** — `dotnet new viu-app` does not exist and there is no `templates/`
  directory. A consumer hand-authors the csproj, `global.json`, `nuget.config`, `Program.cs`,
  `wwwroot/index.html`, and `wwwroot/main.js`. See [Quick Start](../guide/quick-start.md).
- **No public feed** — nothing is published to nuget.org. The only distribution is the gitignored
  repo-local `_out/packages` feed produced by `scripts/Install-Local.ps1`.
- **The consumer path is not CI-verified** — `area-packaging.yml` asserts only that three `.nupkg`
  files exist by filename glob. Nothing in CI restores and builds a real SDK-consumer project.
- **No automatic CSS `<link>` injection** — hand-write the stylesheet reference in your host page.
  Automatic injection was considered and rejected because it desynchronizes the .NET SDK
  static-web-asset compression and endpoint-negotiation graph.
- **No hot reload and no dev loop** — there is no hot-reload metadata emission in the generator.
- **No `.viu` editor support** — no language server, no TextMate grammar, no IDE extension.
- **No size or AOT budget gates** — no MSBuild target, workflow, or props file enforces a WASM size
  or startup budget.
- **No benchmark suite and no browser e2e harness** — the only browser-side measurement is the ad-hoc
  `benchmark.js` plus `ViuDiagnostics.cs` in the example app, reachable via `?diagnostics=1`. Real
  focus, IME composition, and `<input type="range">` write-guard behavior are deferred to the
  unbuilt harness.
- **No generated API reference** — no docfx or mkdocs configuration exists. This documentation site
  is hand-written.
- **The framework is not strong-named** — `ViuPublicKeyToken` is hardcoded empty, so every
  `PublicKeyToken=""` in `FrameworkList.xml`/`RuntimeList.xml` is a placeholder.
- **Diagnostic ID prefixes are inconsistent after the rename** — the `.viu` generator emits twelve
  `VIU####` descriptors (origin × severity envelopes, with the per-language code carried in the
  message), while `ReactiveGenerator` still emits the pre-rename `VUER1001`–`VUER1004`. Both sets sit
  in `AnalyzerReleases.Unshipped.md` and both `AnalyzerReleases.Shipped.md` files are empty, so
  neither prefix is a frozen contract yet. See [Compiler Diagnostics](../api/diagnostics.md).

## Wave status

The project is in **early Wave 4 (Ecosystem)**. All Wave 1–3 work has landed: shared contracts,
reactivity, the VNode model, renderer and scheduler, the DOM bridge, the component model, the full
template compiler and codegen generator, the `.viu` format and its MSBuild integration, the command
buffer, `v-model`/`v-show`, static hoisting, and diagnostics. The Wave 4 items delivered so far are
`BaseTransition`, the DOM `Transition`/`TransitionGroup`, CSS modules, the CSS construction surface,
`ViuBundleCss`, and the Viu rename (`V01.01.12.18`, itself a Wave 4 item). Scoped CSS and `v-bind()`
in CSS are delivered **as compiler work only** — both still need their runtime seam wired before they
do anything in a browser (see the Implemented table above). One Wave 5 item landed out of wave order:
the SDK/shared-framework packaging model (`V01.01.12.19`).

**The plan's exit demos are not met.** `PLAN.md` names TodoMVC built from render functions as the
Wave 2 exit demo and TodoMVC rewritten as `.viu` components as the Wave 3 exit demo. Neither exists.
The Wave 4 HackerNews-style sample does not exist. The only example application in the repository is
a stopwatch, written entirely with hand-written `VirtualNodeFactory` calls — see
[Stopwatch](../examples/stopwatch.md).

## The repository's own PLAN.md and README.md are stale

Both documents predate large parts of the current code and will mislead you. Specifically:

- **`PLAN.md` says reactivity is absent** and that the demo polls every 100 ms. Reactivity is
  implemented; the stopwatch uses `Reference<T>` and relies on equal-value writes not notifying.
- **`PLAN.md` denies a component model and a scheduler.** Both exist — `IComponentDefinition` /
  `ComponentInstance` and `Scheduler` with `NextTick`.
- **`PLAN.md` describes index-based child reconciliation with no LIS.** The renderer runs a genuine
  longest-increasing-subsequence pass, the direct port of upstream's `getSequence`.
- **Both reference removed type names.** `PLAN.md` names `VirtualDomRenderer<TNode>`,
  `IVirtualDomAdapter<TNode>`, `VElement`, `VText`, and `VFragment`; `README.md` still describes the
  renderer as `VirtualDomRenderer<TNode>` over an injected adapter. The current types are
  `Renderer<TNode>`, `RendererOptions<TNode>`, and `VirtualNode` / `VirtualNodeType`. `README.md` is
  otherwise accurate — its SDK and shared-framework paragraphs match the shipped packaging.
- **The GitHub repo slug is `assimalign/viu`.** `PLAN.md` still references the pre-rename `vuecs`
  slug. Upstream Vue references — `@vue/*` package names, vuejs.org links, and the `vue:` template
  prefix — are deliberately untouched and should not be "fixed" to Viu.

## Related pages

- [Differences from Vue 3](./vue-differences.md) — the naming map and the behavioral divergences.
- [KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md) — the marker built-ins
  and what to do instead.
- [Watchers](../guide/essentials/watchers.md) — the sync-default flush divergence, the most likely
  behavioral surprise on this list.
- [The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md) and
  [MSBuild Reference](../api/msbuild-reference.md) — what the SDK does and does not do.
- [AOT & Trimming](../guide/best-practices/aot-and-trimming.md) — the constraint behind most of the
  absences above.
