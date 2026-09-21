# Viu documentation

This repository owns the source documentation for Viu, the `Assimalign.Viu.Docs` build-time
micro-frontend package, and a standalone client/Web host used to develop and verify that package.
The production `docs.assimalign.com` landing zone consumes the package and supplies orchestration.

## Repository layout

```text
docs/                                      45 authored Markdown pages
packages/Assimalign.Viu.Docs/src/          host-neutral micro-frontend package
packages/Assimalign.Viu.Docs/test/         package contract tests
packages/Assimalign.Viu.Docs/docs/         package overview and design
app/Assimalign.Viu.Docs.App/               thin shared-shell browser client
app/Assimalign.Viu.Docs.Web/               plain Cohesion Web host
azure-pipelines.yml                        Build, Test, Pack, and Push pipeline
```

## Version line

- Viu SDK and router: `10.0.0-beta.12`
- `Assimalign.Cohesion.Viu.*`: `10.0.0-beta.5`
- Cohesion SDK: `10.0.1-preview.3.local`
- `Assimalign.Frontend.*`: `1.0.0-preview.1`
- `Assimalign.Viu.Docs`: `1.0.0-preview.1`

## Local development

The repository restores only from explicit sources in `NuGet.config`. Before building, produce the
sibling package feeds without changing or repacking them from this repository:

```powershell
pwsh C:\Source\repos\assimalign\viu\scripts\Install-Local.ps1
pwsh C:\Source\repos\assimalign\cohesion\scripts\Install-Local.ps1
pwsh C:\Source\repos\assimalign\viu-platforms\scripts\Install-Local.ps1
pwsh C:\Source\repos\assimalign-core\aaln-core-frontend\scripts\Install-Local.ps1
```

The configured feeds are:

- `C:\Source\repos\assimalign\viu\_out\packages`
- `C:\Source\repos\assimalign\viu-platforms\_out\packages`
- `C:\Source\repos\assimalign\cohesion\_out\packages`
- `C:\Source\repos\assimalign-core\aaln-core-frontend\_out\packages`

Build and test everything from the repository root:

```powershell
dotnet build ViuDocs.slnx -c Release
dotnet test ViuDocs.slnx -c Release --no-build
dotnet run --project app/Assimalign.Viu.Docs.Web
```

The Web launch profile listens on `http://127.0.0.1:5179`. The client may also be run directly
because it references `Assimalign.Cohesion.Viu.DevServer` `10.0.0-beta.5`.

## The `Assimalign.Viu.Docs` package

`ViuDocsMicroFrontend` derives from the shared `DocumentationMicroFrontend` contract. The package
owns its generated catalog, HTTP source, renderer, component registration, navigation, and `/viu`
route subtree. Hosts compose it through `AddMicroFrontends`; they must not call `AddMarkdownContent`.

The generated routes are `/viu`, `/viu/guide`, `/viu/guide/quick-start`, and the remaining catalog
paths below `/viu`. Markdown remains outside the WebAssembly payload and is carried as transitive
static content at `/_content/Assimalign.Viu.Docs/docs/**`.

A browser host supplies an `HttpClient` based at its document address:

```csharp
registrations.Add(new ViuDocsMicroFrontend(httpClient));
```

The package is AOT-compatible, uses explicit generated component registration, contains no custom
CSS, and has no dependency on the standalone Web host.

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
[`docs/roadmap/status.md`](docs/roadmap/status.md). The Store and DevTools remain roadmap items.
`KeepAlive`, `Teleport`, and `Suspense` remain inert markers; see
[`docs/guide/built-ins/deferred-built-ins.md`](docs/guide/built-ins/deferred-built-ins.md).
