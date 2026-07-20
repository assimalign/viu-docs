# SFC CSS Features

Scoped styles, CSS Modules, and `v-bind()` in CSS inside a `.viu` file's `@style` blocks, and how the
compiled CSS reaches the browser.

> **Status:** The build-time half is implemented; **two runtime seams are not wired**. The renderer never
> stamps the `data-v-<hash>` attribute (`RendererOptions<TNode>.SetScopeId` is declared and never called), so
> scoped and `:slotted()` selectors do not match anything yet; and the generated `ApplyCssVariables()` method
> is emitted but never called during setup. CSS Modules is the one feature that works end to end, because it
> renames classes rather than relying on a runtime attribute. See
> [Project status](../../roadmap/status.md).

Viu's counterpart to Vue's [SFC CSS Features](https://vuejs.org/api/sfc-css-features.html). The three
features — `scoped`, `module`, and `v-bind()` in CSS — **compile** as they do upstream; what differs is the
block container (`@style { … }` rather than `<style>`), the fact that every rewrite happens at build time
inside a Roslyn source generator, and the fact that the resulting stylesheet is a static web asset you
reference by hand rather than something a bundler injects. What they do at *runtime* differs too, and not
in a good way — read the status callout above before relying on `scoped` or `v-bind()`.

Almost nothing here costs anything at runtime. The WASM payload contains no CSS engine, no CSS parser, and
no stylesheet injection: selector rewriting, class hashing, and `v-bind()` extraction are all done by the
compiler and the `ViuBundleCss` MSBuild task before the app ever loads. The one runtime component is
`CssVariables.UseCssVars`, which applies `v-bind()` values as custom properties — and it ships in
`Assimalign.Viu.RuntimeDom` only, not in the compiler.

## The `@style` block

A `.viu` file may declare any number of `@style` blocks, each with its own options. See
[Single-File Components](single-file-components.md) for the container rules; the two that matter most here
are that **column 0 is structural** — a `}` at column 0 closes the block — and therefore that **block
content must be indented**.

```viu
@template {
    <div class="card">
        <h2 class="title">{{ Title }}</h2>
        <slot />
    </div>
}

@script {
    public string Title = "Card";
}

@style scoped {
    .card { border: 1px solid #ddd; border-radius: 6px; }
    .title { font-size: 1.25rem; }
}
```

Writing `.card { … }` flush against column 0 would work, but its closing `}` at column 0 would terminate
the `@style` block early and the real closing brace would be reported as `StrayTopLevelContent`. Indent
every declaration.

The options a `@style` block honors:

| Option | Form | Meaning |
| --- | --- | --- |
| `scoped` | valueless flag | Rewrite every selector so it only matches this component's own elements. |
| `module` | valueless flag | CSS Modules; class names are hashed and exposed through a `Style` accessor. |
| `module="theme"` | quoted value | CSS Modules under a named accessor (`Theme`, referenced as `theme`). |
| `lang="scss"` | quoted value | Parsed and preserved on the block, but **no pre-processor exists** — see below. |

Option values must be double-quoted with no whitespace around `=`. `@style lang=scss {` reports
`MalformedOptionValue`; the block still opens, but `Lang` stays null.

The three features compose freely — `@style module scoped { … }` applies the module rename, then the
`v-bind()` rewrite if the block uses it, then the scoped serialization.

## Scoped CSS

`@style scoped` is Viu's port of Vue's
[scoped CSS](https://vuejs.org/api/sfc-css-features.html#scoped-css). The compiler rewrites each selector
to carry a `data-v-<hash>` attribute; at runtime the same attribute is meant to be stamped onto the elements
the component owns.

> **Not yet wired.** The stamping half does not exist. `RendererOptions<TNode>.SetScopeId` is declared as an
> optional node operation and **no code path in the repository ever calls it**, and no DOM renderer supplies
> an implementation. The rewrite below is real and the CSS ships in the bundle, but because no element ever
> carries `data-v-<hash>`, a scoped rule currently matches nothing in the browser. Everything in this section
> describes the compiler's verified output, not observable runtime behavior.

```viu
@template {
    <div class="card">
        <p class="body">Scoped to this component only.</p>
    </div>
}

@style scoped {
    .card { padding: 1rem; }
    .card .body { color: #333; }
}
```

The generator emits, into the component's partial class:

```csharp
internal const string ScopeId = "data-v-9d968641";

internal const string ExtractedStyles =
    ".card[data-v-9d968641] {\n  padding: 1rem;\n}\n.card .body[data-v-9d968641] {\n  color: #333;\n}\n";
```

The exact eight hex digits depend on the file's path — `data-v-9d968641` above is illustrative. Note that
the attribute lands on the **last compound only** (`.card .body[data-v-…]`, not `.card[data-v-…]
.body[data-v-…]`), which is upstream parity.

### The scope id is derived from the file path

`StyleScopeId.Resolve(filePath, projectDirectory)` in `Assimalign.Viu.Tooling.Css` produces the id as
`"data-v-"` plus an FNV-1a hash (offset basis `2166136261`, prime `16777619`) of the **project-relative
path**, normalized to forward slashes and formatted as eight lowercase hex digits.

- **Path-based, not content-based** — editing a component's CSS or markup never changes its scope id.
  Moving or renaming the `.viu` file does.
- **Machine-independent** — the hash is culture-free and ordinal, so the same path yields the same id on
  every machine. A file that sits outside the project directory falls back to hashing its leaf file name.
- **Different from Vue's production scheme** — Vue's production build additionally folds the file's source
  into the hash for cache-busting. Viu deliberately does not; that is a deferred optimization.

### Deep, slotted, and global selectors

`:deep()`, `:slotted()`, and `:global()` are parsed as first-class functional pseudo-selectors — they are
the only functional pseudos whose argument is parsed into a real selector list rather than kept as opaque
text. The `::v-deep()`, `::v-slotted()`, and `::v-global()` aliases are accepted too.

| Authored | Rewritten (scope id `data-v-test`) | Effect |
| --- | --- | --- |
| `.foo` | `.foo[data-v-test]` | Ordinary scoping. |
| `h1 > .foo` | `h1 > .foo[data-v-test]` | Attribute on the last compound. |
| `.foo:after` | `.foo[data-v-test]:after` | Pseudo-elements stay trailing. |
| `::selection` | `[data-v-test]::selection` | Bare pseudo-element gets the attribute alone. |
| `:deep(.foo)` | `[data-v-test] .foo` | Reaches into child components. |
| `.a :deep(.foo)` | `.a[data-v-test] .foo` | Anchored on the scoped ancestor. |
| `:slotted(.foo)` | `.foo[data-v-test-s]` | Targets content passed in through a [slot](../components/slots.md). |
| `:global(.foo)` | `.foo` | Escapes scoping entirely — no attribute is added. |
| `*` | `[data-v-test]` | A leading universal selector is dropped. |
| `.foo *` | `.foo[data-v-test] *` | A trailing universal keeps the attribute on the preceding compound. |

`:global()` replaces the **whole** selector, exactly as upstream: `.baz .qux ::v-global(.foo .bar)`
rewrites to `.foo .bar`, and `.baz .qux` is discarded.

### Keyframes and conditional groups

`@keyframes` names are suffixed with the short scope id (the id with `data-v-` stripped), and
`animation` / `animation-name` references are rewritten to match, in either order:

```css
/* authored */
@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
.badge { animation: pulse 2s infinite; animation-name: pulse; }

/* compiled with scope id data-v-9d968641 */
@keyframes pulse-9d968641 { … }
.badge[data-v-9d968641] { animation: pulse-9d968641 2s infinite; animation-name: pulse-9d968641; }
```

Conditional group at-rules recurse: `@media (max-width: 600px) { .a .b { … } }` scopes `.a .b` inside the
media block and leaves the prelude alone. `@supports` and `@container` behave the same way. A keyframe
selector (`from`, `50%`) is not a CSS selector and is never scoped.

## CSS Modules

`@style module` is Viu's port of
[CSS Modules](https://vuejs.org/api/sfc-css-features.html#css-modules). Every local class selector is
renamed to a hashed form, and the generator emits a nested `static class` of `const string` members mapping
the authored names to the compiled ones.

Vue exposes the default module as `$style`, which has no legal C# spelling. Viu names the generated
accessor class `Style`, and the template compiler remaps the authored `$style` spelling onto it.

```viu
@template {
    <div :class="$style.box">
        <span :class="$style.label">Boxed</span>
    </div>
}

@style module {
    .box { border: 1px solid currentColor; }
    .label { font-weight: 600; }
}
```

The generator emits:

```csharp
internal static class Style
{
    public const string box = "box_4f2a91c7";
    public const string label = "label_0b3ce85d";
}
```

and the compiled render body binds `Style.box` — a `const`, resolved at compile time — never `_ctx.box`.
The extracted CSS carries `.box_4f2a91c7 { … }`; the authored `.box` selector no longer appears.

### Named modules

`module="theme"` produces a pascal-cased accessor class. The template still uses the **authored** name:

```viu
@template {
    <button :class="theme.active">Save</button>
}

@style module="theme" {
    .active { background: #0b7; }
}
```

emits `internal static class Theme { public const string active = "active_…"; }` and binds `Theme.active`.

### Member naming

Two *different* sanitizers are involved, and it matters:

- **The accessor class name** is pascal-cased from the module name — `-`, `_`, and space are word boundaries
  that capitalize the next character and are dropped, every other non-alphanumeric character is dropped,
  a leading digit is prefixed with `_`, and an empty result falls back to `Style`.
- **The member name** is *not* pascal-cased. Each character of the authored class name is kept if it is a
  letter, a digit, or `_`, and otherwise **replaced with `_`** (not dropped); a leading digit is prefixed
  with `_`; an empty result falls back to `_`. Case is preserved, so `.box` stays `box`.

| Authored class | Accessor member | Compiled class name |
| --- | --- | --- |
| `.box` | `box` | `box_<hash>` |
| `.my-box` | `my_box` | `my-box_<hash>` |
| `.2col` | `_2col` | `2col_<hash>` |

Only the **member identifier** is sanitized — the compiled CSS class keeps the authored spelling plus the
hash suffix.

### Referring to a class that does not exist

The class map is complete, so an unknown member is a build error rather than a silent empty string:

```viu
@template {
    <div :class="$style.missing">hi</div>
}

@style module {
    .box { color: red; }
}
```

reports `VIU1101` on the `.viu` line: `'$style' has no member 'missing'.`

### Module hashing

A module class compiles to `original + "_" + FNV-1a(shortScopeId + "-" + original)` as eight lowercase hex
digits, where `shortScopeId` is the component's scope id with `data-v-` stripped. Because the salt is the
path hash, **`module` blocks are already component-unique even without `scoped`** — two components may both
declare `.box` and get different compiled names.

## `v-bind()` in CSS

`v-bind()` inside a declaration value is Viu's port of
[v-bind() in CSS](https://vuejs.org/api/sfc-css-features.html#v-bind-in-css). Each well-formed usage is
replaced with a `var(--<hash>)` reference, and the generator emits a method that hands the evaluated values
to the `CssVariables.UseCssVars` runtime.

```viu
@template {
    <div class="swatch">{{ Label }}</div>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<string> Color = Reactive.Reference("#0b7");
    public Reference<string> Size = Reactive.Reference("4rem");
    public string Label = "Accent";
}

@style scoped {
    .swatch { background: v-bind(Color); width: calc(v-bind(Size) + 2px); }
}
```

The compiled CSS becomes `background: var(--3ac91f04);` and the generator emits:

```csharp
internal void ApplyCssVariables()
    => global::Assimalign.Viu.RuntimeDom.CssVariables.UseCssVars(() =>
        new global::System.Collections.Generic.Dictionary<string, string>(2)
        {
            ["3ac91f04"] = global::System.Convert.ToString(
                (object?)(Color.Value), global::System.Globalization.CultureInfo.InvariantCulture)
                ?? string.Empty,
            ["b1e07d52"] = global::System.Convert.ToString(
                (object?)(Size.Value), global::System.Globalization.CultureInfo.InvariantCulture)
                ?? string.Empty,
        });
```

Two details in that emitted code matter:

- **Expressions are rewritten in instance-member mode** — an unqualified name resolves against the merged
  `@script` members through the implicit `this`, with no `_ctx.` prefix.
- **`Reference<T>` members are auto-unwrapped** — you write `v-bind(Color)`, not `v-bind(Color.Value)`, and
  the emitted expression is `Color.Value`. It is never double-unwrapped.

### The `UseCssVars` runtime contract

```csharp
public static void UseCssVars(Func<IReadOnlyDictionary<string, string>> getter)
```

- **Getter keys must NOT include the leading `--`** — the runtime prepends it before calling
  `style.setProperty`. Passing `"--3ac91f04"` produces `----3ac91f04` and silently does nothing.
- **Call it from inside `Setup`** — with no current `ComponentInstance` it is a no-op and returns, mirroring
  upstream's dev-time guard. It throws `ArgumentNullException` only for a null getter.
- **Updates are reactive and re-render-free** — reading reactive state inside the getter is what makes the
  properties track. The runtime re-applies them in the post-flush phase via
  `ViuWatch.WatchEffect(…, new WatchOptions { Flush = WatchFlushMode.Post })`, so a changing value updates
  custom properties without re-rendering the component. Every `setProperty` on one element is batched into a
  single interop crossing.
- **The watcher stops with the component** — it is registered under the component's scope and unhooked on
  unmount.

> **Status:** Partial. `ApplyCssVariables()` is emitted with its full metadata, but the call during
> component setup is not yet wired up — the generated partial does not implement `IComponentDefinition` and
> emits no `Setup` at all, so there is currently no generated seam to call it from. In a hand-written
> component you can call `CssVariables.UseCssVars` directly from your own `Setup`.

### What counts as a binding

The rewrite is a port of upstream's `lexBinding`. It skips string literals and `/* … */` comments, balances
nested parentheses so `calc(v-bind(size) + 2px)` works, strips one surrounding quote pair
(`v-bind('theme.primary')` yields `theme.primary`), trims whitespace, and de-duplicates by normalized
expression text so the same expression used twice produces one custom property.

`content: "v-bind(x)"` is **not** a binding — it is a string literal, and no diagnostic is reported. A
malformed usage reports `UnterminatedCssBinding` or `EmptyCssBinding` and the parse recovers.

As a performance guard, the whole rewrite is skipped unless the block's raw content contains the literal
substring `v-bind`.

## How a block is serialized

There are three serialization paths, and the difference is author-visible in the emitted CSS:

| Block | Serializer | Result |
| --- | --- | --- |
| `scoped` (with or without `module`/`v-bind()`) | `CssScopedRewriter` | Canonical form, selectors rewritten. |
| Not `scoped`, but rewritten by `module` or `v-bind()` | `CssStylesheetWriter` | Canonical form, formatting changes. |
| Not `scoped`, no `module`, no `v-bind()` | none | **Verbatim, byte-for-byte.** |

Canonical form is: two-space indent, `prop: value;`, `selector {` bracing, LF newlines only. So
`.foo{color:red}` in a scoped block emits as:

```css
.foo[data-v-test] {
  color: red;
}
```

Consequences worth internalizing: a scoped or module block **loses your original whitespace and drops
comments** (comments are tokenized for exact spans but not re-emitted), while a plain `@style` block keeps
everything exactly as you typed it. `!important` survives every path — it is hoisted out of the declaration
value into a flag and re-emitted.

## Hash formats

All three hashes are FNV-1a, eight lowercase hex digits, culture-free, and derived from the same
path-based salt. They are observable in your compiled CSS and in generated code, so they are documented:

| Hash | Formula |
| --- | --- |
| Scope id | `"data-v-" + FNV1a(projectRelativePath)` |
| Slotted attribute | the scope id plus a `-s` suffix, e.g. `data-v-9d968641-s` |
| Keyframes suffix | the scope id with `data-v-` stripped |
| Module class name | `original + "_" + FNV1a(shortScopeId + "-" + original)` |
| `v-bind()` custom property | `FNV1a(shortScopeId + "-" + expression)` |

## Getting the styles onto the page

The generator cannot write files — a Roslyn source generator emits C#, and `System.IO` is banned inside the
analyzer sandbox (`RS1035`). So the pipeline has **two hosts running the same core**:

- **The source generator** compiles each component's `@style` blocks and emits the result as the
  `ExtractedStyles` constant. No I/O.
- **The `ViuBundleCss` MSBuild task** runs outside the sandbox, re-runs the identical shared core over the
  identical `.viu` inputs, and writes the physical bundle.

Because both call `SingleFileComponentStyleCompiler` over the same text, the constant and the file are
**byte-identical**. These are not two generation paths; they are one deterministic compilation with two
consumers.

### The bundle

The task concatenates every component that declares at least one `@style` block, sorted by ordinal
comparison of the forward-slash project-relative path, written as UTF-8 without BOM with LF newlines only:

```css
/* <auto-generated> Viu single-file-component styles ([V01.01.12.12]). Do not edit — regenerated by the ViuBundleCss MSBuild task. */

/* Components/Card.viu (data-v-9d968641) */
.card[data-v-9d968641] {
  padding: 1rem;
}

/* Components/Panel.viu (data-v-1c4a77b2) */
…
```

If no component in the project declares any `@style` block, the task writes nothing at all.

The bundle is written to `obj/<config>/<tfm>/viu/<name>.viu.css` and registered as a `Computed`
`StaticWebAsset` (the same `DefineStaticWebAssets` path Blazor scoped CSS uses for `<App>.styles.css`), so
build and publish copy it and the dev host serves it.

### You must add the `<link>` yourself

```html
<!-- inside <head> of wwwroot/index.html -->
<link rel="stylesheet" href="MyApp.viu.css" />
```

Automatic injection is **deliberately not implemented**. Rewriting the host page's static web asset in place
desyncs the .NET SDK's compression and endpoint-negotiation graph, so the explicit reference is the shipped,
publish-safe path. Without this line your scoped and module CSS is compiled, bundled, and served — and never
applied.

A class library's bundle resolves at `_content/<PackageId>/<BundleName>`.

### Build properties

| Property | Default | Effect |
| --- | --- | --- |
| `ViuUseSingleFileComponents` | `true` under the SDK | Seeds `ViuBundleSingleFileComponentCss`. |
| `ViuBundleSingleFileComponentCss` | `true` when the above is `true`, else `false` | Master switch for physical bundling. `false` keeps `.viu` compilation but writes no bundle. |
| `ViuSingleFileComponentCssBundleName` | `$(PackageId).viu.css` | Logical file name within the static-web-asset base path. Unfingerprinted, so the `<link href>` stays stable. |
| `ViuBundleCssTaskAssembly` | path to `Assimalign.Viu.Tooling.Tasks.dll` | Where the task is loaded from. |
| `EnableSingleFileComponentGeneration` | `true` | Gates the `**/*.viu` → `AdditionalFiles` glob. |

Two traps in that table:

- **The bundle name uses `$(PackageId)`, not `$(AssemblyName)`.** For a normal app they coincide, because
  NuGet defaults `PackageId` to `AssemblyName`. A project that sets `<PackageId>` explicitly gets a
  differently named bundle, and a hand-written `<link href>` that assumed the assembly name will 404.
- **Bundling fails silently when the task assembly is missing.** The `UsingTask` and both bundling targets
  are guarded by `Exists('$(ViuBundleCssTaskAssembly)')` with no warning. A broken or overridden
  `ViuBundleCssTaskAssembly` simply means no CSS is ever written. If your bundle is missing entirely, check
  that path first.

Incrementality is two-layered: the invoking target is `Inputs`/`Outputs`-gated on `@(ViuSingleFileComponent)`,
and the task additionally content-compares against the existing file and skips the write when the bytes are
unchanged, so a no-op rebuild does not even move the timestamp.

See [The Viu SDK & Build](sdk-and-build.md) and the [MSBuild Reference](../../api/msbuild-reference.md) for
the surrounding build model.

## Diagnostics

CSS problems surface as Roslyn diagnostics located on the `.viu` file. The generator's descriptors are
enveloped by origin and severity, so every `@style` parse or rewrite error arrives as **`VIU1301`**, with
the specific CSS code riding on the message text (e.g. `… (CSS code 2006)`).

| Code | Meaning |
| --- | --- |
| `2001` | `UnterminatedComment` |
| `2002` | `UnterminatedString` |
| `2003` | `UnterminatedBlock` |
| `2004` | `UnexpectedRightBrace` |
| `2005` | `EmptySelector` |
| `2006` | `MissingDeclarationColon` |
| `2007` | `UnexpectedEndOfFile` |
| `2008` | `UnterminatedCssBinding` |
| `2009` | `EmptyCssBinding` |

Every one is recoverable: the parser reports and resynchronizes rather than throwing, so a malformed
declaration is dropped while its well-formed siblings survive and the rest of the component still compiles.
`.a { color red; margin: 0; }` reports `MissingDeclarationColon` and keeps `margin: 0`.

An unresolvable `$style` member is reported through the template pipeline as `VIU1101` instead, because the
error is in the template expression rather than the CSS. See
[Compiler Diagnostics](../../api/diagnostics.md).

## Not yet implemented

- **No CSS pre-processors** — `lang="scss"`, `lang="less"`, and any other value are parsed and preserved on
  the block, but nothing consumes them. The plain `CssSyntaxParser` is registered for **every** `@style`
  block regardless of `lang`, so SCSS syntax will simply fail to parse.
- **No camelCase style-key normalization** — this affects inline `:style` bindings rather than `@style`
  blocks, but it is the same family of surprise: a style map key must be a kebab-case CSS name
  (`"font-size"`) or a `--custom` property. A `"fontSize"` key is passed straight to `style.setProperty` and
  silently does nothing. See [Template Syntax](../essentials/template-syntax.md).
- **CSS Modules does not rename classes inside `:not(…)`** — and the same applies to `:is()`, `:where()`,
  and `:nth-child()`. Only `:deep()`, `:slotted()`, and `:global()` have parsed arguments; every other
  functional pseudo keeps its argument as opaque text. This is a documented non-goal, pinned by a test.
- **No legacy `>>>` or `/deep/` combinators** — deprecated upstream in favor of `:deep()`, and deliberately
  not ported.
- **Comments are dropped by the canonical serializers** — they survive only in a verbatim pass-through
  block (not `scoped`, no `module`, no `v-bind()`).
- **The scope attribute is never stamped on an element** — the biggest gap on this page.
  `RendererOptions<TNode>.SetScopeId` is declared but never invoked by the renderer, and no DOM renderer
  supplies it. Scoped CSS therefore compiles, bundles, and serves correctly while matching nothing, and
  `:slotted()` (which depends on the `-s` variant of the same attribute) is inert for the same reason. CSS
  Modules is unaffected — it renames classes at compile time and needs no runtime attribute.
- **`ApplyCssVariables()` is not yet called by the runtime** — see the `v-bind()` section above.
- **No automatic `<link>` injection** — deferred, for the static-web-asset reason given above.
- **No content-folded scope ids** — the hash is path-only; Vue's production cache-busting scheme is a later
  optimization.
- **No utility-first CSS engine.** The repository contains a 920-line design document specifying a
  Tailwind-style build-time utility engine, and **none of it is implemented**. There is no candidate
  scanner, no grammar parser, no theme model, no resolver, and no generated utility stylesheet. Utility
  classes (`bg-blue-500`, `md:hover:…`, `w-[32px]`, `!mt-4`), a `utility.theme.json` theme document,
  `@apply` inside `@style` blocks, a safelist, preflight, and `@tailwind`/`@layer` directives are all
  **specification only** and none of them work today. The existing bundler is designed with a seam for a
  second opaque-CSS producer, but the wiring does not exist.

The `Assimalign.Viu.Syntax.Css` library itself can parse and rewrite an existing stylesheet but cannot
**construct** one — there is no builder API for creating rule graphs from scratch. Scoped CSS never needed
one, because it only ever rewrites an already-parsed tree.

For area-by-area coverage see [Project Status](../../roadmap/status.md), and for the naming and behavioral
map against Vue 3 see [Differences from Vue 3](../../roadmap/vue-differences.md).
