# Viu documentation

This repository owns the source documentation for Viu, the `Assimalign.Viu.Docs` build-time
micro-frontend package, and a standalone client/Web host used to develop and verify that package.
The production `docs.assimalign.com` landing zone consumes the package and supplies orchestration.

## Repository layout

```text
global.json                                .NET, Cohesion SDK, and Viu SDK selection
NuGet.config                               GitHub Packages feed and local cache
Directory.Build.props                      Viu, Cohesion Viu, and shared frontend package pins
docs/                                      45 authored Markdown pages
packages/Assimalign.Viu.Docs/src/            host-neutral micro-frontend package
packages/Assimalign.Viu.Docs/test/           package contract tests
packages/Assimalign.Viu.Docs/build/          project-reference content registration
packages/Assimalign.Viu.Docs/docs/           package overview and design
app/Assimalign.Viu.Docs.App/                 shared-shell Browser client, generated catalog defaults
app/Assimalign.Viu.Docs.Web/                 Cohesion Web host, marked client ProjectReference
azure-pipelines.yml                        Build, test, pack, and Push pipeline
```

## Version line

- Viu SDK and router: `10.0.0-preview.0.pr.379.6` ([Viu #379](https://github.com/assimalign/viu/pull/379))
- `Assimalign.Cohesion.Viu.*`: `10.0.0-preview.0.pr.4.8` ([platforms #4](https://github.com/assimalign/viu-platforms/pull/4), CI run 8)
- Cohesion SDK: `10.0.0-preview.0.ci.21`
- `Assimalign.Frontend.*`: `1.0.0-preview.1.ci.1`
- `Assimalign.Viu.Docs`: `1.0.0-preview.2`

## Local development

Every `Assimalign.*` package restores from the Assimalign GitHub Packages feed
(`https://nuget.pkg.github.com/assimalign/index.json`); no sibling checkout has to be packed first.
`NuGet.config` maps `Assimalign.Viu.*`, `Assimalign.Cohesion.*`, and `Assimalign.Frontend.*` to that
feed and everything else to NuGet.org. Restored packages stay in `.nuget/packages`.

Move the SDK/runtime/hosting pins together and verify shared frontend compatibility:

- the `Assimalign.Viu.Sdk` entry in `global.json` selects the Viu SDK, and `Directory.Build.props`
  reads it as `ViuVersion` for every Viu package reference (keep `Assimalign.Viu.Sdk.Browser` equal);
- the `Assimalign.Cohesion.Sdk` and `Assimalign.Cohesion.Sdk.Web` entries in `global.json` select
  the Cohesion build that the Cohesion Viu build pins exactly;
- `CohesionViuVersion` in `Directory.Build.props` selects the viu-platforms build;
- `FrontendVersion` in `Directory.Build.props` selects the aaln-core-frontend build, published by
  that repository's Azure pipeline as `1.0.0-preview.1.ci.<run>`.

The existing frontend `ci.1` packages remain compatible with these PR builds: solution restore/build
and package contract tests pass, and the precompiled AppShell mounts in the in-memory host with
browser-only theme interop stubbed. Keep the frontend pin; its older declared dependency versions
are minimums. After both upstream PRs merge, replace the temporary PR pins with compatible merged
CI builds before PR-package cleanup removes them.

CI pins are temporary: viu and viu-platforms keep only their newest 20 `main` builds. GitHub Packages
requires a personal access token (classic) with `read:packages`, and the shared frontend packages
are private to the `assimalign` organization. Never write the token to `NuGet.config`; supply it
from the environment:

```powershell
$env:NuGetPackageSourceCredentials_assimalign = "Username=<github-user>;Password=$(gh auth token);ValidAuthenticationTypes=Basic"
```

Build and test everything from the repository root:

```powershell
dotnet build ViuDocs.slnx -c Release
dotnet test ViuDocs.slnx -c Release --no-build
dotnet run --project app/Assimalign.Viu.Docs.Web
```

The Web host declares the client with a normal
`<ProjectReference Include="../Assimalign.Viu.Docs.App/ViuDocs.Client.csproj" ViuClient="true" />`
and uses `builder.Services.AddViuClient()` to infer its output. Rebuild after changing the reference
to regenerate `viu-client.json`. The host listens on
`http://127.0.0.1:5179`. The client may also be run directly because it references
`Assimalign.Cohesion.Viu.DevServer`. That CI package publishes its tools for the packing agent's
runtime identifier (x64), so on Windows ARM64 run the DevServer under
`C:\Program Files\dotnet\x64\dotnet.exe`.

## The `Assimalign.Viu.Docs` package

`ViuDocsMicroFrontend` derives from the shared `DocumentationMicroFrontend` contract. The package
owns its generated catalog, HTTP source, renderer, component registration, navigation, and `/viu`
route subtree. Hosts compose it through `builder.Services.AddMicroFrontends`; they must not call
`AddMarkdownContent`.

The generated routes are `/viu`, `/viu/guide`, `/viu/guide/quick-start`, and the remaining catalog
paths below `/viu`. Markdown remains outside the WebAssembly payload and is carried as transitive
static content at `/_content/Assimalign.Viu.Docs/docs/<asset>.md`. Each asset name is the Viu
Markdown build's default hashed name: the first twelve hex digits of the SHA-256 of the
forward-slash source path. The package build hashes the packed content; a host that uses a project
reference instead imports `packages/Assimalign.Viu.Docs/build/Assimalign.Viu.Docs.ProjectReference.props`
to link the same names.

A browser host supplies an `HttpClient` based at its document address and registers everything in
`builder.Services`, then installs the router after building:

```csharp
builder.Services.AddComponents();
builder.Services.AddFrontendComponents();
builder.Services.AddRouting(routing => routing.Routes.Add(landingRoute));
builder.Services.AddMicroFrontends(microFrontends => microFrontends
    .UseShell(ComponentReference.ForName("AppShell"))
    .Add(new ViuDocsMicroFrontend(httpClient)));

await using ViuApplication application = builder.Build();
await application.UseRouter().RunAsync();
```

The package is AOT-compatible, uses generated content and explicit shared frontend contributions,
contains no custom CSS, and has no dependency on the standalone Web host. Application-local Viu
components use aggregated catalogs. The shared `AppShell` still uses its registered name; that
precompiled frontend build does not expose a public typed definition. The client root remains an
explicit `RouterView.Registration` node because RouterView is a code-first router component.

The Web app currently serves the Browser client. Future SSR composition belongs in
`builder.Services.AddViuServerRendering(...)` on the same Web builder, followed by predicate-only
`application.UseViuServerRenderer(...)`; no separate server Viu builder is needed. See the
[Application API](docs/api/application.md) for scopes, catalogs, and fallback ordering.

## Documentation conventions

Every page under `docs/` follows these authoring rules:

1. Put one H1 on line 1 and one description sentence on line 3.
2. Do not use YAML frontmatter.
3. Add a `> **Status:** ...` blockquote describing whether the documented behavior is implemented,
   partial, or planned. Label narrower gaps again at their point of use.
4. Use relative `.md` links. The catalog generator converts them to browser routes.
5. Verify every named API and code sample against the Viu source rather than stale planning prose.
6. Use explicit `using` directives in C# examples, with `System.*` before `Assimalign.*` and outside
   the namespace.
7. Link new pages from `docs/index.md` and their section `index.md` in reading order.
8. Hard-wrap prose at roughly 100 characters.

Viu's public names use PascalCase and spell out words. Keep foreign package names, external Vue
links, `.vue` compatibility terminology, and the `vue:` prefix where they describe formats or
counterparts; do not rewrite those identifiers.

Anything that is not fully implemented must be labelled inline and link to
[`docs/roadmap/status.md`](docs/roadmap/status.md). State, opt-in DevTools, and structural built-ins
exist in the current source. Generated reactive CSS `v-bind()` application remains deferred;
scoped styles are unsupported. Use the current source contracts when updating status claims.
