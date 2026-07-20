# Built-in Directives

Every directive the Viu template compiler recognizes, what it compiles to, and how honest its
status is.

> **Status:** Partial. Every directive below compiles except `v-memo`, whose emitted C# is not yet
> legal and whose runtime helpers do not exist. Four implemented directives have runtime gaps called
> out inline: unguarded `v-on` handlers compile but are dropped at dispatch (see
> [v-on](#v-on)); `v-show` does not coordinate with `<Transition>`; a compiled element `v-model` does
> not emit the `ViuModelBinding` carrier its runtime directive reads; and a compiled component
> `v-model`'s write-back never reaches the child's emit handler. In every one of those four cases the
> **hand-written** form works today and the template-compiled form does not. See
> [Project status](../roadmap/status.md).

Viu's directive set is the Vue 3.5 set, spelled identically. The markup is Vue's verbatim — only
the expression bodies are C# instead of JavaScript. The upstream reference is [Built-in
Directives](https://vuejs.org/api/built-in-directives.html) on vuejs.org; this page is the Viu
counterpart, and it names the exact runtime helper each directive binds to.

## How directive names are spelled in the AST

If you are reading compiler output or writing a `NodeTransform`, note the two name fields on
`DirectiveNode`:

- **`DirectiveNode.Name`** — the normalized name **without** the `v-` prefix, with shorthands
  already resolved: `"if"`, `"else-if"`, `"else"`, `"for"`, `"bind"`, `"on"`, `"model"`, `"slot"`,
  `"show"`, `"html"`, `"text"`, `"once"`, `"memo"`, `"pre"`, `"cloak"`. Vue authors look for
  `dir.name`; this is the same field, minus the prefix.
- **`DirectiveNode.RawName`** — what the author actually typed: `":id"`, `"@click"`, `"#header"`,
  `"v-bind:id"`.

```csharp
// <div :id="x"></div>
directive.Name.ShouldBe("bind");
directive.RawName.ShouldBe(":id");
directive.Argument.ShouldBeOfType<SimpleExpressionNode>().Content.ShouldBe("id");

// <template #header></template>
directive.Name.ShouldBe("slot");
directive.RawName.ShouldBe("#header");
```

A directive shorthand with an **empty name** (`<div v->`) reports `XMissingDirectiveName` and is
then *downgraded to an `AttributeNode` named `"v-"`* — it never becomes a `DirectiveNode` at all.
Recovery, not rejection, is the rule everywhere in this pipeline.

`ElementNode.Properties` is Vue's `props`: attributes **and** directives, in source order. There
is no separate attribute collection — filter with `is AttributeNode` / `is DirectiveNode`.

## The table

Emitted helper names are written exactly as generated code spells them: `_` plus the upstream
`helperNameMap` value.

| Directive | Shorthand | Compiles to | Status | Notes |
| --- | --- | --- | --- | --- |
| `v-if` / `v-else-if` / `v-else` | — | a `ConditionalExpression` chain of blocks; a lone `v-if` ends in `_createCommentVNode("v-if", true)` | Implemented | branch keys `0,1,2,…` are compiler-injected |
| `v-for` | — | `_renderList(source, iterator)` inside a `_Fragment` block | Implemented | both `in` and `of` accepted |
| `v-bind` | `:` and `.` | one vnode prop; `_normalizeClass` / `_normalizeStyle` on `class`/`style`; `_mergeProps` for object spread | Implemented | `.` is `v-bind` plus a synthetic `prop` modifier |
| `v-on` | `@` | an `onX` prop, wrapped by `_withHandler`, `_withModifiers`, or `_withKeys` | Implemented (dispatch gap) | `.once` becomes the key `onClickOnce`; unguarded handlers never fire — see [v-on](#v-on) |
| `v-model` (element) | — | `_vModelText` / `_vModelCheckbox` / `_vModelRadio` / `_vModelSelect` / `_vModelDynamic` through `_withDirectives` | Implemented (carrier gap) | directive chosen by tag and `type`; the emitter passes the raw value, not the `ViuModelBinding` the directives read, so a compiled `v-model` does not round-trip — see [Form Input Bindings](../guide/essentials/form-bindings.md#not-yet-implemented) |
| `v-model` (component) | — | a `modelValue` prop plus an `onUpdate:modelValue` handler | Implemented (dispatch gap) | `v-model:title.trim` adds `titleModifiers`; the compiled write-back binds `Func<object?, object?>`, which emit dispatch skips — see [Component v-model](../guide/components/v-model.md#not-yet-implemented) |
| `v-slot` | `#` | a slots object of `_withCtx` functions plus a trailing `("_", n)` `SlotFlags` marker; `_createSlots` when conditional | Implemented | **no modifiers** — dots fold into the argument |
| `v-show` | — | `_vShow` through `_withDirectives` | Implemented | `<Transition>` coordination is not wired |
| `v-html` | — | an `innerHTML` prop | Implemented | children are cleared, `XVHtmlWithChildren` reported |
| `v-text` | — | a `textContent` prop wrapped in `_toDisplayString` | Implemented | children are cleared, `XVTextWithChildren` reported |
| `v-once` | — | `_cache[n] ??= _setCache(n, _setBlockTracking(-1, true), …)` | Implemented | reserves one `_cache` slot |
| `v-memo` | — | `_withMemo(deps, …, _cache, n)`, or a per-item `_isMemoSame` loop under `v-for` | **Not yet implemented** | see [v-memo](#v-memo) below |
| `v-pre` | — | nothing — handled entirely in the parser | Implemented | retroactively downgrades directives to attributes |
| `v-cloak` | — | nothing; the element ends up with `Props == null` | Implemented | an explicit no-op transform, not a custom directive |
| custom (`v-focus`) | — | `_resolveDirective("focus")` in the preamble, applied via `_withDirectives` | Implemented | any name not in the built-in list |

## Structural directives

### v-if / v-else-if / v-else

Adjacent conditional siblings are folded into one `IfNode` with ordered `IfBranchNode`s, then
emitted as a nested conditional. Comments and whitespace between branches are absorbed into the
following branch.

```viu
@template {
<div v-if="visible">A</div>
<span v-else-if="other">B</span>
<p v-else>C</p>
}
```

```csharp
return (_ctx.visible)
    ? _createElementBlock(_openBlock(), "div", _createProps(("key", 0)), "A")
    : (_ctx.other)
        ? _createElementBlock(_openBlock(), "span", _createProps(("key", 1)), "B")
        : _createElementBlock(_openBlock(), "p", _createProps(("key", 2)), "C");
```

With no `v-else`, the chain terminates in a comment placeholder so the renderer keeps a stable
anchor:

```csharp
// <div v-if="ok">A</div>
return (_ctx.ok)
    ? _createElementBlock(_openBlock(), "div", _createProps(("key", 0)), "A")
    : _createCommentVNode("v-if", true);
```

Put `v-if` on a `<template>` to guard several children without adding an element. Diagnostics:
`XVIfNoExpression` (recovered as `true`), `XVElseNoAdjacentIf`, `XVIfSameKey`.

### v-for

```viu
@template {
<li v-for="item in items" :key="item.id">{{ item.Label }}</li>
}
```

```csharp
return _createElementBlock(_openBlock(true), _Fragment, null, _renderList(_ctx.items, (item) => {
    return _createElementBlock(_openBlock(), "li", _createProps(("key", item.id)), _toDisplayString(item.Label), 1 /* TEXT */);
}), 128 /* KEYED_FRAGMENT */);
```

The fragment's patch flag records what the renderer may assume: `StableFragment` (64) when the
source is constant, `KeyedFragment` (128) when a `:key` is present, `UnkeyedFragment` (256)
otherwise. `_renderList` has five overloads covering `IEnumerable<T>` with and without an index,
an `int` count with and without an index, and `IEnumerable<KeyValuePair<TKey, TValue>>` for the
`(value, key, index)` form.

A `:key` belongs on the real element, not on a `<template v-for>` — otherwise
`XVForTemplateKeyPlacement` is reported. Diagnostics: `XVForNoExpression`,
`XVForMalformedExpression`, `XVForTemplateKeyPlacement`. See [Conditional & List
Rendering](../guide/essentials/conditional-and-list.md) for the keying and reconciliation rules.

## Binding directives

### v-bind

```viu
@template {
<div v-bind:id="x"></div>
<div :id="x"></div>
<div :[key]="x"></div>
<div .id="x"></div>
<div :id></div>
<div :view-box.camel="x"></div>
<div v-bind="attributes" id="a"></div>
}
```

- **`.camel`** — camelizes a static argument, or wraps a dynamic one in `_camelize`.
- **`.prop`** — prefixes the emitted key with `.` (forces the property path).
- **`.attr`** — prefixes the emitted key with `^` (forces the attribute path).
- **A dynamic argument** — is null-guarded and escalates the element to `PatchFlags.FullProps`.
- **`class` and `style`** — a dynamic value is wrapped in `_normalizeClass` / `_normalizeStyle`
  and sets `PatchFlags.Class` / `PatchFlags.Style`.
- **Argument-less `v-bind="obj"`** — merges through `_mergeProps` and escalates to `FullProps`.

Style map keys must be **kebab-case CSS names** (`"font-size"`) or `--custom` properties.
camelCase key normalization does not exist yet: a `"fontSize"` key is handed straight to
`style.setProperty` and silently does nothing.

Diagnostics: `XVBindNoExpression`, `XVBindInvalidSameNameArgument`.

### v-on

```viu
@template {
<button @click="count++">increment</button>
<button @click="save($event)">save</button>
<button @click="first(); second()">both</button>
<button @click.prevent="record($event)">guarded</button>
<input @keyup.enter="onEnter" />
<input @keydown.enter.stop="onEscape" />
}
```

```csharp
// <button @click="count++" @submit="save">Go</button>
return _createElementBlock(_openBlock(), "button", _createProps(
    ("onClick", _withHandler(__event => (_ctx.count++))),
    ("onSubmit", _withHandler(_ctx.save))
), "Go", 40 /* PROPS, NEED_HYDRATION */, ["onClick", "onSubmit"]);

// @click.prevent="record($event)" — a void call becomes a statement-block lambda,
// and the guard's own overload set types it, so no _withHandler wrapper.
_withModifiers(__event => { _ctx.record(__event); }, ["prevent"])
```

Modifier buckets decide the emitted shape:

| Bucket | Modifiers | Effect |
| --- | --- | --- |
| Event option | `.once`, `.capture`, `.passive` | appends a capitalized suffix to the prop key (`onClickOnce`) |
| Non-key guard | `.stop`, `.prevent`, `.self`, `.ctrl`, `.shift`, `.alt`, `.meta`, `.exact`, `.middle` | wraps in `_withModifiers` |
| Either | `.left`, `.right` | a key guard on `keyup`/`keydown`/`keypress`, a mouse-button guard on anything else; on a **dynamic** event name it is added to *both* buckets |
| Key guard | everything else | wraps in `_withKeys`, applied only for a dynamic key or `keyup`/`keydown`/`keypress` |

On a static `@click`, `.right` rewrites the prop key to `onContextmenu` and `.middle` to
`onMouseup` — the remap fires only when the resolved key is literally `onClick`. A dynamic event
name gets the runtime ternary `(key) === "onClick" ? "onContextmenu" : (key)` instead; any other
static event name is left alone. Guards nest — `@keydown.enter.stop` emits
`_withKeys(_withModifiers(handler, ["stop"]), ["enter"])`, which resolves because both helper sets
include an `Action<BrowserEvent>` overload.

Two traps worth knowing before you ship:

- **`WithModifiers` passes for any unrecognized modifier name.** A typo like `.prevnt` silently
  does nothing rather than erroring.
- **`WithKeys` compares against `Hyphenate(event.Key).ToLowerInvariant()`.** `"ArrowUp"` becomes
  `"arrow-up"`. Use hyphenated lowercase, or the alias table: `esc`, `space`, `up`, `left`,
  `right`, `down`, `delete`. An event with an empty `Key` never matches.

> **Status:** Unguarded `@event` handlers do not dispatch. `BrowserEventInvokerRegistry.Invoke`
> switches on exactly two delegate shapes — `Action<BrowserEvent>` and `Action` — and throws
> `NotSupportedException` for anything else. That throw happens *inside* the registry's own
> `try`/`catch`, so it routes to `ErrorSink`, which defaults to
> `Debug.WriteLine($"[Vue warn] Unhandled error in event handler: …")` — invisible in a Release
> WASM build. The handler simply never runs.

This matters because `_withHandler` does not normalize the delegate: every overload returns the
handler unchanged as `object?`, so the **runtime** type is whichever overload C# picked.

| Emitted shape | Bound overload | Dispatches? |
| --- | --- | --- |
| `_withHandler(_ctx.save)` where `save` is `void save()` | `_withHandler(Action)` | yes |
| `_withHandler(__event => (_ctx.count++))` (`@click="count++"`) | `_withHandler(Func<object?, object?>)` | **no** |
| `_withHandler(__event => { _ctx.record(__event); })` (`@click="record($event)"`) | `_withHandler(Action<object?>)` | **no** |
| `_withModifiers(…)` / `_withKeys(…)` (any `.stop`, `.prevent`, `.enter`, …) | returns `Action<BrowserEvent>` | yes |

So today the reliable spellings are a **parameterless void method group** (`@click="save"` against
`public void save()`) or **any handler carrying at least one modifier**, because the guard helpers
adapt onto `Action<BrowserEvent>` themselves. Inline expression handlers and event-taking handlers
compile and render, but are dropped at dispatch. Closing the gap means teaching `_withHandler` to
adapt, or teaching the registry to accept `Action<object?>`/`Func<object?, object?>`; neither
exists yet.

See [Event Handling](../guide/essentials/event-handling.md) for the full `BrowserEvent` surface and
the deferred-intent semantics of `StopPropagation()` / `PreventDefault()`.

Diagnostic: `XVOnNoExpression`, reported only when there is neither an expression nor a modifier.

## v-model

On a native element the compiler picks a runtime directive by tag and `type`, filters the
`modelValue` prop out (the value rides on the directive binding instead), and keeps the update
handler:

| Template | Runtime directive |
| --- | --- |
| `<input v-model="text" />` | `_vModelText` |
| `<input type="checkbox" v-model="c" />` | `_vModelCheckbox` |
| `<input type="radio" v-model="r" />` | `_vModelRadio` |
| `<select v-model="s"></select>` | `_vModelSelect` |
| `<textarea v-model="t"></textarea>` | `_vModelText` |
| `<input :type="kind" v-model="d" />` | `_vModelDynamic` |

```viu
@template {
<div v-show="visible">
  <input v-model="textModel" />
  <input type="checkbox" v-model="checkModel" />
  <input type="radio" value="a" v-model="radioModel" />
  <select v-model="selectModel"><option value="x">X</option></select>
  <input :type="kind" v-model="dynamicModel" />
</div>
}
```

```csharp
// <input v-model="name" />
return _withDirectives(
    _createElementBlock(_openBlock(), "input", _createProps(
        ("onUpdate:modelValue", _withHandler(__event => ((_ctx.name) = __event)))
    ), null, 8 /* PROPS */, ["onUpdate:modelValue"]),
    new object?[] { new object?[] { _vModelText, _ctx.name } });
```

At runtime each directive reads its bound value as a `ViuModelBinding` — a `Value` snapshot paired
with an `Action<object?> Setter`. Viu has no `this`-proxy and no reflection, so the write-back
path must be a plain delegate:

```csharp
Directives.WithDirectives(
    VirtualNodeFactory.Element("input"),
    VModelText.Instance,
    new ViuModelBinding(model.Value, next => model.Value = next));
```

Modifiers on `VModelText`: `.lazy` listens on `change` instead of `input`; `.number` coerces
loosely and leaves non-numeric input untouched; `.trim` trims and re-syncs the element on blur.
Order is trim then number, matching upstream. `IDirective` exposes seven hook slots; the five
`v-model` directives use at most five of them. All five implement `Created`, `BeforeUpdate`, and
`BeforeUnmount`. `VModelRadio` is the only one without `Mounted`. `VModelSelect` and
`VModelDynamic` are the only ones that add `Updated`, giving them the full five.

On a **component**, `v-model="value"` compiles to a `modelValue` prop plus an
`onUpdate:modelValue` handler, and `v-model:title.trim="value"` to `title` + `onUpdate:title` +
`titleModifiers`. Modifier objects are emitted for components only. See [Form Input
Bindings](../guide/essentials/form-bindings.md) for the native-element directives and [Component
v-model](../guide/components/v-model.md) for the component boundary.

Diagnostics: `XVModelNoExpression`, `XVModelMalformedExpression`, `XVModelOnInvalidElement`,
`XVModelArgumentOnElement`, `XVModelOnFileInputElement`, `XVModelUnnecessaryValue`.

## v-show

`v-show` contributes no props; it requests the `_vShow` runtime directive:

```csharp
// <div v-show="visible">shown</div>
return _withDirectives(
    _createElementBlock(_openBlock(), "div", null, "shown", 512 /* NEED_PATCH */),
    new object?[] { new object?[] { _vShow, _ctx.visible } });
```

`VShow` toggles the inline `display` from a truthy/falsy binding while preserving the original.
Because its `BeforeMount` hook runs before insertion, an initially-falsy element is hidden from
the first paint — there is no flash. Truthiness follows JavaScript coercion, and `Updated`
short-circuits when truthiness is unchanged.

One deliberate divergence: **the saved display is derived from the vnode's `style` prop, not an
interop read of `el.style.display`.** For inline styles the two are equivalent and Viu saves one
boundary crossing. When a *stylesheet* sets `display`, Viu saves an empty original and restores by
*removing* the inline property, so the stylesheet value wins. A saved value of `"none"` is
normalized to empty, so restoring always reveals the element.

`v-show` + `<Transition>` coordination is **not wired**: `VShow`'s transition-seam hooks are inert
placeholders. See [Transition & TransitionGroup](../guide/built-ins/transition.md).

Diagnostic: `XVShowNoExpression`.

## Content directives

### v-html and v-text

`v-html` compiles to an `innerHTML` prop; `v-text` to a `textContent` prop whose non-constant
expression is wrapped in `_toDisplayString`. Both **clear the element's children** when children
are also present, and report `XVHtmlWithChildren` / `XVTextWithChildren`.

```csharp
// <div v-html="raw"></div>   → prop "innerHTML" = raw
// <div v-text="msg"></div>   → prop "textContent" = _toDisplayString(msg)
```

Diagnostics: `XVHtmlNoExpression`, `XVTextNoExpression`.

## Caching directives

### v-once

`v-once` marks a subtree render-once, pauses block tracking around it, and reserves one `_cache`
slot. `RenderFunctionEmitterResult.CacheSlotCount` tells the runtime how large the cache array
must be — C# arrays cannot grow on assignment, so the count is part of the contract.

```csharp
// <div v-once><span>{{ frozen }}</span></div>   → CacheSlotCount == 1
return (_cache[0] ??= _setCache(0, _setBlockTracking(-1, true), _createElementVNode("div", null, new object?[] {
    _createElementVNode("span", null, _toDisplayString(_ctx.frozen), 1 /* TEXT */)
})));
```

`_setCache` exists because C# has no comma operator — it sequences the tracking call before the
value.

### v-memo

> **Status:** Not yet implemented.

The transform runs and the IR is correct: a `withMemo` call with a reserved cache slot, or under
`v-for`, a per-item memo loop with a trailing `_cached` parameter and `isMemoSame`. But the
emitted code still carries JavaScript-shaped member accesses (`_cached.key`), no `_withMemo` or
`_isMemoSame` member exists on `RenderHelpers`, and `v-memo` templates are deliberately excluded
from the emitted-code parse-validity suite. Treat `v-memo` as roadmap for the C# path — a template
using it will not compile.

## Compiler-only directives

### v-pre

`v-pre` is handled entirely in the **parser**, not by a transform. Inside a `v-pre` subtree the
parser stops doing everything Vue-ish:

- **The `v-pre` attribute itself is dropped** — it never reaches the property list.
- **Every directive becomes a plain `AttributeNode`**, keeping its raw name (`":id"`, `"v-if"`) —
  including directives already collected on the *same* tag, which are retroactively downgraded.
- **Interpolation delimiters become literal text** — `{{ raw }}` survives into a `TextNode` whose
  `Content` is the literal string `{{ raw }}`, and `toDisplayString` is never used.
- **Elements are never classified** as Component, Slot, or Template.

```csharp
// <div v-pre :id="foo"><Comp v-if="x"/></div>
element.Properties.ShouldHaveSingleItem().ShouldBeOfType<AttributeNode>().Name.ShouldBe(":id");
child.ElementType.ShouldBe(ElementType.Element);   // <Comp> is not a component here

// <div v-pre>{{ raw }}</div>
codegen.Children.ShouldBeOfType<TextNode>().Content.ShouldBe("{{ raw }}");
```

### v-cloak

An explicit no-op directive transform: it contributes no props and no runtime directive, so
`VNodeCall.Props` is `null`. It is registered precisely so it is *not* mistaken for a custom
directive that needs `resolveDirective`.

## Custom directives

Any directive name that is neither a registered `DirectiveTransform` nor one of the built-ins
(`bind`, `cloak`, `else-if`, `else`, `for`, `html`, `if`, `model`, `on`, `once`, `pre`, `show`,
`slot`, `text`, `memo`) is emitted as a runtime directive: registered through `AddDirective`,
resolved into a local, and applied through `_withDirectives`.

```csharp
// <input v-focus />
var _directive_focus = _resolveDirective("focus");

return _withDirectives(
    _createElementBlock(_openBlock(), "input", null, null, 512 /* NEED_PATCH */),
    new object?[] { new object?[] { _directive_focus } });
```

The tuple is `[directive, value?, argument?, modifiers?]`, with `null` placeholders where an
earlier slot is absent. An element that has both children and a custom directive is forced into a
block. Write the directive itself against `IDirective` and register it with
`app.Directive("focus", MyDirective.Instance)` — see [Custom
Directives](../guide/reusability/custom-directives.md).

## Reference: the `<slot>` outlet

`<slot>` is not a directive, but it is part of the same contract.

```viu
@template {
<slot></slot>
<slot name="header"><p>fallback</p></slot>
<slot :name="dynamicName" :row="row" />
}
```

```csharp
// <slot name="header"><p>fallback {{ hint }}</p></slot>
return _renderSlot(_ctx.__slots, "header", _createProps(), () => new object?[] {
    _createElementVNode("p", null, "fallback " + _toDisplayString(_ctx.hint), 1 /* TEXT */)
});
```

Two spellings to recognize: **`$slots` has no legal C# identifier**, so the emitter writes
`_ctx.__slots`; and the `{}` props placeholder emits as an empty `_createProps()`. Non-`name`
attributes are camelized into slot props. A custom directive on a slot outlet reports
`XVSlotUnexpectedDirectiveOnSlotOutlet`.

`v-slot` builds the consuming side, and it is the one syntax irregularity in the whole language:
**it has no modifiers.** Dots in `#foo.bar.baz` fold *into* the argument content, giving the
single argument `"foo.bar.baz"`. Every other directive splits on dots. Fallback content, the
`SlotFlags` performance rule, and the slot diagnostics are covered in
[Slots](../guide/components/slots.md).

## Reference: `<component :is>`

```viu
@template {
<component :is="viewName"></component>
<component is="foo"></component>
<div is="vue:MyComp"></div>
}
```

```csharp
return _createBlock(_openBlock(), _resolveDynamicComponent(_ctx.viewName));
```

The `vue:` prefix is deliberately retained from upstream rather than renamed.
`ResolveDynamicComponent` passes an `IComponentDefinition` through, resolves a non-empty string
against the app registry, and — if unregistered — returns the string **as-is** to be used as an
element tag. That is why it does **not** warn on a miss, while `_resolveComponent` does:
`:is="'div'"` is a normal, intended path. Because the resolved tag changes identity, a changed
`is` fails the renderer's same-type check and fully replaces the subtree.

Core built-ins resolve to helper markers instead of registry lookups. `_BaseTransition` resolves
to the real `BaseTransition.Instance`, but `_Teleport`, `_Suspense`, and `_KeepAlive` are marker
objects. Passing one as a vnode tag throws a `NotSupportedException` whose message names the
component — `The built-in component <Teleport> is not yet supported by the runtime renderer.`
See [KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md).

More on registration and the exact-versus-case-insensitive lookup split in [Dynamic Components &
Registration](../guide/components/dynamic-components.md).

## Where the helpers live

Generated render bodies bind helpers **by name** — the compiler never references the runtime
assembly. The generator emits two file-level static imports, and the split between them is a real
architectural boundary:

```csharp
using static global::Assimalign.Viu.RuntimeCore.RenderHelpers;
using static global::Assimalign.Viu.RuntimeDom.DomRenderHelpers;
```

- **`RenderHelpers` (`Assimalign.Viu.RuntimeCore`)** — platform-agnostic. `_openBlock`,
  `_createElementBlock`, `_toDisplayString`, `_renderList`, `_renderSlot`, `_withCtx`,
  `_withDirectives`, `_mergeProps`, `_normalizeClass`, `_normalizeStyle`, `_resolveComponent`,
  `_resolveDirective`, `_resolveDynamicComponent`, `_unref`, `_Fragment`. Nothing here knows what
  a DOM node is — `Renderer<TNode>` is generic over the platform node type.
- **`DomRenderHelpers` (`Assimalign.Viu.RuntimeDom`)** — DOM-only, and *necessarily* so. `_vShow`,
  `_vModelText`, `_vModelCheckbox`, `_vModelRadio`, `_vModelSelect`, `_vModelDynamic`,
  `_withModifiers`, `_withKeys`, `_Transition`, `_TransitionGroup`. Every one of these depends on
  something browser-shaped: the directive singletons unbox an `int` node handle, and the guards
  are typed over `BrowserEvent`. They cannot live in a renderer that is generic over `TNode`.

`_withModifiers` and `_withKeys` each ship **four overloads** — `Func<BrowserEvent, object?>`,
`Action<BrowserEvent>`, `Func<object?>`, and `Action` — one per handler shape the emitter can
produce, all adapting onto the single `Action<BrowserEvent>` guard. `_Transition` and
`_TransitionGroup` are typed `object`, not `IComponentDefinition`, because they are passed as a
vnode *tag* and resolved by the factory's component arm.

These `_`-prefixed lowercase names are a deliberate, generated-code-only deviation from Viu's
whole-word naming rule. The names **are** the upstream `helperNameMap` contract and the code
generator binds them literally — they are not to be "corrected." Everything else in the library
uses whole words: `Properties`, `Attributes`, `Subtree`, `VirtualNode`.

## Not yet implemented

- **`v-memo` end to end** — the IR is built and code is emitted, but it is not legal C# and the
  `_withMemo` / `_isMemoSame` runtime helpers do not exist.
- **Dispatch for unguarded `v-on` handlers** — `_withHandler` returns the delegate unchanged, so an
  inline or event-taking handler is stored as `Func<object?, object?>` or `Action<object?>`, and
  the event invoker registry accepts only `Action<BrowserEvent>` and `Action`. The handler compiles
  and renders but never fires. See [v-on](#v-on).
- **Destructuring patterns in `v-slot` props and `v-for` aliases** — `#item="{ label }"` and
  `v-for="({ id }) in items"` parse and register their names in scope, but the pattern is emitted
  verbatim into the lambda parameter list, which is not compilable C#. Plain positional aliases are
  fine and are pinned by the emitter's parse-validity suite: `v-for="(item, index) in items"` emits
  `_renderList(_ctx.items, (item, index) => …)` and binds the indexed `IEnumerable<T>` overload.
- **`v-show` + `<Transition>` coordination** — the transition state machine exists and the
  renderer honors a persisted transition, but `VShow` does not yet build one.
- **Handler caching** — `TransformOptions.CacheHandlers` exists and `v-on` honors it, but the
  generator keeps it off: upstream's cached handler wraps in JavaScript rest arguments, which has
  no C# spelling yet.
- **Filters** — `HelperNames.ResolveFilter` exists for numeric parity only. Nothing parses or
  emits a filter. Vue 3 removed them.
- **Scoped-style attribute injection** — `TransformOptions.ScopeId` is carried for parity. Two
  places read it (the slot-outlet transform's argument-count logic and the static stringifier, which
  would append it to stringified static markup), but the single-file-component generator never sets
  it, so it is null in the real pipeline and nothing is injected. The scope id itself is real: the
  generator emits it as a `ScopeId` constant (`data-v-<hash>`) on the generated component class.

## See also

- [Template Syntax](../guide/essentials/template-syntax.md) — interpolation, identifier rewriting,
  and the C#-expression rules every directive value obeys.
- [Render Functions & VirtualNode](render-function.md) — the vnode surface these helpers produce.
- [Compiler Diagnostics](diagnostics.md) — the full `CompilerErrorCode` catalog.
- [Differences from Vue 3](../roadmap/vue-differences.md) — the naming map and the behavioral
  divergences.
