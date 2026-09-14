# Viu Documentation

Source for the Viu documentation site: plain markdown under `docs/`, a Viu WebAssembly client, and a
Cohesion Web host under `app/`. The markdown remains the source of truth and carries no frontmatter.

> **Status:** Browser-rendered documentation application. `Assimalign.Cohesion.Viu.Markdown`
> generates its content catalog at build time and renders Markdown as Viu components in the browser.
> Request-time server rendering is a later phase.

Viu is a C#/.NET re-implementation of [Vue.js 3](https://vuejs.org/) that runs in the browser on
WebAssembly. This repository documents it. The framework itself lives at
[github.com/assimalign/viu](https://github.com/assimalign/viu).

**Start at [`docs/index.md`](docs/index.md).** That page is the site's landing page and its
hand-maintained navigation hub.

## What this repository is

- **Plain markdown source.** Every file under `docs/` is CommonMark-shaped markdown that remains
  directly readable on GitHub. The browser application consumes the same files as static web assets.
- **A package-based documentation application.** `app/Assimalign.Viu.Docs.App` is a Viu WebAssembly
  consumer composed through `ViuApplication.CreateBuilder().AddMarkdownContent(...)`. The Markdown
  package derives metadata and navigation from the files during compilation. Its page component
  fetches each `.md` asset and renders Viu nodes, including `RouterLink` components for internal links.
- **A real Cohesion host.** `app/Assimalign.Viu.Docs.Web` uses the Cohesion App.Web shared framework
  and `Assimalign.Cohesion.Viu.Server` to serve the client's manifest-described static assets and
  markdown.
- **A deliberate SSR boundary.** The Web host serves the browser application and its content assets.
  Per-page server composition remains a later phase; the Markdown package already supplies the
  file-system content source, node renderer, and `OnServerPrefetch` lifecycle seam for that work.
- **Written against the real codebase.** Every type, member, MSBuild property, and diagnostic ID named
  in these pages was verified against the source at `assimalign/viu`. Nothing is invented.

`Assimalign.Cohesion.Viu.Markdown` composes the published `Assimalign.Cohesion.Content.Markdown`
parser. The incremental source generator produces `GeneratedMarkdownContent.Catalog`, containing
all 45 pages, and `MarkdownRoutes.Create` turns that catalog into exact routes beneath `AppShell`.
The application has no hand-written page catalog, link rewriter, heading identifier implementation,
fetch service, or Markdown view template. Markdown parsing still happens at runtime; the build
generates metadata, not HTML.

> **Local package prerequisites:** the client pins Viu `10.0.0-beta.12`,
> `Assimalign.Cohesion.Viu.Markdown` / `.Hosting` / `.Hosting.Browser` `10.0.0-beta.4`; the server
> consumes `Assimalign.Cohesion.Viu.Server` `10.0.0-beta.4`. The Markdown package consumes
> `Assimalign.Cohesion.Content.Markdown` `10.0.0-beta.1`. These packages use the Cohesion-first
> family name that replaced `Assimalign.Viu.Cohesion.*`. The root `NuGet.config` currently restores
> them from the sibling repositories' local feeds. The Cohesion assemblies carry
> `[assembly: RequiresPreviewFeatures]`, so both projects opt in with
> `<EnablePreviewFeatures>true</EnablePreviewFeatures>` (CA2252).

## Local development

The root `NuGet.config` restores from the local Viu, Viu Platforms, and Cohesion package feeds,
uses the authenticated Assimalign GitHub Packages source for beta.1 Cohesion dependencies absent
from the sibling feed, and keeps restored packages in the repository-local `.nuget/packages` cache.
After changing the platform packages, pack their local feed before building both documentation
projects from this repository root:

```powershell
pwsh ../viu-platforms/scripts/Install-Local.ps1 -Configuration Release
dotnet build ViuDocs.slnx
dotnet run --project app/Assimalign.Viu.Docs.Web
```

The server's non-compiling project reference builds the client first. It then supplies the client's
configuration-specific static-web-assets runtime and endpoints manifests to
`AddViuApplication`, so `/`, `/_framework/**`, and `/docs/**` all come from the Viu build graph.
The server builds self-contained for the current .NET SDK runtime identifier so the Cohesion
App/App.Web runtime packs can run without a machine-wide Cohesion framework installation.

In Visual Studio, open `ViuDocs.slnx`, select `ViuDocs.Server` as the startup project, and press F5
with the `ViuDocs.Server` profile. That profile pins `http://127.0.0.1:5179`.

The client sets `ViuMarkdownContentRoot` to `..\..\docs` and `ViuMarkdownContentPrefix` to `docs/`.
The package's default recursive glob supplies these files to the incremental generator; the linked
`Content` items in `ViuDocs.Client.csproj` also expose the same files as static web assets. Titles,
descriptions, status text, and section order therefore update with ordinary Markdown edits.

The client uses clean web history, and the server's SPA fallback handles direct route requests.
`<base href="/">` keeps assets rooted at the site. A render-option hook qualifies fragment-only anchors
with the page route so the root base element does not send them to the landing page. They remain
ordinary native anchors, so the router's beta.12 fragment support does not remove this browser-base
requirement. The bootstrap converts old `#/guide/...` bookmarks to their equivalent clean URLs once.
Internal Markdown links render as `RouterLink` components and retain fragments as `route#fragment`;
there is no anchor-click interceptor. Viu beta.12 matches the clean `RouteLocation.Path` and exposes
the raw fragment without `#` as `RouteLocation.Fragment`. The router's optional `ScrollBehavior`
uses those fields to wait for a heading in the destination page's article while Markdown downloads,
then apply the router's `ScrollTarget`. `main.js` retains only this bounded heading-availability helper,
the bookmark conversion, and the .NET bootstrap. It does not
navigate on link clicks.

`AppShell` passes the nested outlet depth directly with `<RouterView :depth="1" />`, supported by
Viu beta.12. It retains the typed `GetSections()` navigation method because the template generator
still unwraps a mutable collection property as `object` in `v-for` (assimalign/viu#366).

Markdown parsing and rendering still happen in the browser.
`Assimalign.Viu.Docs.Web/Program.cs` marks the future hosting-model seam:
`AddViuServerApplication` before the Web application is built, followed by
`UseViuServerRenderer(ViuApplication, ...)` in the pipeline. Request-time server rendering remains a
later phase.

## Repository layout

```
README.md                      this file — conventions and contributor guide
NuGet.config                   local package feeds and repository-local restore cache
ViuDocs.slnx                   solution entry point
global.json                    .NET SDK selection and packaged Cohesion/Viu SDK versions
app/
  Assimalign.Viu.Docs.App/     Viu WebAssembly documentation browser and linked markdown assets
    Components/AppShell.viu   application layout and navigation over the generated catalog
    FragmentScrolling.cs     browser heading-availability interop for router scrolling
    Program.cs               Markdown package, router, and hosting composition
    wwwroot/                 bootstrap, fragment wait helper, site.css, and index.html
  Assimalign.Viu.Docs.Web/     Cohesion Web host and future server-rendering composition root
docs/
  index.md                     landing page and navigation hub
  guide/
    index.md                   guide section TOC
    introduction.md            what Viu is, and the five founding divergences from Vue
    quick-start.md             nothing to a running app in the browser
    essentials/                components, reactivity, templates, events, watchers, lifecycle
    components/                props, events, v-model, slots, provide/inject, dynamic components
    reusability/               composables, custom directives
    built-ins/                 Transition/TransitionGroup, and the deferred built-ins
    scaling-up/                .viu single-file components, CSS features, the SDK, testing
    best-practices/            AOT & trimming, performance
  api/
    index.md                   API reference TOC
    ...                        reactivity, components, application, render functions,
                               directives, MSBuild, diagnostics
  examples/
    index.md                   examples TOC
    stopwatch.md               the one demo that actually exists in the repo
  roadmap/
    status.md                  what is built, partial, marker-only, and absent
    vue-differences.md         the naming map plus the behavioral divergences
```

Forty-five pages under `docs/`, plus this README. Where a section has an `index.md` it is a landing page
and table of contents; those files carry navigation, not reference material.

## Page structure

Every page opens with the same three parts, and no YAML frontmatter appears anywhere.

```markdown
# Reactivity Fundamentals

Refs, the `[Reactive]` source generator, and how Viu tracks state without a JavaScript `Proxy`.

> **Status:** Implemented. See [Project status](../../roadmap/status.md) for area-by-area coverage.
```

- **Line 1 is a single H1** — the package extracts the page title here. Exactly one H1 per file;
  every other heading is H2 or deeper. The file path determines the route.
- **Line 3 is one plain-paragraph description** — a single sentence, no markup beyond inline code. This
  is the summary a search index or navigation card would use.
- **Line 5 is an optional status blockquote** — the single machine-greppable honesty marker across the
  site. It is required on any page documenting something partial, marker-only, or absent.

The status callout uses exactly one of four sentences, optionally followed by clarifying prose:

| Callout | Use when |
| --- | --- |
| `> **Status:** Implemented.` | The API exists, works, and is exercised by tests. Omit the callout entirely if it adds nothing. |
| `> **Status:** Partial.` | Part of the surface works and the named gaps are listed in a "Not yet implemented" tail. |
| `> **Status:** Not yet implemented.` | A marker, flag, or registration point exists but nothing acts on it. |
| `> **Status:** Planned — not present in the codebase.` | No folder, no project, no source file. |

## Why there is no frontmatter

This remains a deliberate source-format decision, not an oversight.

- **The package extracts visible metadata.** `Assimalign.Cohesion.Viu.Markdown` uses deterministic,
  line-based extraction at build time: the first-line H1, opening description paragraph, and optional
  status blockquote become catalog metadata. Relative `.md` links in each folder's `index.md` define
  navigation order; unlinked pages still appear in ordinal file order. No frontmatter is parsed.
- **The sources remain portable.** Keeping metadata in the visible opening nodes makes the title,
  summary, and status readable on GitHub and in ordinary markdown viewers without viewer-specific
  frontmatter handling.
- **It matches observed practice.** Every markdown file in the Cohesion repository was checked and none
  begins with a `---` line; a repo-wide grep for "frontmatter" and "front matter" returns zero hits. The
  one `---` block in that repo lives in `.claude/rules/documentation.md` and is a Claude Code
  rule-scoping header, not documentation frontmatter.
- **There is no field schema to follow.** Since no frontmatter is parsed or authored anywhere, there is
  no `title`, `description`, `date`, `tags`, `slug`, `order`, `weight`, `draft`, or `nav` field that
  could be documented. Any field list would be invention.

The same catalog and content-source contracts support future server rendering without changing the
page format. The package's runtime catalog builder is also available for hosts without source
generation.

## File naming and navigation

- **Filenames are lowercase kebab-case** — `quick-start.md`, `reactivity-fundamentals.md`,
  `deferred-built-ins.md`. These names are URL segments, and lowercase hyphenated segments are the
  convention every published documentation site uses.
- **This is a deliberate deviation from Cohesion's UPPERCASE rule.** Cohesion mandates `README.md`,
  `OVERVIEW.md`, and `DESIGN.md` for repo-internal documentation. That rule governs documents read
  inside a source tree; these files are the address bar of a public site. The repo-root `README.md`
  stays UPPERCASE, in keeping with the rule.
- **Navigation is hand-maintained relative links.** There is no `toc.yml`, `SUMMARY.md`, `mkdocs.yml`,
  `docfx.json`, or `sidebars.js`. The package reads section ordering from the existing `index.md`
  links and renders intra-document `.md` links through the Viu router, so a second navigation metadata
  format is unnecessary. Folder sections and their titles now follow the source tree, replacing the
  proof of concept's manually grouped navigation.
- **Link only to pages that exist.** Every relative link must resolve within this repository. When you
  add a page, add its link to `docs/index.md` and to its section's `index.md` in the same change.

## Prose and code conventions

These follow the observed Cohesion house voice.

- **Hard-wrap prose at roughly 100 characters.** Tables and links may overrun; paragraphs should not.
- **Bulleted lists use a bolded lead-in phrase followed by an em-dash explanation** — exactly like this
  bullet. It makes a list scannable without reading every clause.
- **Pipe tables carry contract and behavior matrices.** Prose carries reasoning; tables carry mappings.
- **Every type and member name goes in inline backticks** — `Reference<T>`, `.Value`,
  `IComponentDefinition.Setup`, `ViuBundleCss`.
- **Name the upstream Vue counterpart wherever one exists** and link it to
  [vuejs.org](https://vuejs.org/). The framework's own documentation rule requires this on every public
  member, and the site follows suit: it is how upstream semantics stay pinned.
- **Use whole words.** The framework bans abbreviations in identifiers, and the docs follow: Reference
  not Ref, Properties not Props, Attributes not Attrs, Dependency not Dep. The seven approved acronyms
  are DOM, HTML, CSS, SSR, AOT, JSON, and WASM. SFC is not among them — identifiers spell out
  `SingleFileComponent`, though prose may write "single-file component (SFC)" freely.

Code fences are labelled by language: `csharp` for C#, `viu` for `.viu` single-file components, `xml`
for MSBuild and markup, `sh` for shell, `json` for JSON.

C# samples must compile against the real API and must show their full using block — implicit and global
usings are disabled repo-wide in the framework, so a sample that hides them is a sample that will not
build. Order usings `System.*` first, then third-party, then `Assimalign.*`, outside the namespace, with
file-scoped namespace declarations.

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

namespace MyApp;

public sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var count = Reactive.Reference(0);

        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(("onClick", (Action)(() => count.Value++))),
            $"count is {count.Value}");
    }
}
```

`.viu` samples use the `@`-block container documented in the framework's authoritative format
specification. The markup inside `@template` is standard Vue template syntax. Styles are global;
Viu beta.12 rejects scoped styles in `.viu` files.

```viu
@template {
    <div>{{ Message }}</div>
}

