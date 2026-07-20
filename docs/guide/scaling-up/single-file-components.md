# Single-File Components (.viu)

The authoritative specification for the `.viu` file format — its `@`-block container, its one structural
rule, and the `partial class` the Roslyn source generator emits from it.

> **Status:** Partial. The format, the block parser, the source generator, and the CSS pipeline are
> implemented and test-pinned. The runtime adapter that turns a generated `.viu` partial class into an
> `IComponentDefinition` is not yet built — see [Not yet implemented](#not-yet-implemented) and
> [Project status](../../roadmap/status.md).

## The `@`-block container is a deliberate divergence

Vue wraps SFC blocks in HTML-like tags — `<template>`, `<script>`, `<style>`. Viu does not. A `.viu` file
uses **`@`-block container syntax** (design decision, 2026-07-17):

```viu
@template {
    <div>{{ Message }}</div>
}

@script {
    public string Message = "Hello";
}

@style scoped {
    .box { color: red; }
}
```

Only the *container* differs. Block **semantics** — what `template`, `script`, `style`, and custom blocks
mean, and what their options mean — follow the [Vue SFC specification](https://vuejs.org/api/sfc-spec.html)
unchanged. The markup inside `@template` is standard Vue template syntax, parsed later by the template
compiler (see [Template Syntax](../essentials/template-syntax.md)).

| `.viu`                          | Vue SFC                         | Meaning                                        |
| ------------------------------- | ------------------------------- | ---------------------------------------------- |
| `@template { … }`               | `<template> … </template>`      | The component's markup.                        |
| `@script { … }`                 | `<script> … </script>`          | The component's C# partial-class body.         |
| `@style { … }`                  | `<style> … </style>`            | Component CSS; a file may declare several.     |
| `@style scoped { … }`           | `<style scoped>`                | [Scoped CSS](https://vuejs.org/api/sfc-css-features.html#scoped-css). |
| `@style module { … }`           | `<style module>`                | [CSS Modules](https://vuejs.org/api/sfc-css-features.html#css-modules), default name. |
| `@style module="theme" { … }`   | `<style module="theme">`        | CSS Modules bound to a named accessor.         |
| `@docs { … }` (any other name)  | `<docs>`                        | Custom block, preserved verbatim.              |

## Column 0 is structural

The entire format rests on one rule, and it is deliberately language-agnostic — the parser knows no C#, no
CSS, and no HTML:

> **A block opened by a header line closes at the first later line whose first column is `}`.**

- **At the top level** — a line whose first column is `@` begins a block header.
- **Inside a block** — a line whose first column is `}` closes the block.
- **Everything else** — content (inside a block) or stray content (at the top level).

Nothing else is examined. The parser scans line starts only. Blank and whitespace-only lines at the top
level are skipped silently — they separate blocks and never report `StrayTopLevelContent`.

### Block content must be indented

This is the one requirement the format places on authors. Because only the first column is inspected,
unbalanced or literal braces *inside* content never terminate a block:

```viu
@script {
    var json = "{ \"a\": 1 }";   // literal { and } inside a C# string — fine
    var closing = "}";           // the } is not at column 0 — fine
}
```

```viu
@style {
    .a {
        color: red;
    }
    .b { color: blue; }
}
```

The flip side is documented behavior, not a bug. CSS written flush against column 0 closes the block early:

```viu
@style {
.a {
    color: red;
}
}
```

Here the third line's `}` closes the `@style` block, and the fourth line's `}` becomes
`StrayTopLevelContent`. Indent every block body and the problem cannot arise.

### Further consequences

- **An indented header is not a header** — `    @template {` at the top level is `StrayTopLevelContent`,
  not a block. Symmetrically, an indented `@template {` *inside* a block is just content.
- **The opening `{` must be the last non-whitespace character on the header line** — content begins on the
  next line. Anything else reports `ContentAfterOpeningBrace`, though the block still opens.
- **Text after the closing `}` is ignored** — so `} // closes the block` is a valid closer. The block's
  whole-span location ends immediately past the `}`.
- **CRLF is preserved verbatim**, and a file that ends without a trailing newline still closes its last
  block correctly.

## Block headers

A header line has the shape `@<name> <options>? {`.

- **Names match `[A-Za-z_][A-Za-z0-9_-]*`** — a letter or `_`, then letters, digits, `_`, or `-`.
- **The three well-known names are matched case-sensitively, in lowercase** — `template`, `script`,
  `style`. `@Template` is therefore a *custom* block, not a template block.
- **Options are valueless flags or double-quoted key/value pairs** — `scoped`, `lang="scss"`. There must
  be no whitespace around `=`, but the two sides fail differently: an unquoted or missing value
  (`lang=scss`, `lang= "scss"`) reports `MalformedOptionValue`, while whitespace *before* the `=`
  (`lang = "scss"`) parses `lang` as a valueless flag and then reports the orphaned `=` and `"scss"` as
  `MalformedBlockHeader`. There is no escape syntax, so a value cannot contain a double quote.
- **No space is required before the brace** — `@style scoped{` is valid, and tabs count as inline
  whitespace in a header.
- **Unknown options are preserved, not rejected** — reach them through
  `SingleFileComponentBlock.HasOption(name)` and `SingleFileComponentBlock.GetOptionValue(name)`, both of
  which compare ordinally.

Typed options surface as properties: `SingleFileComponentStyleBlock.Scoped`,
`SingleFileComponentStyleBlock.IsModule`, `SingleFileComponentStyleBlock.ModuleName`, and
`SingleFileComponentBlock.Lang`. Note that `ModuleName` is `null` both when `module` is absent *and* when
it is present as a valueless flag — test presence with `IsModule`.

## Cardinality and content slicing

- **At most one `@template` and one `@script` per file** — a second of either reports
  `DuplicateTemplateBlock` or `DuplicateScriptBlock` and is ignored. The **first** is kept.
- **Any number of `@style` and custom blocks** — preserved in source order.
- **`Content` is the exact raw slice** — it starts at the first character of the line after the header and
  ends at the first character of the closing-brace line. It is never trimmed or normalized; interior
  indentation and the trailing newline before the `}` are preserved. An empty body yields `""`.

## A complete component

```viu
@template {
    <div class="counter">
        <p>Count is {{ Count }}</p>
        <button @click="Increment()">Increment</button>
        <button @click="Count--" :disabled="Count == 0">Decrement</button>
        <ul>
            <li v-for="entry in History" :key="entry.Id">{{ entry.Label }}</li>
        </ul>
        <p v-if="Count >= 10">You have counted to {{ Count }}.</p>
    </div>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count = Reactive.Reference(0);

    public ReactiveList<HistoryEntry> History = new();

    public sealed record HistoryEntry(int Id, string Label);

    public void Increment()
    {
        Count.Value++;
        History.Add(new HistoryEntry(History.Count, $"Counted to {Count.Value}"));
    }
}

@style scoped {
    .counter {
        display: grid;
        gap: 0.5rem;
    }

    .counter button {
        cursor: pointer;
    }
}
```

Two things in that template are worth naming. First, `Count` is declared as a `Reference<int>`, so the
compiler inserts `.Value` in **both** read and write positions — `{{ Count }}` emits
`_toDisplayString(_ctx.Count.Value)`, and `@click="Count--"` becomes the inline handler lambda
`__event => (_ctx.Count.Value--)`. Second, expression bodies are **C#, not JavaScript**;
`$"Counted to {Count.Value}"` is legal inside `@script` because that
block is verbatim C#, while template expressions are parsed with Roslyn's `SyntaxFactory.ParseExpression`.
See [Template Syntax](../essentials/template-syntax.md) for the full expression rules and
[Reactivity Fundamentals](../essentials/reactivity-fundamentals.md) for `Reference<T>`.

## What the generator emits

`SingleFileComponentGenerator` is an `IIncrementalGenerator` that selects every `AdditionalText` whose
path ends in `.viu`, reads `build_property.RootNamespace` and `build_property.ProjectDir`, and emits one
`partial class` per component. Taking the three-block `Message` example from the top of this page as
`C:/proj/Counter.viu` with `RootNamespace=Demo`, the generator produces
`Counter.SingleFileComponent.g.cs` — shown here with the scaffold's descriptive comments and XML doc
comments elided for length:

```csharp
// <auto-generated/>
#nullable enable

using static global::Assimalign.Viu.RuntimeCore.RenderHelpers;
using static global::Assimalign.Viu.RuntimeDom.DomRenderHelpers;

namespace Demo
{
    partial class Counter
    {
        internal const int RenderCacheSize = 0;

        internal static object? Render(Counter _ctx, object?[] _cache)
        {
#line (2,13)-(2,20) 88 "C:/proj/Counter.viu"
            return _createElementBlock(_openBlock(), "div", null, _toDisplayString(_ctx.Message), 1 /* TEXT */);
#line default
        }

#line 6 "C:/proj/Counter.viu"
    public string Message = "Hello";
#line default

        internal const string ScopeId = "data-v-9d968641";

        internal const string ExtractedStyles = ".box[data-v-9d968641] {\n  color: red;\n}\n";
    }
}
```

### Reserved member names

The generator emits only the following members. Everything else in the class comes from your `@script` or
from a sibling `.cs` partial — and a sibling partial must **not** redeclare any of these:

| Member                          | Emitted when                                    |
| ------------------------------- | ----------------------------------------------- |
| `Render`                        | The component has an `@template` block.         |
| `RenderCacheSize`               | The component has an `@template` block.         |
| `ScopeId`                       | At least one `@style` block is `scoped`.        |
| `ExtractedStyles`               | The component declares any `@style` block.      |
| `ApplyCssVariables`             | A `@style` block uses `v-bind()`.               |
| CSS-module accessor classes     | A `@style` block is `module` — `Style`, or the pascal-cased module name. |

The two `using static` imports are emitted **only** when a render body exists. Render helpers bind purely
**by name**; the generator never references the runtime assembly. The practical consequence is that any
project compiling generated render bodies must reference `Assimalign.Viu.RuntimeDom`, even for a component
whose template touches nothing DOM-specific.

### How `@script` is merged

The `@script` block is split at a **line boundary**: leading `using` directives — plain, `using static`,
and aliases — are hoisted **above** the namespace in the generated file; everything after goes into the
partial-class body. Both regions carry their own `#line` anchor, and the content is emitted flush at
column 0 with no re-indentation, precisely so the `#line` map preserves each token's column.

The result is that compiler errors and debugger stepping land on the `.viu` file at the exact line and
column, not on the generated file. Note that the generator's own `@script` diagnostics are **syntactic
only** — semantic errors such as type mismatches surface when the generated C# is compiled and are
relocated onto the `.viu` file by the `#line` map, visible through `GetMappedLineSpan()`.

### Binding classification

The generator classifies each `@script` member syntactically, which is what drives ref unwrapping in the
template. Reference types are matched by **simple type name only** — the recognized set is exactly
`Reference`, `ShallowReference`, `CustomReference`, `Computed`, and `IReference`. Namespace qualification
and nullable annotations are unwrapped first, so `Reactivity.Reference<int>` and `Reference<int>?` both
classify; any other type name does not, whatever it actually is at runtime.

| `@script` declaration                        | Classification    | Template emission     |
| -------------------------------------------- | ----------------- | --------------------- |
| `public Reference<int> Count;`               | `SetupReference`  | `_ctx.Count.Value`    |
| `public ShallowReference<int> Shallow;`      | `SetupReference`  | `_ctx.Shallow.Value`  |
| `public Computed<string> Label { get; }`     | `SetupReference`  | `_ctx.Label.Value`    |
| `public const int Max = 10;`                 | `LiteralConstant` | `_ctx.Max`            |
| `public readonly string Name = "x";`         | `SetupConstant`   | `_ctx.Name`           |
| `public int Mutable = 0;`                    | `SetupLet`        | `_ctx.Mutable`        |
| `public int Total { get; set; }`             | `SetupLet`        | `_ctx.Total`          |
| `public int Compute() => 1;`                 | `SetupConstant`   | `_ctx.Compute()`      |

Only fields, properties, and methods are classified; constructors, events, operators, and nested types are
skipped. Field precedence is reference type, then `const`, then `readonly`, then mutable. A non-reference
property is `SetupLet` when it has a `set` accessor and `SetupConstant` otherwise — an `init` accessor or
an expression body counts as get-only. A multi-declarator field classifies every variable with the shared
field type. Classification is deliberately conservative: `SetupReference` is the only binding the template
ever unwraps, so a misclassification can never emit a wrong `.Value`.

### Name resolution

| `.viu` path (with `ProjectDir=C:/proj`, `RootNamespace=Demo`) | Namespace        | Class      | Hint name                                    |
| ------------------------------------------------------------- | ---------------- | ---------- | -------------------------------------------- |
| `C:/proj/Counter.viu`                                          | `Demo`           | `Counter`  | `Counter.SingleFileComponent.g.cs`           |
| `C:/proj/Components/Counter.viu`                               | `Demo.Components`| `Counter`  | `Components.Counter.SingleFileComponent.g.cs`|
| `C:/proj/class.viu`                                            | `Demo`           | `@class`   | `class.SingleFileComponent.g.cs`             |

Sanitization is lossy — `Foo-Bar.viu` and `Foo_Bar.viu` both produce `class Foo_Bar` — so hint names carry
an eight-hex FNV-1a path hash suffix when needed, guaranteeing `AddSource` never collides.

## Build integration

No per-project wiring is required. The shipped props and targets do the work — the C# analog of how
`@vitejs/plugin-vue` auto-includes `.vue` files:

```xml
<PropertyGroup>
  <EnableSingleFileComponentGeneration>true</EnableSingleFileComponentGeneration>
</PropertyGroup>

<ItemGroup>
  <ViuSingleFileComponentExclude Include="Experimental.viu" />
</ItemGroup>
```

- **`EnableSingleFileComponentGeneration`** — the master switch, defaulting to `true`. When on, every
  `**/*.viu` file is globbed into `ViuSingleFileComponent` and then into `AdditionalFiles` with
  `KeepDuplicates="false"`, and `RootNamespace` / `ProjectDir` are surfaced as `CompilerVisibleProperty`.
- **`ViuSingleFileComponentExclude`** — opts individual files out of the glob.

The generator reads **only** `.viu` additional files plus those two build properties — never the
`Compilation`, symbols, or `SourceText` — so unrelated C# edits never re-run it. See
[The Viu SDK & Build](./sdk-and-build.md) for the surrounding SDK, and
[SFC CSS Features](./sfc-css-features.md) for scoped styles, CSS Modules, `v-bind()`, and the CSS bundle.

## Diagnostics

Parsing is fully recoverable and **never throws** for bad content. The only exception is
`ArgumentNullException` for a `null` source argument, which is API misuse rather than input. Multiple
problems are reported in a single pass.

| Code                       | Value | Raised when                                                | Block opens? |
| -------------------------- | ----- | ---------------------------------------------------------- | ------------ |
| `StrayTopLevelContent`     | 1001  | Non-whitespace text appears outside any block.             | n/a          |
| `MalformedBlockHeader`     | 1002  | A top-level line begins with `@` but no valid name follows.| No           |
| `MissingOpeningBrace`      | 1003  | A header names a block but has no opening `{`.             | No           |
| `ContentAfterOpeningBrace` | 1004  | Non-whitespace follows the opening `{`.                    | Yes          |
| `MalformedOptionValue`     | 1005  | An option value is not a well-formed double-quoted string. | Usually      |
| `DuplicateTemplateBlock`   | 1006  | A file declares more than one `@template`.                 | First kept   |
| `DuplicateScriptBlock`     | 1007  | A file declares more than one `@script`.                   | First kept   |
| `UnterminatedBlock`        | 1008  | End of file is reached with no column-0 `}`.               | Yes, to EOF  |

The recovery policy behind that last column: a structurally openable header — a valid name plus a `{` —
**always** opens its block, so option and trailing-content problems never cost you the sliced content. A
header only fails to open when it has no valid name or no `{`. Two consequences are easy to miss.
`MalformedBlockHeader` is also raised for a stray token *inside* an otherwise valid header, and there the
block still opens. `MalformedOptionValue` normally opens the block, but an unterminated quoted value
(`@style lang="scss`) consumes the rest of the line including any `{`, so that header has no brace left to
open with and is skipped.

Their user-visible messages are, verbatim:

- **1001** — Stray content outside any block. Text must live inside an `@template`, `@script`, `@style`, or
  custom block.
- **1002** — Malformed block header. A block opens with `@<name>` at column 0.
- **1003** — Block header is missing its opening `{`.
- **1004** — Unexpected content after the opening `{`. The `{` must be the last non-whitespace character on
  the header line.
- **1005** — Malformed option value. Option values must be double-quoted, e.g. `lang="scss"`.
- **1006** — Duplicate `@template` block. A `.viu` file may contain at most one `@template`.
- **1007** — Duplicate `@script` block. A `.viu` file may contain at most one `@script`.
- **1008** — Unterminated block. Expected a closing `}` at column 0 before end of file.

### How they reach the build

Roslyn descriptors are enveloped by **origin × severity**, not one descriptor per catalog code. The
per-language code rides on the message text:

| Origin                      | Error     | Warning   | Information | Message suffix example          |
| --------------------------- | --------- | --------- | ----------- | ------------------------------- |
| `.viu` block container      | `VIU1001` | `VIU1002` | `VIU1003`   | ` (single-file-component code 1001)` |
| Dispatched `@template` parse| `VIU1101` | `VIU1102` | `VIU1103`   | ` (template compiler code 25)`  |
| `@script` C# parse          | `VIU1201` | `VIU1202` | `VIU1203`   | ` (C# script code CS1525)`      |
| Dispatched `@style` CSS parse| `VIU1301`| `VIU1302` | `VIU1303`   | ` (CSS code 2006)`              |

So a stray-content error surfaces as `VIU1001` located on the `.viu` file, with `1001` in the message —
never as a `VIU1001`-style ID minted per `SingleFileComponentErrorCode` value. Severity is configurable
through `.editorconfig` with `dotnet_diagnostic.VIU####.severity`. See
[Compiler Diagnostics](../../api/diagnostics.md) for the full catalog.

Even when diagnostics are reported, the generator still emits the partial-class scaffold, so a single
malformed block does not cascade into hundreds of missing-type errors.

## The parser as an API

The format is also consumable directly. `SingleFileComponentParser.Parse` is the pure block-slicing entry
point — it never looks inside a block's content, so it needs neither the template compiler nor the CSS
parser:

```csharp
using System;
using System.Linq;

using Assimalign.Viu.Syntax.SingleFileComponent;

var result = SingleFileComponentParser.Parse(source);

foreach (var error in result.Errors)
{
    Console.WriteLine($"{error.Code} at line {error.Location.Start.Line}: {error.Message}");
}

var descriptor = result.Descriptor;
var markup = descriptor.Template?.Content;
var scoped = descriptor.Styles.Where(style => style.Scoped).ToList();
```

`SingleFileComponentParseResult` always produces a `SingleFileComponentDescriptor`, even for malformed
input. For the registration-friendly form that dispatches each block to a language parser, use
`SingleFileComponentSyntaxParser.ParseComponent`, whose result exposes `Nodes` in **source order** where
the descriptor groups by kind, `Diagnostics` in place of `Errors`, and the per-block parses on
`SourceResults`.

`SingleFileComponentParserFactory` is the shared composition root, and it offers two builds. `Create()`
registers `TemplateSyntaxParser` for `@template` and `CssSyntaxParser` for `@style`; this is what the
source generator uses. `CreateForStyleExtraction()` registers only the CSS parser, which is how the
`ViuBundleCss` MSBuild task (through `SingleFileComponentStyleBundler`) reads `@style` blocks without ever
loading the template compiler and its Roslyn dependency. Both yield byte-identical `@style` results,
because block slicing happens first and each block's dispatch is independent.

Two API details worth internalizing: `Position.Offset` is **zero-based** while `Position.Line` and
`Position.Column` are **one-based**; and every span satisfies
`Location.Source == source.Substring(Start.Offset, End.Offset - Start.Offset)`.

Descriptors, blocks, and every pipeline record are immutable value-equatable types, which is the
incremental-caching contract. A whitespace shift such as a leading blank line changes every offset, makes
descriptors unequal, and invalidates the cache — by design.

## Not yet implemented

- **The `.viu` component runtime adapter** — the generated partial class carries a `static Render` method
  and `RenderCacheSize`, but nothing yet wires it into `IComponentDefinition.Setup`. Today the only proof
  is a test harness that invokes `Render(this, cache)` by hand. Hand-written components
  (see [Components](../essentials/components.md)) are the working path.
- **`ApplyCssVariables()` is emitted but never called** — the method and its metadata are generated; the
  call during component setup lands with the component runtime above.
- **CSS pre-processors** — `lang="scss"` and `lang="less"` are parsed and preserved on the block, and
  surfaced as `Block.Lang`, but no pre-processor exists anywhere in the repo.
  `SingleFileComponentParserFactory.Create()` registers the plain `CssSyntaxParser` for **every** `@style`
  block regardless of its `lang`. SCSS will not compile.
- **`@template lang` and `@script lang`** — likewise parsed and preserved but never dispatched on. The
  template parser runs unconditionally, and `@script` is always analysed as C#.
- **No `<script setup>` versus options-API distinction** — every `@script` block is treated uniformly, and
  the generator's binding metadata sets `IsScriptSetup: true` for any component that declares an `@script`
  block at all. (A scriptless component gets `BindingMetadata.Empty`, where the flag is `false`.) There is
  no `setup` block option and no options-API path. This matches Viu's broader stance: see
  [Differences from Vue 3](../../roadmap/vue-differences.md).
- **No warning or informational container diagnostics** — `SingleFileComponentError` hard-codes
  `DiagnosticSeverity.Error`. The `VIU1002`/`VIU1003` tiers and their siblings exist as descriptors but no
  parser emits them today.
- **The VIU IDs are not yet a frozen contract** — all twelve descriptors are still in
  `AnalyzerReleases.Unshipped.md`.
- **Content-folded scope-id hashing** — the scope id is derived from the project-relative **path**, so
  editing a component never changes it, but moving or renaming the file does. Folding content into the
  hash is a later optimization.
- **No shipped end-to-end `.viu` example project** — the repo contains only `.designing/SampleApp/App.viu`,
  a near-empty shell. The one working demo is hand-written; see [Stopwatch](../../examples/stopwatch.md).
