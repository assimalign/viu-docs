# Viu Documentation

Source for the Viu documentation site — plain markdown, no build step, no generator, no frontmatter.

> **Status:** Partial. The markdown in this repository is complete and hand-navigable, but nothing in
> the Cohesion content pipeline can render markdown to HTML yet, so there is no site build today.

Viu is a C#/.NET re-implementation of [Vue.js 3](https://vuejs.org/) that runs in the browser on
WebAssembly. This repository documents it. The framework itself lives at
[github.com/assimalign/viu](https://github.com/assimalign/viu).

**Start at [`docs/index.md`](docs/index.md).** That page is the site's landing page and its
hand-maintained navigation hub.

## What this repository is

- **Markdown source only.** Every file here is CommonMark-shaped plain markdown intended to be read
  directly on GitHub today and rendered to a static site later.
- **No build tooling.** There is no site generator, no template engine, no layout system, and no
  navigation manifest — because the intended consumer does not have one yet either.
- **Written against the real codebase.** Every type, member, MSBuild property, and diagnostic ID named
  in these pages was verified against the source at `assimalign/viu`. Nothing is invented.

The intended future consumer is `Assimalign.Cohesion.Content.Markdown`, which today is a registered but
empty placeholder — `src/Class1.cs` holding an empty `Class1` in the stale namespace
`Assimalign.Cohesion.Files.Markdown`, an empty `<Project Sdk="Microsoft.NET.Sdk">` element, a scaffolded
test project whose only file is `UnitTest1.cs`, and a zero-byte README. There is no CommonMark parser,
no markdown-to-HTML renderer, and no static-site generation anywhere in the Cohesion repository.
The only statement of intent is one line in that repo's `libraries/Content/README.md` Standards table:
"Markdown: CommonMark baseline." That is an aspiration, not a capability.

When a renderer does arrive, the serving story is already implemented:
`Assimalign.Cohesion.Web.StaticFiles` serves pre-built files from a mounted `IFileSystem`, 301-redirects
a slash-less directory URL to its trailing-slash form, and then resolves `DefaultDocuments`
(`index.html`, `index.htm`). That is why the major sections carry an `index.md` — directory-shaped URLs
resolve naturally once those pages are rendered. Coverage is not yet complete: `docs/`, `docs/api/`,
`docs/examples/`, `docs/guide/`, `docs/guide/essentials/`, and `docs/guide/components/` have one;
`docs/guide/built-ins/`, `docs/guide/reusability/`, `docs/guide/scaling-up/`,
`docs/guide/best-practices/`, and `docs/roadmap/` do not, so those directory URLs will 404 until an
`index.md` is added. Adding the missing five is an open task.

## Repository layout

```
README.md                      this file — conventions and contributor guide
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

- **Line 1 is a single H1** — the page title. Exactly one H1 per file; every other heading is H2 or
  deeper. A future generator derives the page title from this node and the URL from the file path.
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

This is a deliberate decision with a verified justification, not an oversight.

- **Nothing can parse it.** `Assimalign.Cohesion.Content.Markdown` contains zero markdown code, so a
  frontmatter block would be inert metadata with no consumer.
- **It would render as garbage everywhere else.** In every other markdown viewer a leading `---` block
  displays as a horizontal rule followed by stray text — on GitHub, which is where these pages are read
  today.
- **It matches observed practice.** Every markdown file in the Cohesion repository was checked and none
  begins with a `---` line; a repo-wide grep for "frontmatter" and "front matter" returns zero hits. The
  one `---` block in that repo lives in `.claude/rules/documentation.md` and is a Claude Code
  rule-scoping header, not documentation frontmatter.
- **There is no field schema to follow.** Since no frontmatter is parsed or authored anywhere, there is
  no `title`, `description`, `date`, `tags`, `slug`, `order`, `weight`, `draft`, or `nav` field that
  could be documented. Any field list would be invention.

**Migration note.** If `Assimalign.Cohesion.Content.Markdown` ever ships a CommonMark parser with a
frontmatter extension, frontmatter can be added mechanically without rewriting a single line of body
content: the H1 becomes `title`, the description paragraph becomes `description`, and the status
callout becomes `status`. `Assimalign.Cohesion.Content.Yaml` — a complete, dependency-free YAML 1.2.2
engine validated against the official yaml-test-suite — is the obvious parser for that block. The
three-part opening exists precisely so that extraction is a trivial CommonMark walk.

## File naming and navigation

- **Filenames are lowercase kebab-case** — `quick-start.md`, `reactivity-fundamentals.md`,
  `deferred-built-ins.md`. These names are URL segments, and lowercase hyphenated segments are the
  convention every published documentation site uses.
- **This is a deliberate deviation from Cohesion's UPPERCASE rule.** Cohesion mandates `README.md`,
  `OVERVIEW.md`, and `DESIGN.md` for repo-internal documentation. That rule governs documents read
  inside a source tree; these files are the address bar of a public site. The repo-root `README.md`
  stays UPPERCASE, in keeping with the rule.
- **Navigation is hand-maintained relative links.** There is no `toc.yml`, `SUMMARY.md`, `mkdocs.yml`,
  `docfx.json`, or `sidebars.js`, because no such format exists in the intended consumer — Cohesion
  ships no navigation manifest of any kind and expresses navigation purely as relative markdown links.
  Adding a manifest here would invent a format nothing reads.
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
specification. Only the container differs from Vue; the block semantics are the Vue SFC spec unchanged,
and the markup inside `@template` is standard Vue template syntax.

```viu
@template {
    <div>{{ Message }}</div>
}

@script {
    public string Message = "Hello";
}

@style scoped {
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

Absent entirely — no folder, no project, and no source file in the framework repository. Each is named
in the roadmap table in `docs/PLAN.md`, and `Assimalign.Viu.Routing` appears as a `using` line in the
`.designing/SampleApp/App.viu` sketch and in a source-generator test fixture string; those are the only
references, and none of them is an implementation. Never write a page implying any of these work:

- **`Assimalign.Viu.Router`** — the `vue-router` counterpart. Roadmap only.
- **`Assimalign.Viu.Store`** — the Pinia counterpart. Roadmap only.
- **`Assimalign.Viu.ServerRenderer`** — SSR, hydration, and static prerendering. Roadmap only. Seams
  such as `PatchFlags.NeedHydration`, `DomKnowledge.IsSsrSafeAttributeName`, and
  `Lifecycle.OnServerPrefetch` exist but nothing consumes them; they are not SSR support.
- **`Assimalign.Viu.DevTools`** — the browser devtools counterpart. Roadmap only.

Present as inert markers. `RenderHelpers._Teleport`, `._KeepAlive`, and `._Suspense` are
`BuiltInVirtualNodeType` marker objects, and rendering any of them throws `NotSupportedException`. See
[`docs/guide/built-ins/deferred-built-ins.md`](docs/guide/built-ins/deferred-built-ins.md), which
documents them honestly and gives the workarounds available today.

Two more traps worth knowing before you write a page:

- **There is exactly one working demo, and it is a stopwatch.** The framework's `PLAN.md` names TodoMVC
  as its exit demo; TodoMVC does not exist in any form. The stopwatch is written entirely with
  hand-written `VirtualNodeFactory` calls, and no shipping example compiles a `.viu` file. See
  [`docs/examples/stopwatch.md`](docs/examples/stopwatch.md).
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
</content>
</invoke>