@script {
    public string Message = "Hello";
}

@style {
    div { color: red; }
}
```

## Viu names versus Vue names

Viu's public names are PascalCase renames of Vue's camelCase, with abbreviations spelled out. Pages
should use the Viu name and mention the Vue counterpart. The full map lives in
[`docs/roadmap/vue-differences.md`](docs/roadmap/vue-differences.md); the most load-bearing entries:

| Vue 3 | Viu | Note |
| --- | --- | --- |
| `ref()` | `Reactive.Reference<T>(value)` | Returns `Reference<T>`. There is no type named `Ref`. |
| `.value` | `.Value` | Capital V, read and write. |
| `computed()` | `Reactive.Computed<T>(getter, setter)` | `setter` is an optional parameter; `IsWritable` reports which. |
| `shallowRef()` | `Reactive.ShallowReference<T>` | |
| `customRef()` | `Reactive.CustomReference<T>` | |
| `reactive(obj)` | `[Reactive]` plus a Roslyn source generator | C# has no `Proxy`; there is no runtime `reactive()`. |
| proxied Array / Map / Set | `ReactiveList<T>` / `ReactiveDictionary<TKey, TValue>` / `ReactiveSet<T>` | Dedicated types, same reason. |
| `props` | `ComponentProperties` | Whole words, no abbreviations. |
| `attrs` | `ComponentAttributes` | `context.Attributes`, never `Attrs`. |
| `effectScope()` | `Reactive.EffectScope(detached)` | |
| `getCurrentScope()` | `Reactive.CurrentScope` | A property, not a method. |
| `provide()` / `inject()` | `DependencyInjection.Provide<T>` / `Inject<T>` | Keyed by `InjectionKey<T>`, reference identity. Non-generic `string`-keyed overloads also exist. |
| `h()` | `VirtualNodeFactory.Element(...)` | Compiled templates use `RenderHelpers` instead. |

**Upstream references stay untouched.** The product is Viu, but `@vue/*` package names, vuejs.org
links, and the `vue:` prefix in `<div is="vue:MyComponent">` are deliberately retained. Do not "fix"
them. The one name that does need care is the repository: it is
[github.com/assimalign/viu](https://github.com/assimalign/viu), not the stale `vuecs` slug that the
framework's own `PLAN.md` still references.

## Documenting what does not exist

These pages describe an aspirational end-state developer experience, and that is intentional — the
point is to frame how the Viu SDK is meant to be used. Aspiration is fine. Misrepresentation is not.
The rule is simple: **anything not fully implemented must be labelled inline, at the point of use, and
must link to [`docs/roadmap/status.md`](docs/roadmap/status.md).**

The Phase 3 package baseline changes two earlier roadmap assumptions. `Assimalign.Viu.Router` and
`Assimalign.Viu.Browser.Router` are consumable packages and this application uses their official
web-history implementation. `Assimalign.Viu.ServerRenderer` is also present; turning markdown pages
into request-time components remains later integration work, not an absent renderer. Continue to label
the surfaces that are actually absent:

- **`Assimalign.Viu.Store`** — the Pinia counterpart. Roadmap only.
- **`Assimalign.Viu.DevTools`** — the browser devtools counterpart. Roadmap only.

Present as inert markers. `RenderHelpers._Teleport`, `._KeepAlive`, and `._Suspense` are
`BuiltInVirtualNodeType` marker objects, and rendering any of them throws `NotSupportedException`. See
[`docs/guide/built-ins/deferred-built-ins.md`](docs/guide/built-ins/deferred-built-ins.md), which
documents them honestly and gives the workarounds available today.

Two more traps worth knowing before you write a page:

- **Example coverage changes independently of these pages.** The packaged SDK showcase now compiles
  `.viu` components, while this repository still documents the stopwatch as its focused example. Keep
  claims about shipping examples tied to a current package-consumer check.
- **`PLAN.md` is stale and will mislead you.** Its "Where the POC stands" section claims reactivity, the
  component model, the scheduler, and minimal-move keyed reconciliation are absent. All four are
  implemented. It also names types — `VirtualDomRenderer<TNode>`, `IVirtualDomAdapter<TNode>`, `VElement`
  — that no longer exist. Verify against source, not against `PLAN.md`.

## Authoring checklist

Before opening a pull request against this repository:

1. **One H1 on line 1**, one description sentence on line 3, and a status callout if anything on the
   page is partial, marker-only, or absent.
2. **No YAML frontmatter.** Anywhere.
3. **Every named API verified against source** at `assimalign/viu`. If the research digest is ambiguous,
   read the file.
4. **Every code sample realistic and compilable** — explicit usings, `System.*` before `Assimalign.*`,
   outside the namespace.
5. **Every relative link resolves** to a page that exists in this repository.
6. **Vue counterparts named and linked** wherever one exists.
7. **New pages linked** from `docs/index.md` and from their section's `index.md`, in the same change.
8. **Prose hard-wrapped** at roughly 100 characters.
