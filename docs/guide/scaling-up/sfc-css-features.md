# SFC CSS Features

Ordinary component stylesheets, CSS Modules, and deferred `v-bind()` application in `.viu` and
`.vue` files, including bundling and style-only hot reload.

> **Status:** Ordinary component styles and CSS Modules are supported. Scoped CSS was removed on
> 2026-09-14 by owner decision [V01.01.06.17] (#367). `v-bind()` extraction and rewriting remain
> implemented; generated reactive application remains deferred.

Viu compiles component CSS at build time. The browser receives an ordinary stylesheet through the
component bundle; the WebAssembly runtime contains no CSS parser or stylesheet compiler.

## Component style blocks

A `.viu` file can contain several `<style>` blocks alongside `<template>` and the C# `@script { }`
block. `.vue` compatibility files use tag containers and require `lang="csharp"` for script content.
Legacy `.viu` `@style { }` blocks still parse with a migration warning.

```viu
<template>
  <div class="card">
    <h2 class="title">Card</h2>
  </div>
</template>

<style>
.card { border: 1px solid #ddd; border-radius: 6px; }
.title { font-size: 1.25rem; }
</style>
```

These selectors follow the ordinary global CSS cascade. A rule may match any element with the
matching class, including elements rendered by other components. Use distinctive class names or
[CSS Modules](#css-modules) when component-specific class names are needed.

| Option | Meaning |
| --- | --- |
| `module` | Rename local classes and expose their names through the generated `Style` accessor. |
| `module="theme"` | Generate a named accessor, such as `Theme`, referenced as `theme` in templates. |
| `lang="scss"` | Preserve the language declaration; this does not install a preprocessor. |

See [Single-File Components](single-file-components.md) for container grammar and source locations.

## Scoped CSS removal

Viu does not support scoped CSS. The 2026-09-14 owner decision removed the `scoped` style feature,
selector rewriting, generated scope attributes in interactive and server output, scope identifiers,
and the deferred runtime restamping plan. Issue #319 was closed as superseded by
[#367](https://github.com/assimalign/viu/issues/367).

Both containers preserve the option token so diagnostics point to the authored `scoped` name:

| Input | Build diagnostic | Editor diagnostic | Result |
| --- | --- | --- | --- |
| `.viu` `<style scoped>` or legacy `@style scoped { }` | `VIU1001`, Error; parser code 1018 | `VIU1018`, Error | Remove the option or use a CSS module. |
| `.vue` `<style scoped>` | `VIU1002`, Warning; parser code 1019 | `VIU1019`, Warning | Compile the block as ordinary global CSS. |

The diagnostic message is:

> Scoped styles are not supported; Viu compiles component styles as ordinary global stylesheets.
> Remove the scoped option or use a CSS module.

Removing `scoped` does not retain selector isolation. For class isolation, switch to `<style module>`
and bind generated class names in the template. The scoped-style `:deep()` and `:slotted()` selector
rewrites are no longer available; use ordinary CSS selectors or CSS Module class bindings.

## CSS Modules

`<style module>` renames local class selectors to hashed names. The generator emits a nested
`static class` of `const string` members mapping authored names to compiled names.

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

Module class names retain a deterministic path-derived salt and an eight-digit lowercase hash.
Two components can declare the same local class and receive distinct compiled names.

## `v-bind()` in CSS

Compile-time processing of `v-bind()` is retained for ordinary component styles. A well-formed
binding is replaced by a hashed CSS custom-property reference:

```viu
<style>
.swatch { background: v-bind(Color); width: calc(v-bind(Size) + 2px); }
</style>
```

The resulting declaration uses `var(--<hash>)`. The compiler records expressions, skips string
literals and comments, balances nested parentheses, strips one surrounding quote pair, trims
whitespace, and de-duplicates normalized expression text. For example, `content: "v-bind(x)"` is a
literal string and is not a binding. Malformed bindings report `UnterminatedCssBinding` or
`EmptyCssBinding` and recover.

**Generated reactive application remains deferred** under specification clauses [STY-6]–[STY-8].
The compiler currently emits no CSS-variable application. This is a separate design for ordinary
component styles; it does not restore scoped CSS or depend on a planned host-range seam.

The public `Assimalign.Viu.Browser.CssVariables` directive, including `CssVariables.Bind`, remains
available for explicit single-element bindings. The future generated application needs an explicit
component owner, reactive lifetime, and element-targeting design.

## Serialization and stable names

| Block | Serialization |
| --- | --- |
| Ordinary style without `module` or `v-bind()` | Verbatim content, including whitespace and comments. |
| A module or a style rewritten by `v-bind()` | Canonical CSS through `CssStylesheetWriter`. |

Canonical output uses two-space indentation, `property: value;`, and LF line endings; comments are
not re-emitted. `!important` survives both paths. No serialization path adds scope selectors or
renames ordinary keyframes for scoping.

Module names and `v-bind()` custom properties retain their deterministic path-derived salt. Moving
or renaming a component may change those names; changing its CSS content alone does not change the
salt. This hash is a compile-time naming input and is not a style-scope identifier.

## Bundling, library packing, and hot reload

The source generator and `ViuBundleCss` task call the shared component-style compiler. The generator
emits extracted styles as C# metadata; the task writes the physical stylesheet outside the analyzer
sandbox. Components are ordered by normalized project-relative path, and the bundle uses UTF-8
without BOM and LF line endings.

The base `Assimalign.Viu.Sdk` packs a component library's `.viu.css` with generated `buildTransitive`
registration. `Assimalign.Viu.Sdk.Browser` bundles application styles, delivers referenced-library
styles under `_content/<PackageId>/`, and injects links in library-before-application order. The
application bundle retains the last cascade position. An existing matching link is preserved.

Ordinary component styles and CSS Modules use the same bundle and CSS hot-reload worker. A style-only
edit regenerates the bundle and replaces its stylesheet link without remounting the component.
Style block hashes include option tokens, so an option-only edit still invalidates compilation.
Identical generated bytes do not rewrite the bundle or trigger a stylesheet update.

| Property | Default | Effect |
| --- | --- | --- |
| `ViuBundleSingleFileComponentCss` | `ViuUseSingleFileComponents` | Enable component CSS bundling and library style packing. |
| `ViuSingleFileComponentCssBundleName` | `$(PackageId).viu.css` | Select the bundle name. |
| `ViuInjectSingleFileComponentCssLink` | `true` for Browser apps | Inject component stylesheet links. |
| `ViuUseFingerprintedSingleFileComponentCssBundleLink` | `false` | Opt into the labeled fingerprinted application endpoint. |
| `ViuCssHotReloadEnabled` | Enabled for the development loop | Enable the generated stylesheet worker. |

See [The Viu SDK & Build](sdk-and-build.md) and [MSBuild Reference](../../api/msbuild-reference.md)
for the surrounding build model. No MSBuild switch re-enables scoped CSS.

## Diagnostics and limits

CSS parse and rewrite errors appear as located `VIU1301` generator diagnostics, with the specific
CSS code appended to the message. Container option diagnostics use the separate codes listed above.
An unknown CSS-module member reports `VIU1101` through the template pipeline.

| CSS code | Meaning |
| --- | --- |
| 2001 | `UnterminatedComment` |
| 2002 | `UnterminatedString` |
| 2003 | `UnterminatedBlock` |
| 2004 | `UnexpectedRightBrace` |
| 2005 | `EmptySelector` |
| 2006 | `MissingDeclarationColon` |
| 2007 | `UnexpectedEndOfFile` |
| 2008 | `UnterminatedCssBinding` |
| 2009 | `EmptyCssBinding` |

CSS Modules do not rename classes inside opaque functional pseudo-selector arguments such as
`:not(...)`, `:is(...)`, and `:where(...)`. A `lang` option does not enable an SCSS or LESS
preprocessor. These limits are separate from the removal of scoped CSS.

See [Compiler Diagnostics](../../api/diagnostics.md) and [Project Status](../../roadmap/status.md).
