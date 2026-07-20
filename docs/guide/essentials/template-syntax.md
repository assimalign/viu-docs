# Template Syntax

Interpolation and attribute bindings in a `.viu` template, where the markup is Vue's and the
expressions inside it are C#.

> **Status:** Partial. Interpolation, identifier rewriting, and the binding syntax are implemented.
> Several codegen gaps — dynamic `v-bind` arguments, `v-memo`, and destructuring aliases — are listed
> under [Not yet implemented](#not-yet-implemented), and the
> [directive reference](#directive-reference) below marks each directive's real status: `v-on` and
> `v-model` compile but have runtime gaps at the last hop, and `v-memo` does not compile at all. See
> [Project status](../../roadmap/status.md).

Viu's template markup is Vue 3's, character for character. `{{ }}` interpolation, `v-if`, `v-for`,
`v-bind` with its `:` shorthand, `v-on` with `@`, `v-model`, `v-slot` with `#`, `v-pre`, `v-once`,
`<slot>` outlets and `<component :is>` all parse and all compile, because
`Assimalign.Viu.Syntax.Templates` is a port of [`@vue/compiler-core`](https://vuejs.org/guide/essentials/template-syntax.html)
and `@vue/compiler-dom`. What changes is what goes *inside* the braces and the quoted values.

## Expressions are C#

Every expression body in a template is parsed by Roslyn's `SyntaxFactory.ParseExpression` at build
time. There is no runtime template compilation in Viu — WebAssembly has no `new Function`, so the
only path is the source generator. That single fact decides what an expression may contain.

```viu
@template {
    <p>{{ Message }}</p>
    <p>{{ Items.Where(x => x.Active).Count() }} active</p>
    <p>{{ Math.Round(Total, 2) }}</p>
    <p>{{ Placed?.ToString("yyyy-MM-dd") ?? "unscheduled" }}</p>
    <span :title="nameof(Total)">{{ Total }}</span>
}

@script {
    using System;
    using System.Linq;
    using Assimalign.Viu.Reactivity;

    public sealed class Item
    {
        public bool Active { get; set; }
        public decimal Price { get; set; }
    }

    public readonly Reference<string> Message = Reactive.Reference("Ready");
    public readonly ReactiveList<Item> Items = new();
    public readonly Reference<DateOnly?> Placed = Reactive.Reference<DateOnly?>(null);

    public Computed<decimal> Total { get; }

    // The class name comes from the file name, so this is OrderSummary.viu.
    public OrderSummary() => Total = Reactive.Computed(() => Items.Sum(item => item.Price));
}
```

Note the `readonly` on `Items`. That is not a style preference — it is what makes
`Items.Where(...)` compile, and the [rewriting table](#how-identifiers-are-rewritten) below explains
why: a *writable* non-reference member reads through `_unref`, which returns `object?`, and `object?`
has no `.Where`. A `readonly` field is classified `SetupConstant` and emits bare, keeping its
declared `ReactiveList<Item>` type. `Reference<T>` and `Computed<T>` members are exempt — they are
unwrapped to their typed `.Value` whether or not they are `readonly`.

LINQ, string interpolation of C# types, null-conditional `?.`, null-coalescing `??`, `nameof`,
generic method calls, object initializers — anything Roslyn will parse as a single C# *expression* is
legal. Statements are legal only in the one place Vue allows them, an inline `v-on` handler.

### The global allow-list

Bare identifiers that are not component members are rewritten to point at the component (see below)
*unless* they appear on the compiler's global allow-list. Viu's list names .NET types rather than
JavaScript globals:

| Category | Allowed identifiers |
| --- | --- |
| Numeric and conversion | `Math`, `Convert`, `Number`, `BigInteger`, `Byte`, `SByte`, `Int16`, `UInt16`, `Int32`, `UInt32`, `Int64`, `UInt64`, `Single`, `Double`, `Decimal`, `Boolean`, `Char` |
| Text | `String`, `StringComparison`, `StringComparer` |
| Time | `DateTime`, `DateTimeOffset`, `DateOnly`, `TimeOnly`, `TimeSpan`, `DayOfWeek` |
| Collections and LINQ | `Array`, `Enumerable`, `Comparer`, `EqualityComparer` |
| Identity and formatting | `Guid`, `Uri`, `Object`, `Nullable` |
| Namespace root | `System` (so `System.Math.PI` works) |
| Runtime and culture | `Environment`, `CultureInfo` |

C# keyword literals — `true`, `false`, `null`, `this` — never reach this check at all, because Roslyn
tokenizes them as keywords rather than identifiers.

### JavaScript forms that do not work

Vue documentation and Vue muscle memory will both suggest expressions Viu cannot compile. There is no
`JSON`, no `Date`, no `parseInt`, no `undefined`, no `typeof`, no template literals, and no spread
operator. Write the .NET equivalent instead:

| Vue / JavaScript | Viu / C# |
| --- | --- |
| `{{ JSON.stringify(obj) }}` | `{{ obj }}` — interpolation already renders collections in a JSON-like shape |
| `` :title=`Hi ${name}` `` | `:title='$"Hi {Name}"'` — single-quote the attribute so C# can use `"` |
| `{{ new Date().getFullYear() }}` | `{{ DateTime.Now.Year }}` |
| `{{ parseInt(raw) }}` | `{{ Convert.ToInt32(raw) }}` |
| `{{ value === undefined }}` | `{{ value is null }}` |
| `{{ typeof value }}` | `{{ value.GetType().Name }}` |

A malformed expression is a **recoverable** diagnostic, not a crash: the compiler reports
`XInvalidExpression` on the exact template coordinate and keeps going. See
[Compiler Diagnostics](../../api/diagnostics.md).

## Text interpolation

`{{ expression }}` compiles to `_toDisplayString(expression)`, the port of Vue's `toDisplayString`.
Its rules are worth knowing because they differ from `ToString()`:

- **`null` renders as the empty string** — never `"null"`, never a `NullReferenceException`.
- **Scalars format with `CultureInfo.InvariantCulture`** — an `IFormattable` goes through
  `ToString(null, CultureInfo.InvariantCulture)`, so a `decimal` renders identically on every locale.
- **`bool` renders JavaScript-style** — lowercase `true` / `false`, not C#'s `True` / `False`.
- **Dictionaries and enumerables render in a JSON-like, two-space-indented shape** — matching
  upstream's `toDisplayString`, and implemented by hand-written recursion rather than reflection so it
  survives trimming.

Adjacent text and interpolations are merged at compile time into one expression joined with the C#
`+` operator, so `<p>Hello {{ Name }}!</p>` emits a single concatenation rather than three child
nodes.

Delimiters are configurable through `ParserOptions.DelimiterOpen` and `ParserOptions.DelimiterClose`
when you drive `TemplateParser` directly, but the `.viu` build path does not surface them — `{{` and
`}}` are what a single-file component uses.

## Attribute bindings

`v-bind` binds one attribute, DOM property, or component prop to an expression. Every Vue shorthand
is supported.

```viu
@template {
    <!-- full form and the ':' shorthand -->
    <img v-bind:src="Source" />
    <img :src="Source" :alt="Caption" />

    <!-- same-name shorthand: ':src' expands to ':src="src"', camelized -->
    <img :src />

    <!-- dynamic argument: the attribute NAME is an expression.
         PARSES AND TRANSFORMS, BUT DOES NOT COMPILE YET - see "Not yet implemented" -->
    <div :[AttributeName]="Value"></div>

    <!-- '.' shorthand — v-bind with a synthetic 'prop' modifier -->
    <input .value="Text" />

    <!-- explicit modifiers -->
    <svg :view-box.camel="Box"></svg>
    <input :value.prop="Text" />
    <div :id.attr="Identifier"></div>

    <!-- object spread: merge a whole property bag -->
    <div v-bind="Extra" id="fallback"></div>
}
```

The modifiers behave as follows.

| Form | Effect |
| --- | --- |
| `.camel` | Camelizes a static argument (`:view-box.camel` → `viewBox`); a dynamic argument is wrapped in `_camelize` |
| `.prop` | Forces a DOM property write — emits the key with a leading `.` |
| `.attr` | Forces an attribute write — emits the key with a leading `^` |
| `:[key]` | Dynamic key; escalates the element to `PatchFlags.FullProps`. The null guard is emitted as upstream's JavaScript or-operator form, which is not C#-legal — see [Not yet implemented](#not-yet-implemented) |
| `v-bind="obj"` | Merged through `_mergeProps`, escalating to `PatchFlags.FullProps` |

Three things to watch.

- **The same-name shorthand expands to the *attribute's* name, camelized.** `:src` becomes
  `:src="src"` and resolves to `_ctx.src` — lowercase. Viu members are PascalCase by convention, so
  the shorthand only binds if you actually named a member `src`. Otherwise write `:src="Source"`.
  A shorthand whose argument is not a valid identifier reports `XVBindInvalidSameNameArgument`.
- **`v-bind="obj"` merges through `_mergeProps(params object?[] sources)`**, which casts each source
  to `VirtualNodeProperties` and **silently skips anything else** — bind a plain
  `Dictionary<string, object?>` and nothing happens.
- **`.prop` and `.attr` are ignored under SSR.** Both prefixes are applied only when the transform is
  not in SSR mode. Viu has no SSR pipeline today, so this is inert, not a behaviour you can hit.

## Class and style bindings

`:class` and `:style` are special-cased: the compiler wraps their values in `_normalizeClass` and
`_normalizeStyle`, which are the ports of Vue's
[class and style normalization](https://vuejs.org/guide/essentials/class-and-style.html).

Because a C# string literal needs double quotes, single-quote the attribute whenever the expression
contains one — the tokenizer accepts double-quoted, single-quoted, and unquoted attribute values.

```viu
@template {
    <!-- string -->
    <div :class="Theme"></div>

    <!-- name → flag map: truthy entries contribute their key, in entry order -->
    <div :class='new Dictionary<string, object?> { ["active"] = IsActive, ["danger"] = HasError }'></div>

    <!-- list: entries recurse, so strings and maps can be mixed -->
    <div :class="new object?[] { BaseClass, Modifier }"></div>

    <!-- style as CSS text -->
    <div :style='"color: red; font-size: 14px"'></div>

    <!-- style as a map: kebab-case keys, or --custom properties -->
    <div :style='new Dictionary<string, object?> { ["font-size"] = FontSize, ["--accent"] = Accent }'></div>
}

@script {
    using System.Collections.Generic;
    using Assimalign.Viu.Reactivity;

    public readonly Reference<string> Theme = Reactive.Reference("card");
    public readonly Reference<bool> IsActive = Reactive.Reference(false);
    public readonly Reference<bool> HasError = Reactive.Reference(false);
    public readonly Reference<string> BaseClass = Reactive.Reference("panel");
    public readonly Reference<string> Modifier = Reactive.Reference("panel--wide");
    public readonly Reference<int> Scale = Reactive.Reference(14);
    public readonly Reference<string> Accent = Reactive.Reference("#c00");

    public Computed<string> FontSize { get; }

    public ThemedPanel() => FontSize = Reactive.Computed(() => $"{Scale.Value}px");
}
```

`Dictionary` and the `object?[]` element type are *type* positions, so the rewriter leaves them
alone — only the value expressions (`IsActive`, `FontSize`, …) are rewritten. That is why
`Dictionary` does not need to appear on the global allow-list.

Truthiness in a class map follows JavaScript, not C#: `null`, `false`, numeric zero, `NaN`, and the
empty string are falsy, and everything else — including any non-null object — is truthy.

Two hard edges on style maps:

- **Style map keys must already be CSS property names.** Use kebab-case (`"font-size"`) or a
  `--custom` property. camelCase normalization is not implemented on the patch path, so a
  `"fontSize"` key is handed straight to `style.setProperty` and **silently does nothing**.
- **`!important` is matched literally.** The formatted value is tested with
  `EndsWith("!important", StringComparison.Ordinal)`, so it is case-sensitive and must be the trailing
  token. `"red !IMPORTANT"` is not detected.

Style *strings* take a separate fast path: an unchanged string is not rewritten at all, and a map is
diffed key-by-key so only changed declarations cross the JavaScript boundary.

## How identifiers are rewritten

A template expression is not evaluated in a `this` context — there is no component instance proxy
under AOT. Instead the compiler rewrites every free identifier to a member access on `_ctx`, the
render method's first parameter, which is typed as the component's own generated partial class:

```csharp
internal static object? Render(Counter _ctx, object?[] _cache)
```

Everything routes through `_ctx.` — Viu has no equivalent of Vue's `$setup.` / `$props.` /
`__props.` split. What varies is whether a `.Value` unwrap or an `_unref` call is inserted, which the
compiler decides from a `BindingType` classification of each `@script` member.

| Declaration in `@script` | `BindingType` | Read emits | Write emits |
| --- | --- | --- | --- |
| `Reference<T>`, `ShallowReference<T>`, `CustomReference<T>`, `Computed<T>`, `IReference<T>` | `SetupReference` | `_ctx.Name.Value` | `_ctx.Name.Value = …` |
| `const` field | `LiteralConstant` | `_ctx.Name` | — |
| `readonly` non-reference field, or a get-only property | `SetupConstant` | `_ctx.Name` | — |
| writable non-reference field or property | `SetupLet` | `_unref(_ctx.Name)` | `_ctx.Name = …` |
| method | `SetupConstant` | `_ctx.Name` | — |

The important consequence: **`.Value` is inserted in read *and* write positions.** Vue guards
assignments with a runtime `isRef(...)` check; Viu does not need one, because `Reference<T>.Value` is
a settable C# property. So `@click="Count++"` on a `Reference<int> Count` emits
`_withHandler(__event => (_ctx.Count.Value++))` — the `_withHandler` wrapper exists only to give the
lambda a delegate target type, since a C# lambda has none on its own — and `{{ Count }}` emits
`_toDisplayString(_ctx.Count.Value)`. You never write `.Value` in a template — see
[Reactivity Fundamentals](./reactivity-fundamentals.md) for where you *do*.

Classification is deliberately conservative: only a member whose *declared type name* is one of the
five reference types above is ever unwrapped, so the compiler can never emit a wrong `.Value`.

Identifiers introduced by the template itself — `v-for` aliases and `v-slot` props — shadow component
members and stay bare, with correct ref-counted restore on the way out:

```viu
@template {
    <!-- 'item' is also a component member; inside the loop the alias wins -->
    <span v-for="item in List">{{ item }}</span>
    <b>{{ item }}</b>
}
```

emits `item` for the first and `_ctx.item` for the second.

A misspelled identifier is *not* reported by the template compiler in the `.viu` path — it becomes
`_ctx.mystery` and then fails as an ordinary C# compiler error on the generated render body, mapped
back to your template coordinate through the emitted `#line` directives.

### The `$` spellings

Vue's `$`-prefixed names are not legal C# identifiers, so the compiler substitutes them. You still
**author** them exactly as in Vue:

| You write | Compiler emits | Notes |
| --- | --- | --- |
| `$event` | `__event` | The inline `v-on` handler parameter |
| `$slots` | `_ctx.__slots` | Inserted by `<slot>` outlets |
| `$style` | `_style`, resolving to a generated `Style` accessor class | CSS Modules; see [SFC CSS Features](../scaling-up/sfc-css-features.md) |

`$style` uses a length-preserving `$` → `_` substitution so that template offsets survive into
diagnostics. One collision follows from that: a component member literally named `_style`, referenced
while a `$style` module is in scope, is misclassified as the accessor.

## Skipping compilation: `v-pre` and `v-once`

`v-pre` is handled entirely in the parser, and it is more aggressive than a reader might expect —
**inside a `v-pre` subtree the parser stops doing everything Vue-ish**:

```viu
@template {
    <div v-pre :id="foo"><Comp v-if="x" /></div>
    <div v-pre>{{ raw }}</div>
}
```

- The `v-pre` attribute itself is dropped from the property list.
- Every directive becomes a plain attribute keeping its authored name — `:id` and `v-if` above are
  attributes, not bindings. This applies **retroactively** to directives already collected on the same
  tag.
- Interpolation delimiters become literal text: the second `<div>` renders the characters
  `{{ raw }}` verbatim, and no `_toDisplayString` call is emitted for it.
- Elements are never classified as components, slots, or templates — `<Comp>` is a plain element.

`v-once` is the opposite tool: it renders the subtree once and caches the result, pausing block
tracking around it. Each `v-once` reserves one slot in the render method's `_cache` array.

```viu
@template {
    <div v-once><span>{{ Frozen }}</span></div>
}
```

## Directive reference

| Directive | Shorthand | Status | Covered in |
| --- | --- | --- | --- |
| `v-bind` | `:` and `.` | Implemented, except dynamic arguments (`:[key]`) — see below | This page |
| `v-on` | `@` | Partial — an **inline** handler written with no modifier compiles to a shape the DOM invoker rejects, so it never fires | [Event Handling](./event-handling.md) |
| `v-if` / `v-else-if` / `v-else` | — | Implemented | [Conditional & List Rendering](./conditional-and-list.md) |
| `v-for` | — | Implemented | [Conditional & List Rendering](./conditional-and-list.md) |
| `v-model` | — | Partial — compiles, but the emitter does not pass the `ViuModelBinding` carrier the runtime directive reads, so a template-authored `v-model` does not round-trip | [Form Input Bindings](./form-bindings.md) |
| `v-slot` | `#` | Implemented | [Slots](../components/slots.md) |
| `v-show` | — | Implemented | [Built-in Directives](../../api/built-in-directives.md) |
| `v-html` / `v-text` | — | Implemented | [Built-in Directives](../../api/built-in-directives.md) |
| `v-pre` / `v-once` | — | Implemented | This page |
| `v-cloak` | — | Implemented as an explicit no-op | [Built-in Directives](../../api/built-in-directives.md) |
| `v-memo` | — | **Not yet implemented** — the emitted C# is not legal and the runtime helpers do not exist; see below | — |
| Custom directives | — | Implemented | [Custom Directives](../reusability/custom-directives.md) |

Any directive name that is neither built-in nor a registered transform is emitted as a runtime
directive: resolved with `_resolveDirective("name")` and applied through `_withDirectives`.

## Not yet implemented

The surfaces below parse and reach the compiler's IR, but either do not produce compilable C# yet,
compile to something other than what the Vue spelling implies, or were deliberately never ported.
Each bullet says which.

- **`v-memo` codegen is not C#-legal end to end** — the memo condition parts still carry
  JavaScript-shaped member accesses and the `_cached` parameter contract. `v-memo` templates are
  deliberately excluded from the emitted-code parse-validity suite. Treat it as roadmap.
- **Dynamic `v-bind` arguments** — `:[key]="value"` parses, escalates the element to
  `PatchFlags.FullProps`, and rewrites the key expression correctly, but the null guard is emitted as
  upstream's JavaScript spelling `_ctx.key || ""`. C# has no `||` over strings, so the render body
  does not compile. `:[key]` is absent from the emitted-code parse-validity suite for that reason.
  Until it lands, branch with `v-if` over statically named bindings, or build the whole bag and use
  `v-bind="obj"`.
- **`v-slot` destructuring** — `#item="{ label }"` parses and registers `label` in template scope,
  but the emitted lambda parameter list is not valid C#. Name the whole slot scope with a single
  alias and access members off it.
- **Destructuring a tuple-typed `v-for` element** — `v-for="(a, b) in pairs"` compiles, but not to a
  deconstruction: the two-alias form always binds the `_renderList<T>(IEnumerable<T>?,
  Func<T, int, VirtualNode?>)` overload, so `b` is the zero-based *index*, not the tuple's second
  member. The `(item, index)` and `(value, key, index)` alias forms are fully supported — see
  [Conditional & List Rendering](./conditional-and-list.md). Only element destructuring is missing.
- **Handler caching is off** — `TransformOptions.CacheHandlers` exists and the `v-on` transform
  honors it, but the generator keeps it disabled: upstream's cached handler wraps in a JavaScript
  rest-argument lambda that has no C# spelling yet.
- **Filters do not exist** — Vue 3 removed them, and Viu carries only the `resolveFilter` helper name
  for parity. Nothing parses or emits a filter.
- **Constant folding of expressions** — upstream stringifies constant interpolations with
  `new Function`. Viu forbids dynamic code generation, so no interpolation or dynamic `v-bind` is ever
  classified above `ConstantType.NotConstant`. Only static text, static attributes, and
  compiler-injected literals reach the higher levels.
- **Scoped-style attribute injection from the transform** — `TransformOptions.ScopeId` exists and the
  static stringifier honours it, but the `.viu` generator builds its options with
  `TransformOptions.CreateDom()` and never sets it. Scoping is applied by the SFC pipeline instead:
  the generator emits a `ScopeId` constant on the component and rewrites the selectors. **The runtime
  half is not wired** — `RendererOptions<TNode>.SetScopeId` is declared but never invoked, so no
  element ever carries the `data-v-<hash>` attribute and scoped rules currently match nothing. See
  [SFC CSS Features](../scaling-up/sfc-css-features.md).

For the full picture of what is built, partial, and absent, see
[Project Status](../../roadmap/status.md). For the naming map from Vue's camelCase to Viu's
PascalCase, see [Differences from Vue 3](../../roadmap/vue-differences.md).

## Where to go next

- [Conditional & List Rendering](./conditional-and-list.md) — `v-if`, `v-for`, keying, and the alias limits.
- [Event Handling](./event-handling.md) — `v-on`, modifiers, and the `BrowserEvent` payload.
- [Single-File Components (.viu)](../scaling-up/single-file-components.md) — the `@template` / `@script` / `@style` block format.
- [Render Functions & VirtualNode](../../api/render-function.md) — what a template actually compiles into.
