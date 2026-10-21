# Application API

Compose a Viu application's components, services, diagnostics, and host lifetime before it starts.

> **Status:** Implemented. Browser generated defaults and DI-first Cohesion SSR are supported.

## The whole bootstrap

```csharp
using Assimalign.Viu;
using Assimalign.Viu.Browser;
using Assimalign.Viu.Components;

await new BrowserApplicationBuilder()
    .ConfigureApplication(options => options.RootComponent = ComponentNode.For<App>())
    .Build()
    .RunAsync();
```

`App` is a generated template component in the application's namespace. Import that namespace
when Program uses top-level statements. The builder uses `#app` and generated component catalogs
by default; `RunAsync` starts the application, waits for shutdown, and stops it.

## `BrowserApplicationBuilder`

| Member | Purpose |
| --- | --- |
| `ConfigureApplication(Action<ApplicationOptions>)` | Compose the immutable root, resolvers, services, state, and diagnostics. |
| `ConfigureBrowser(Action<BrowserApplicationOptions>)` | Select the mount target and hydration strategy. |
| `Build()` | Snapshot composition and create the Browser application. |

Generated catalog publication includes referenced assemblies at compile time. When Components
retains its default, Build populates it; an assigned factory takes precedence and is never
automatically supplemented. Use `ComponentFactory.RegisterGeneratedComponents()` when owning
an explicit factory. No assembly scanning occurs.

## `ApplicationOptions`

| Property | Contract |
| --- | --- |
| `RootComponent` | Required immutable `VirtualNode` root. |
| `Components` | Borrowed `IComponentFactory`. |
| `Services` | Optional borrowed `IServiceProvider`; resolve via `ComponentContext.Services`. |
| `State` | Optional borrowed `IStateStoreRegistry`. |
| `Directives` | Optional explicit `IDirectiveResolver`; Browser supplies its default directives. |
| `WarnHandler` | `Action<string>` warning channel. |
| `ErrorHandler` | Exception, source component context, and information string. |
| `EventObserver` | Context, event name, and immutable argument list after component dispatch. |

Composition freezes at Build. The application unmounts its components on disposal but does not
dispose borrowed services, state, or resolvers. The external composition root owns them.

## Browser startup and hydration

`BrowserApplicationOptions.MountTargetSelector` defaults to `#app`. Set `Hydrate=true` to adopt
server-rendered markup instead of mounting a new tree. Browser initializes its packaged
`viu-dom.js` bridge before resolving the target. Ordinary startup does not require an explicit
`BrowserRuntime.InitializeAsync` call.

Lower-level BrowserRuntime APIs are intended for embedding and custom hosts. They bypass the
top-level application lifetime and middleware. Prefer the builder for an ordinary application.

## Application lifetime and middleware

`IApplication` exposes start, stop, disposal, a frozen context, and middleware registration.
`Use` decorates the complete live application lifetime after Build; it does not mutate composition.
Register middleware before execution starts. Applications are single-use; stopping does not make
the same application restartable. `IApplicationContext` exposes `IsRunning` and `Stopping`.

## Cohesion browser composition

```csharp
using Assimalign.Cohesion.Viu.Hosting;
using Assimalign.Cohesion.Viu.Hosting.Browser;
using Assimalign.Cohesion.Viu.Routing;
using Assimalign.Viu.Router;

ViuApplicationBuilder builder = ViuApplication.CreateBuilder();
builder.Services.AddComponents();
builder.Services.AddRouting(routing =>
{
    routing.Routes.Add("/", "HomePage", "Home");
    routing.Routes.Add<AboutPage>("/about", "About");
});
builder.UseRootComponent<App>();
builder.ConfigureBrowser();

await using ViuApplication application = builder.Build();
await application.UseRouter().RunAsync();
```

`AddComponents()` requests generated aggregation alongside other contributions. With no factory
or contributions, the Cohesion builder also defaults to generated catalogs. An explicitly assigned
factory wins. `UseRootComponent<T>()` is equivalent to assigning `ComponentNode.For<T>()`.

## Routes

The route extensions operate on `ICollection<RouteRecord>`, including `routing.Routes`:

```csharp
using System.Collections.Generic;

using Assimalign.Viu.Router;

List<RouteRecord> routes = [];
routes.Add("/", "HomePage", "Home");
routes.Add<AboutPage>("/about", "About", name: "about");
```

Both create ordinary eager RouteRecords. The default name is the registered component name;
`title` replaces `meta["title"]` in a copied dictionary. Null preserves an existing metadata
title. Optional children, metadata, argument resolver, and explicit name remain available.
The generic form requires an `IComponentDefinition` whose reference has a registered name.
Use constructors for more specialized route records, and service-aware `AddRoutes` when needed.

## Cohesion Web assets and server rendering

```csharp
using Assimalign.Cohesion.Viu.Server;
using Assimalign.Cohesion.Web.Hosting;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Services.AddViuServerRendering(rendering => rendering.UseRootComponent<ServerReport>());
builder.Services.AddViuClient();

await using WebApplication application = builder.Build();
application.UseViuServerRenderer(context => context.Request.Path.Value == "/report");
application.UseViuApplication();
await application.RunAsync();
```

Reference the host-neutral ServerReport component project with `ViuServerRendering=true`.
Server component and render catalogs are generated defaults. The Web host owns runtime start,
stop, and disposal; each accepted render gets fresh contexts and an asynchronous DI scope in the
Web container. Component services resolve from that scope. It is separate from other middleware
scopes; request-specific routing and injecting HTTP data remain application policy.

`ViuServerRenderingOptions` captures RootComponent, optional Components and ServerRenders,
DocumentShell, State, Directives, and diagnostics at Web build. Components and ServerRenders
replace their generated defaults independently; the render registry then freezes. A DocumentShell
factory receives HTTP context. Explicit state/directive instances are borrowed and shared.

Place SSR before the SPA fallback, as above. If assets precede SSR, call `options.UseClientOutput()`
and disable `EnableSpaFallback` in the `AddViuClient` callback. Predicate-only
`UseViuServerRenderer` requires a built Cohesion WebApplication. Existing adaptor and borrowed
ViuApplication overloads remain supported for custom ownership and request-root policies.

## Standalone server catalogs

For a host that owns the lower-level renderer:

```csharp
using Assimalign.Viu.Components;
using Assimalign.Viu.ServerRenderer;

ComponentFactory components = new();
components.RegisterGeneratedComponents();
ServerRenderRegistry serverRenders = new();
serverRenders.RegisterGeneratedRenders();
```

Populate render catalogs before freezing the registry. The ServerRenderer package provides the
host-neutral adaptor; Cohesion's DI-first API supplies its request scope and response integration.

## Scheduler

Core's scheduler deduplicates jobs and orders pre-flush work, component updates, host commits,
and post-flush work. Use `context.Watch` for a component-owned pre-flush watch. A hand-created
`Reactive.Watch` defaults to synchronous delivery unless options supply scheduling.

## See also

- [Quick Start](../guide/quick-start.md)
- [Component API](component.md)
- [The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md)
