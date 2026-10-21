# Assimalign.Viu.Docs

`Assimalign.Viu.Docs` is the build-time micro-frontend package for the Viu documentation. It owns
the generated 45-page Markdown catalog, HTTP content source, renderer, `/viu` route subtree, and
navigation projections consumed by the shared Assimalign documentation shell.

The package is host-neutral: it does not define a shell, landing page, Web server, or deployment
resource. A browser host supplies an `HttpClient` whose base address is the host document, registers
the module in its services, and serves the package's transitive static content.

The public entry point is `ViuDocsMicroFrontend`. Its descriptor identifies the module as `viu`,
selects the Viu brand accent, and reports the package informational version.

## Consuming the package

Reference `Assimalign.Viu.Docs` version `1.0.0-preview.2`, create the module with the browser
host's base-addressed `HttpClient`, and add it in the application's services:

```csharp
builder.Services.AddComponents();
builder.Services.AddFrontendComponents();
builder.Services.AddMicroFrontends(microFrontends => microFrontends
    .UseShell(ComponentReference.ForName("AppShell"))
    .Add(new ViuDocsMicroFrontend(httpClient)));

await using ViuApplication application = builder.Build();
await application.UseRouter().RunAsync();
```

`AddMicroFrontends` contributes the module's components and routes and registers the router; the
host adds any landing route with `builder.Services.AddRouting`. The host document links the shared
components utility stylesheet and imports the shared frontend JavaScript helper.

`AddComponents()` contributes generated application/reference catalogs. The shared frontend's
explicit contributions remain necessary for this frontend build, whose internal AppShell is
selected by registered name. Use typed `routes.Add<T>()` for public generated page definitions,
and `routes.Add(path, componentName, title)` for named pages. Existing nested RouteRecords remain
available for specialized composition.

The standalone Web host uses a normal `ProjectReference` marked `ViuClient="true"` and
`services.AddViuClient()`; rebuilding stages the inferred client identity in `viu-client.json`.
Server-rendered consumers compose `services.AddViuServerRendering(...)` in their Web container
and use predicate-only `UseViuServerRenderer`. The documentation package itself owns neither host.

Markdown assets are packed under `content/docs/` with the Viu Markdown build's default hashed names
(the first twelve hex digits of the SHA-256 of the forward-slash source path, plus `.md`). The
transitive frontend build contract links them into a consuming browser application's `wwwroot` at
`/_content/Assimalign.Viu.Docs/docs/<asset>.md`, which is where the generated catalog fetches them.
