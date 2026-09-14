# Compiler Diagnostics

Every build-time diagnostic a Viu author can hit, what emits it, and how to read the code buried in
the message.

> **Status:** Implemented. Every descriptor and catalog code below exists in the source generators
> and is test-pinned. The IDs are not yet a frozen public contract — both
> `AnalyzerReleases.Shipped.md` files are still empty. See [Project status](../roadmap/status.md).

Viu does all of its compilation at build time, so almost every mistake you can make in a `.viu` file
or a `[Reactive]` class surfaces as a Roslyn diagnostic in `dotnet build` output rather than as a
runtime error. Vue reports the equivalent problems from
[`@vue/compiler-sfc`](https://vuejs.org/api/sfc-spec.html) at bundle time; Viu reports them from two
source generators.

## Two ID families

There are two generators, shipped in two packages, and they do **not** share a prefix:

- **`VIU####`** — emitted by `SingleFileComponentGenerator` in
  `Assimalign.Viu.Syntax.Generators`, for everything wrong with a `.viu` file.
- **`VUER####`** — emitted by the `[Reactive]` generator in
  `Assimalign.Viu.Reactivity.Generators`, for everything wrong with a reactive class.

The prefixes were minted independently and have not been unified. Suppressions, `.editorconfig`
rules, and `#pragma warning disable` lines must use the actual prefix — there is no `VIU` alias for a
`VUER` code.

## The `VIU` catalog: origin × severity

The `.viu` pipeline is four parsers stacked on one file — the block container, the template
compiler, Roslyn over the `@script` C#, and the CSS parser. Each of those has its own unbounded code
catalog, and a Roslyn generator cannot mint one `DiagnosticDescriptor` per catalog entry without
mirroring all four catalogs. So the generator **envelopes** each diagnostic by its origin and its
severity, producing exactly twelve descriptors.

| ID | Severity | Origin | Title |
| --- | --- | --- | --- |
| `VIU1001` | Error | `.viu` block container | Single-file component parse error |
| `VIU1002` | Warning | `.viu` block container | Single-file component parse warning |
| `VIU1003` | Info | `.viu` block container | Single-file component parse information |
| `VIU1101` | Error | dispatched `@template` parse | Single-file component template parse error |
| `VIU1102` | Warning | dispatched `@template` parse | Single-file component template parse warning |
| `VIU1103` | Info | dispatched `@template` parse | Single-file component template parse information |
| `VIU1201` | Error | Roslyn parse of `@script` C# | Single-file component script parse error |
| `VIU1202` | Warning | Roslyn parse of `@script` C# | Single-file component script parse warning |
| `VIU1203` | Info | Roslyn parse of `@script` C# | Single-file component script parse information |
| `VIU1301` | Error | dispatched `@style` CSS parse | Single-file component style parse error |
| `VIU1302` | Warning | dispatched `@style` CSS parse | Single-file component style parse warning |
| `VIU1303` | Info | dispatched `@style` CSS parse | Single-file component style parse information |

Every descriptor uses the category `Assimalign.Viu.Syntax.Generators` and the message format `{0}` —
the underlying parser's own message is carried through verbatim.

### The real code rides on the message

Because there is one descriptor per origin, **the ID does not identify the error**. The per-language
catalog code is appended to the message text in a fixed shape:

| Origin | Message suffix | Example |
| --- | --- | --- |
| `.viu` block container | ` (single-file-component code N)` | ` (single-file-component code 1001)` |
| `@template` | ` (template compiler code N)` | ` (template compiler code 25)` |
| `@script` | ` (C# script code CSNNNN)` | ` (C# script code CS1525)` |
| `@style` | ` (CSS code N)` | ` (CSS code 2006)` |

The template compiler code is one or two digits for the upstream-pinned band and four digits for the
Viu-only band; do not assume a fixed width.

So for this `Counter.viu` —

```viu
@template {
<b>
{{ message
</b>
}
```

— the unterminated interpolation on line 3 produces:

```sh
Counter.viu(3,1): error VIU1101: Interpolation end sign was not found. (template compiler code 25)
```

Never write a build script, a suppression, or a lint rule that expects `VIU1101` to mean one
specific problem. If you need to key off a specific failure, match on the suffix.

Three practical consequences:

- **Locations are always on the `.viu` file** — a diagnostic from a nested block is composed from
  the block's content-start position back into whole-file coordinates, so the line and column point
  at the offending character in the `.viu` source, not at generated C#.
- **Severity is fixed per descriptor** — `Diagnostic.Create` reports at the descriptor's severity,
  which is why the family is split three ways instead of carrying severity as data.
- **`Hidden` collapses into the `Info` descriptor** rather than being dropped.

Container diagnostics carry their declared severity. In particular, `.vue` scoped styles report a
warning and compile as ordinary global CSS, while `.viu` scoped styles report an error.

Two more things worth knowing before you rely on these IDs:

- **All twelve descriptors are still listed in `AnalyzerReleases.Unshipped.md`;**
  `AnalyzerReleases.Shipped.md` is empty. The IDs become a frozen public contract only once shipped.
- **The `helpLinkUri` on all twelve `VIU` descriptors is stale.** It points at a `DIAGNOSTICS.md`
  under the old `vuecs` repository slug. The repository is `github.com/assimalign/viu`; follow the
  paths, not the slug. The `VUER` descriptors set no `helpLinkUri` at all.

## Unsupported scoped styles

Scoped CSS was removed on 2026-09-14 by owner decision [V01.01.06.17]
([#367](https://github.com/assimalign/viu/issues/367)). The parser preserves the `scoped` option token
and locates the diagnostic on its name.

| Input | Parser code | Generator diagnostic | Editor diagnostic | Behavior |
| --- | --- | --- | --- | --- |
| `.viu` `<style scoped>` or legacy `@style scoped { }` | 1018, `ScopedStyleNotSupported` | `VIU1001`, Error | `VIU1018`, Error | Remove the option or use a CSS module. |
| `.vue` `<style scoped>` | 1019, `VueScopedStyleNotSupported` | `VIU1002`, Warning | `VIU1019`, Warning | Compile as ordinary global CSS. |

Both report:

> Scoped styles are not supported; Viu compiles component styles as ordinary global stylesheets.
> Remove the scoped option or use a CSS module.

The source generator wraps parser codes by origin and severity; the editor prefixes each raw parser
code with `VIU`. The differing IDs identify the same located problem in those two hosts.
Ordinary component styles, bundling, hot reload, and
[CSS Modules](../guide/scaling-up/sfc-css-features.md#css-modules) remain supported. Compile-time
`v-bind()` extraction and rewriting remain; generated reactive application is deferred.

## `VUER` — the `[Reactive]` generator

Four descriptors, all in category `Assimalign.Viu.Reactivity.Generators`. These *are* one-per-problem,
unlike the `VIU` family. The generator source declares the IDs frozen, but like the `VIU` family they
are still listed only in `AnalyzerReleases.Unshipped.md`.

| ID | Severity | Aborts generation? | Message |
| --- | --- | --- | --- |
| `VUER1001` | Error | Yes, for that type | `'{0}' is marked reactive but is not declared 'partial'; add the 'partial' modifier so the generator can implement its properties` |
| `VUER1002` | Error | Yes, for that type | `'{0}' is marked reactive but is 'static'; reactive objects must be instantiable` |
| `VUER1003` | Warning | No — that property is skipped | `Reactive partial property '{0}' must declare both a getter and a non-init setter; it will not be made reactive` |
| `VUER1004` | Error | Yes — no source at all | `'{0}' has both [Reactive] and [ShallowReactive]; apply exactly one` |

`VUER1001` — the attributed type is not `partial`, so there is no second part for the generator to
contribute:

```csharp
using Assimalign.Viu.Reactivity;

// VUER1001: 'TodoItem' is marked reactive but is not declared 'partial'.
// C# also rejects this on its own — a partial property may only appear in a partial type — so
// expect a CS error on 'Title' alongside VUER1001.
[Reactive]
public class TodoItem
{
    public partial string Title { get; set; }
}
```

```csharp
using Assimalign.Viu.Reactivity;

// Correct: partial class, partial properties, each with a getter and a non-init setter.
[Reactive]
public partial class TodoItem
{
    public partial string Title { get; set; }
    public partial bool Completed { get; set; }
}
```

`VUER1003` is the one to watch, because it is a *warning* and the class still compiles — the
offending property simply is not reactive, and a watcher on it will never fire:

```csharp
using Assimalign.Viu.Reactivity;

[Reactive]
public partial class Settings
{
    // VUER1003: get-only. Silently non-reactive if you ignore the warning.
    public partial string Theme { get; }

    // VUER1003: init-only setters are not settable after construction.
    public partial int FontSize { get; init; }

    // Fine.
    public partial bool DarkMode { get; set; }
}
```

`VUER1004` is reported exactly once — the deep `[Reactive]` pass reports the conflict and the
`[ShallowReactive]` pass stays silent — and the generator emits **no source at all** for that type,
so expect a cascade of "partial property must have an implementation part" errors from the C#
compiler underneath it. Fix `VUER1004` first and the rest disappear. `VUER1001` and `VUER1002` abort
the same way: a non-`partial` or `static` type gets no generated part, with the same cascade.

For what the generator actually emits, and the reserved `__{Property}Value` /
`__{Property}Dependency` member names, see
[Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md).

## `.viu` container catalog — `SingleFileComponentErrorCode`

These are the codes carried in a `VIU1001` message as ` (single-file-component code NNNN)`. They are
Viu-defined and have no upstream `vuejs/core` counterpart — the `@`-block container is Viu's own
divergence from Vue's tag-wrapped SFC. The catalog is 1000-based (lowest member `1001`) to stay
visibly distinct from the CSS catalog (2000-based) and the template catalog (upstream-pinned,
0-based).

| Code | Name | Message |
| --- | --- | --- |
| 1001 | `StrayTopLevelContent` | `Stray content outside any block. Text must live inside an @template, @script, @style, or custom block.` |
| 1002 | `MalformedBlockHeader` | `Malformed block header. A block opens with '@<name>' at column 0.` |
| 1003 | `MissingOpeningBrace` | `Block header is missing its opening '{'.` |
| 1004 | `ContentAfterOpeningBrace` | `Unexpected content after the opening '{'. The '{' must be the last non-whitespace character on the header line.` |
| 1005 | `MalformedOptionValue` | `Malformed option value. Option values must be double-quoted, e.g. lang="scss".` |
| 1006 | `DuplicateTemplateBlock` | `Duplicate @template block. A .viu file may contain at most one @template.` |
| 1007 | `DuplicateScriptBlock` | `Duplicate @script block. A .viu file may contain at most one @script.` |
| 1008 | `UnterminatedBlock` | `Unterminated block. Expected a closing '}' at column 0 before end of file.` |

Parsing is fully recoverable: a structurally openable header always opens its block, and the
partial-class scaffold is still emitted even when a container error is reported. The block is
suppressed only when the header cannot open one — an absent or invalid block name
(`MalformedBlockHeader`), or no `{` anywhere on the header line (`MissingOpeningBrace`, itself
suppressed as redundant when a `MalformedBlockHeader` was already reported for that line). A stray
token in an otherwise brace-terminated header reports `MalformedBlockHeader` but still opens the
block. `ContentAfterOpeningBrace` and `MalformedOptionValue` never suppress. Duplicate blocks keep
the **first** and ignore the second.

The single largest source of code 1001 in practice is un-indented block content, because column 0 is
structural:

```viu
@style {
.card {
color: red;
}
}
```

The `}` closing `.card` sits at column 0, so it closes the `@style` block. The real closing brace
then becomes stray top-level content and you get code 1001 pointing at a line that looks perfectly
fine. Indent block bodies:

```viu
@style {
    .card {
        color: red;
    }
}
```

The full container rules live in
[Single-File Components (.viu)](../guide/scaling-up/single-file-components.md).

## CSS catalog — `CssErrorCode`

Carried in a `VIU1301` message as ` (CSS code NNNN)`. Also Viu-defined: CSS Syntax Module Level 3
specifies recovery behavior, not a numeric error catalog, so there is no upstream numbering to pin
to. The catalog is 2000-based (lowest member `2001`).

| Code | Name | Message |
| --- | --- | --- |
| 2001 | `UnterminatedComment` | `Unterminated comment. Expected a closing '*/' before end of file.` |
| 2002 | `UnterminatedString` | `Unterminated string. Expected a closing quote before the line break or end of file.` |
| 2003 | `UnterminatedBlock` | `Unterminated block. Expected a closing '}' before end of file.` |
| 2004 | `UnexpectedRightBrace` | `Unexpected '}' with no matching open block; the brace was discarded.` |
| 2005 | `EmptySelector` | `Empty selector. A style rule must have a selector before its '{'.` |
| 2006 | `MissingDeclarationColon` | `Malformed declaration. Expected ':' between the property and its value; the declaration was discarded.` |
| 2007 | `UnexpectedEndOfFile` | `Unexpected end of file. Expected a '{' block or ';' to close the rule.` |
| 2008 | `UnterminatedCssBinding` | `Unterminated 'v-bind('. Expected a closing ')' for the CSS binding; the usage was discarded.` |
| 2009 | `EmptyCssBinding` | `Empty 'v-bind()'. A CSS binding must reference an expression; the usage was discarded.` |

Codes 2008 and 2009 are the `v-bind()` in CSS pair — Viu's port of
[Vue's SFC CSS `v-bind()`](https://vuejs.org/api/sfc-css-features.html#v-bind-in-css):

```viu
@style {
    /* VIU1301, CSS code 2006 — missing ':'. The declaration is discarded. */
    .a { color red; }

    /* VIU1301, CSS code 2009 — empty binding. The usage is discarded. */
    .b { width: v-bind(); }
}
```

Note that `lang="scss"` and friends are parsed and preserved on the block but **no pre-processor
exists** — every `@style` block goes through the plain CSS parser regardless of its `lang`, so SCSS
syntax produces CSS-catalog errors. See [SFC CSS Features](../guide/scaling-up/sfc-css-features.md).

## Template catalog — `CompilerErrorCode`

Carried in a `VIU1101` message as ` (template compiler code NN)`. This is the C# port of Vue 3.5's
[`ErrorCodes`](https://github.com/vuejs/core/blob/main/packages/compiler-core/src/errors.ts) enum,
and the numeric values are pinned to upstream.

### The numbering scheme

| Band | Source | Numbering |
| --- | --- | --- |
| 0–52 | `@vue/compiler-core` `ErrorCodes` | Exactly upstream |
| 53 | `ExtendPoint` sentinel | Exactly upstream `__EXTEND_POINT__` |
| 54–64 | `@vue/compiler-dom` `DOMErrorCodes` | Upstream value **+ 1** |
| 65 | `DomExtendPoint` sentinel | Upstream DOM `__EXTEND_POINT__` |
| 1000+ | Viu-only, no upstream counterpart | Reserved band |

The `+1` on the DOM band is the one deliberate divergence. Upstream has two distinct enums, so
`DOMErrorCodes`' first real code can reuse the value `53` that core's `__EXTEND_POINT__` sentinel
occupies. Viu merges `@vue/compiler-core` and `@vue/compiler-dom` into one
`Assimalign.Viu.Syntax.Templates` project and therefore one C# enum, which cannot give two members
the same value while keeping `ExtendPoint = 53`. The DOM codes are appended after the sentinel
instead. Viu-only codes start at 1000 so the slots after `DomExtendPoint` stay free for a future
`@vue/compiler-ssr` `SSRErrorCodes` port under the same `+1` mapping.

### Codes you can actually hit

**Parse errors, 0–22** are the WHATWG HTML parse errors, `AbruptClosingOfEmptyComment` (0) through
`UnexpectedSolidusInTag` (22). Messages are verbatim upstream. **Only thirteen of the twenty-three
are actually emitted** — the tokenizer and parser report a subset, and the remaining ten are inert
(see [Codes that are never emitted](#codes-that-are-never-emitted)). The reachable ones:

| Code | Name | Fires when |
| --- | --- | --- |
| 1 | `CdataInHtmlContent` | `<![CDATA[` in HTML content |
| 2 | `DuplicateAttribute` | An attribute name is repeated on one element |
| 5 | `EofBeforeTagName` | Input ends where a tag name was expected |
| 6 | `EofInCdata` | Input ends inside a CDATA section |
| 7 | `EofInComment` | Input ends inside a comment |
| 9 | `EofInTag` | Input ends inside a tag |
| 13 | `MissingAttributeValue` | An attribute value was expected but missing |
| 14 | `MissingEndTagName` | An end tag has no name, e.g. `</>` |
| 17 | `UnexpectedCharacterInAttributeName` | An attribute name contains `"`, `'`, or `<` |
| 18 | `UnexpectedCharacterInUnquotedAttributeValue` | An unquoted value contains a forbidden character |
| 19 | `UnexpectedEqualsSignBeforeAttributeName` | An attribute name starts with `=` |
| 21 | `UnexpectedQuestionMarkInsteadOfTagName` | `<?` in HTML content |
| 22 | `UnexpectedSolidusInTag` | An unexpected `/` inside a tag |

**Vue-specific parse errors, 23–27:**

| Code | Name | Message |
| --- | --- | --- |
| 23 | `XInvalidEndTag` | `Invalid end tag.` |
| 24 | `XMissingEndTag` | `Element is missing end tag.` |
| 25 | `XMissingInterpolationEnd` | `Interpolation end sign was not found.` |
| 26 | `XMissingDirectiveName` | `Legal directive name was expected.` |
| 27 | `XMissingDynamicDirectiveArgumentEnd` | `End bracket for dynamic directive argument was not found. Note that dynamic directive argument cannot contain spaces.` |

**Transform errors, 28–46 and 52** — the directive-level checks:

| Code | Name | Fires when |
| --- | --- | --- |
| 28 | `XVIfNoExpression` | `v-if`/`v-else-if` has no expression |
| 29 | `XVIfSameKey` | Two `v-if`/`v-else` branches use the same `:key` |
| 30 | `XVElseNoAdjacentIf` | `v-else`/`v-else-if` has no adjacent `v-if` |
| 31 | `XVForNoExpression` | `v-for` has no expression |
| 32 | `XVForMalformedExpression` | `v-for` expression is not `alias in source` |
| 33 | `XVForTemplateKeyPlacement` | `:key` sits on the wrong node in a `<template v-for>` |
| 34 | `XVBindNoExpression` | `v-bind` has no expression and no same-name shorthand |
| 35 | `XVOnNoExpression` | `v-on` has no expression and no modifiers |
| 36 | `XVSlotUnexpectedDirectiveOnSlotOutlet` | A custom directive on a `<slot>` outlet |
| 37 | `XVSlotMixedSlotUsage` | `v-slot` on both the component and a nested `<template>` |
| 38 | `XVSlotDuplicateSlotNames` | Two slots share a name |
| 39 | `XVSlotExtraneousDefaultSlotChildren` | Loose children alongside an explicit default slot |
| 40 | `XVSlotMisplaced` | `v-slot` on something that is not a component or `<template>` |
| 41 | `XVModelNoExpression` | `v-model` has no expression |
| 42 | `XVModelMalformedExpression` | `v-model` target is not a member expression |
| 45 | `XInvalidExpression` | Roslyn could not parse the C# expression body |
| 46 | `XKeepAliveInvalidChildren` | `<KeepAlive>` has other than exactly one child |
| 52 | `XVBindInvalidSameNameArgument` | Same-name `v-bind` shorthand with a dynamic argument |

Code 45 is the one you meet most, because Viu template expressions are **C#** parsed with
`SyntaxFactory.ParseExpression` — see [Template Syntax](../guide/essentials/template-syntax.md).
Its message is `Error parsing JavaScript expression: ` with the Roslyn detail appended; the string
still says "JavaScript" because it is carried verbatim from upstream:

```viu
@template {
    <!-- VIU1101, template compiler code 45, on the exact sub-expression span. -->
    <div>{{ a + }}</div>
}
```

**DOM transform errors, 54–62** (63 and 64 are inert):

| Code | Name | Fires when |
| --- | --- | --- |
| 54 | `XVHtmlNoExpression` | `v-html` has no expression |
| 55 | `XVHtmlWithChildren` | `v-html` on an element that also has children |
| 56 | `XVTextNoExpression` | `v-text` has no expression |
| 57 | `XVTextWithChildren` | `v-text` on an element that also has children |
| 58 | `XVModelOnInvalidElement` | `v-model` on anything but `<input>`, `<textarea>`, `<select>` |
| 59 | `XVModelArgumentOnElement` | `v-model:arg` on a plain element |
| 60 | `XVModelOnFileInputElement` | `v-model` on `<input type="file">` |
| 61 | `XVModelUnnecessaryValue` | A `value` binding alongside `v-model` |
| 62 | `XVShowNoExpression` | `v-show` has no expression |

The `v-model` group is documented from the authoring side in
[Form Input Bindings](../guide/essentials/form-bindings.md); the slot group in
[Slots](../guide/components/slots.md).

**Viu-only, 1000+:**

| Code | Name | Reachable today? |
| --- | --- | --- |
| 1000 | `XViuUnresolvedIdentifier` | Only via the compiler API with `BindingMetadata.ReportsUnresolvedIdentifiers` set |
| 1001 | `XViuUnknownCssModuleMember` | Yes, from the `.viu` build |

Neither has an upstream counterpart, because both encode a divergence C# forces. Code 1000 exists
because Viu has no runtime `Proxy` fallback for an identifier that resolves to nothing — but the
`.viu` generator does **not** enable strict binding metadata, so an unknown identifier still falls
back to `_ctx.name` exactly as in Vue, and this code never appears in a normal build.

Code 1001 does fire from the `.viu` build, because the generator hands the template compiler the
complete CSS-module class map and enables `CssModuleAccessors.ReportsUnknownMembers`. Vue's runtime
`$style` is a plain object indexed at runtime; Viu's is a compile-time class whose members are
exactly the declared classes, so a typo is decidably wrong:

```viu
@template {
    <div :class="$style.missing">hi</div>
}

@style module {
    .box { color: red; }
}
```

```sh
Card.viu(2,25): error VIU1101: Unknown CSS module member: '$style' has no member 'missing'. (template compiler code 1001)
```

The span is the member name alone, not the whole `$style.missing` access. A named module
(`@style module="theme"`) is referenced by its authored name, so the detail reads
`'theme' has no member '…'`.

### Codes that are never emitted

Nineteen `CompilerErrorCode` members are carried purely for numeric parity with upstream. They have
message text but **no code path reports them** — the only reference to each is its entry in the
message table (and, for code 0, a numeric-parity test). Do not treat them as reachable, and do not
document them as behavior a user can trigger.

Ten are in the WHATWG parse band, where Viu's tokenizer reports a narrower set than the spec
enumerates:

| Code | Name |
| --- | --- |
| 0 | `AbruptClosingOfEmptyComment` |
| 3 | `EndTagWithAttributes` |
| 4 | `EndTagWithTrailingSolidus` |
| 8 | `EofInScriptHtmlCommentLikeText` |
| 10 | `IncorrectlyClosedComment` |
| 11 | `IncorrectlyOpenedComment` |
| 12 | `InvalidFirstCharacterOfTagName` |
| 15 | `MissingWhitespaceBetweenAttributes` |
| 16 | `NestedComment` |
| 20 | `UnexpectedNullCharacter` |

Malformed comments in particular are silently tolerated: none of codes 0, 10, 11, or 16 fires.

The other eight are transform, generic, and DOM codes whose analysis Viu does not perform:

| Code | Name | Why it is inert |
| --- | --- | --- |
| 43 | `XVModelOnScopeVariable` | Scope-variable write analysis is not performed |
| 44 | `XVModelOnProps` | Prop-write analysis is not performed |
| 47 | `XPrefixIdNotSupported` | Viu has no browser build with prefixing disabled |
| 48 | `XModuleModeNotSupported` | There is no ES-module codegen mode |
| 49 | `XCacheHandlerNotSupported` | `CacheHandlers` is off by design, so the conflict cannot arise |
| 51 | `XVnodeHooks` | The removed `@vnode-*` form is not detected |
| 63 | `XTransitionInvalidChildren` | The compiler performs no single-child validation for `<Transition>` |
| 64 | `XIgnoredSideEffectTag` | Side-effect tags are not detected |

Code 63 is worth calling out specifically: a `<Transition>` with two children compiles silently. See
[Transition & TransitionGroup](../guide/built-ins/transition.md). Code 46
(`XKeepAliveInvalidChildren`) *is* emitted, but `<KeepAlive>` itself is a marker that throws at
runtime — see [KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md).

## `@script` errors are syntactic only

The generator runs Roslyn over the `@script` block to **parse** it, and reports what it finds as
`VIU1201`. That is the whole extent of it:

```viu
@script {
    public int Broken = ;
}
```

```sh
Widget.viu(2,25): error VIU1201: Invalid expression term ';' (C# script code CS1525)
```

Semantic errors — type mismatches, unresolved namespaces, a missing `using` — are **never** reported
by the generator. They surface later, when the generated C# is compiled, as ordinary `CS####`
errors. The generator splits the block at the line boundary after its leading `using` run into a
hoisted *using region* and a class-body *member region*, and emits each under its own `#line`
directive mapping back to the `.viu` file, so those errors still land on the right `.viu` line and
column. Each region is validated in the context the emitter places it — the using region as a bare
compilation unit, the member region inside a synthetic partial class — so a malformed `using` and a
malformed member both surface as `VIU1201`. The mapped location
is visible through `Location.GetMappedLineSpan()`; `GetLineSpan()` returns the position in the
generated file. IDEs and `dotnet build` use the mapped span, so the practical effect is that the
squiggle appears in your `.viu` file even though the diagnostic originated in generated code.

Both regions are emitted flush at column 0 with no re-indentation, precisely so the `#line` map
preserves every token's column — a `#line` directive remaps the *line* of the text that follows but
takes each token's *column* verbatim from the generated file.

## Configuring severity

All `VIU` and `VUER` descriptors are `isEnabledByDefault: true` and configurable the standard Roslyn
way:

```ini
# .editorconfig
[*.cs]
# Downgrade the non-reactive-property warning to a suggestion.
dotnet_diagnostic.VUER1003.severity = suggestion

# Treat every .viu template parse warning as an error.
dotnet_diagnostic.VIU1102.severity = error
```

Because the `VIU` family is enveloped, a severity override applies to **every** diagnostic from that
origin — there is no way to configure one underlying catalog code independently.

To turn `.viu` compilation off for a project entirely, and with it every `VIU` diagnostic:

```xml
<PropertyGroup>
  <EnableSingleFileComponentGeneration>false</EnableSingleFileComponentGeneration>
</PropertyGroup>
```

Individual files opt out through `ViuSingleFileComponentExclude`. Both are documented in the
[MSBuild Reference](./msbuild-reference.md).

## No code fixes

There are no `CodeFixProvider` implementations anywhere in the repository, for any `VIU` or `VUER`
code. The `VUER` descriptors describe their messages as "code-fix-friendly" and are written so a
fixer *could* be added, but none exists — every diagnostic on this page is fixed by hand.

## See also

- [Single-File Components (.viu)](../guide/scaling-up/single-file-components.md) — the container
  rules the 1001–1008 catalog enforces.
- [SFC CSS Features](../guide/scaling-up/sfc-css-features.md) — ordinary component styles, CSS Modules, and
  `v-bind()` in CSS.
- [Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md) — the `[Reactive]`
  generator requirements behind `VUER1001`–`VUER1004`.
- [Template Syntax](../guide/essentials/template-syntax.md) — why template expressions are C#, which
  is what code 45 is checking.
- [The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md) — where the generators sit in the build.
- [Project Status](../roadmap/status.md) — what is implemented, partial, and absent.
- [Differences from Vue 3](../roadmap/vue-differences.md) — the naming and behavior map.
