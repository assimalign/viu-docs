# Conditional & List Rendering

How `v-if`, `v-else-if`, `v-else`, and `v-for` work in Viu templates, what they compile to, and the
keying rules that make list updates cheap.

> **Status:** Implemented. Two narrow codegen gaps and one alias limitation are listed under
> [Not yet implemented](#not-yet-implemented).

Both directives are structural: the compiler does not emit them as props on an element, it *folds the
element away* and replaces it with a container node in the intermediate representation — an `IfNode`
holding ordered `IfBranchNode`s, or a `ForNode` holding the decomposed aliases. The markup is Vue's
verbatim ([`v-if`](https://vuejs.org/guide/essentials/conditional.html),
[`v-for`](https://vuejs.org/guide/essentials/list.html)); the expression bodies inside the quotes are
C#, parsed with Roslyn. See [Template Syntax](template-syntax.md) for the expression rules that apply
everywhere.

## Conditional rendering

### v-if, v-else-if, v-else

Adjacent conditional siblings are grouped into a single `IfNode` and compiled to one nested
conditional expression. Comments and whitespace between branches are absorbed into the following
branch, so the chain is not broken by formatting.

```viu
@template {
    <p v-if="IsLoading">Loading…</p>
    <p v-else-if="HasFailed">Could not load the report.</p>
    <ReportTable v-else :rows="Rows" />
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<bool> IsLoading = Reactive.Reference(true);
    public Reference<bool> HasFailed = Reactive.Reference(false);
    public readonly ReactiveList<ReportRow> Rows = new();
}
```

Note the two kinds of member declaration, because how you declare a `@script` member decides how the
compiler binds it in the template:

- **A `Reference<T>` member is written bare in the template** — `IsLoading`, never `IsLoading.Value`.
  The compiler classifies it as a setup reference and inserts the `.Value` unwrap itself, in both read
  and write positions. Writing `IsLoading.Value` yourself emits `_ctx.IsLoading.Value.Value` and will
  not compile. (`Reference`, `ShallowReference`, `CustomReference`, `Computed`, and `IReference` are the
  five declared type names that get this treatment; the classifier matches them by simple name.)
- **A collection member should be `readonly` (or a get-only property)** — that classifies it as a
  setup constant and emits `_ctx.Rows` directly. A plain mutable field is classified as a setup *let*
  and routes through `_unref(...)`, whose signature is `object? _unref(object?)` — it erases the
  element type the `_renderList` overloads need.

The conditions are `bool` members rather than an enum comparison on purpose. Expression rewriting
prefixes with `_ctx.` every identifier that is not a template-local, a `@script` member, or one of the
compiler's global allow-list entries, and the `@script` analyzer deliberately skips nested type
declarations when it builds the binding table — so a user type named in a condition becomes a member
access on the component. `v-if="Status == LoadState.Loading"` emits
`_ctx.Status.Value == _ctx.LoadState.Loading`, which does not compile. There is no template diagnostic
for it; the failure is an ordinary C# error, mapped back to the `.viu` line and column by the
generator's `#line` map. The allow-list *does* cover the common BCL roots — `Math`, `String`,
`Convert`, `DateTime`, `TimeSpan`, `Guid`, `Enumerable`, `Comparer`, `EqualityComparer`, `CultureInfo`,
and the `System` namespace root itself — so `Math.Max(a, b)` and `System.DayOfWeek.Monday` are fine.
See [Template Syntax](template-syntax.md) for the full rewriting rules.

A three-branch chain emits a nested ternary. This is the verified emitter output for
`<div v-if="visible">A</div><span v-else-if="other">B</span><p v-else>C</p>`:

```csharp
return (_ctx.visible)
    ? _createElementBlock(_openBlock(), "div", _createProps(("key", 0)), "A")
    : (_ctx.other)
        ? _createElementBlock(_openBlock(), "span", _createProps(("key", 1)), "B")
        : _createElementBlock(_openBlock(), "p", _createProps(("key", 2)), "C");
```

A **lone `v-if` with no `v-else`** does not compile to a null branch — it terminates with a comment
vnode, which is what preserves the element's position in the parent's child list:

```csharp
// <div v-if="ok">A</div>
return (_ctx.ok)
    ? _createElementBlock(_openBlock(), "div", _createProps(("key", 0)), "A")
    : _createCommentVNode("v-if", true);
```

### Branch keys

Each branch gets a compiler-injected `key` (`0`, `1`, `2`, …), incrementing across sibling chains at
the same depth. These synthetic keys are one of the very few expressions in Viu that reach a constant
`ConstantType` — Viu forbids dynamic code generation under AOT, so it never evaluates a user
expression at compile time the way Vue's `new Function` path does. Every interpolation and every
dynamic `v-bind` value stays `ConstantType.NotConstant`.

You may supply your own `:key` on a branch to force a full teardown between branches instead of a
patch. Two branches in the same chain must not use the same key — that is `XVIfSameKey`.

### v-if on `<template>`

Put `v-if` on a `<template>` when a branch needs several sibling children. The `<template>` itself is
not rendered; its children compile to a keyed, stable `Fragment`.

```viu
@template {
    <template v-if="Selection is not null">
        <h2>{{ Selection.Title }}</h2>
        <p>{{ Selection.Summary }}</p>
    </template>
    <p v-else>Nothing selected.</p>
}
```

A `<template>` element is only classified as `ElementType.Template` when it actually carries one of
the special directives — `v-if`, `v-else-if`, `v-else`, `v-for`, or `v-slot`. A bare `<template>` is
just an element.

### v-if versus v-show

| | `v-if` | `v-show` |
| --- | --- | --- |
| **Mechanism** | Structural — the branch is created or destroyed | A runtime directive that toggles the element's inline display |
| **Compiles to** | A conditional expression over block calls | `_vShow` in the element's `_withDirectives` array |
| **Patch flag** | Per-branch flags; the chain itself is not flagged | `PatchFlags.NeedPatch` (`512`), but only when the element has no other patch flag |
| **Contributes props** | Branch `key` only | None |
| **`<template>` support** | Yes | No — `v-show` needs a real element |
| **Initial cost** | Nothing rendered until the condition is true | The element is always mounted |

That `NeedPatch` condition is worth spelling out: a runtime directive contributes it only when the
element would otherwise be unflagged, so a `v-show` element that also carries a dynamic binding keeps
that binding's flag instead.

Reach for `v-if` when a branch is rarely taken or expensive; reach for `v-show` when the element
toggles often. `_vShow` is a `static readonly IDirective` on `Assimalign.Viu.RuntimeDom.DomRenderHelpers`,
not on `RenderHelpers` — see [Built-in Directives](../../api/built-in-directives.md).

### Conditional diagnostics

| Code | Meaning | Recovery |
| --- | --- | --- |
| `XVIfNoExpression` | `v-if` / `v-else-if` has no expression | The condition is recovered as `true` |
| `XVElseNoAdjacentIf` | `v-else` / `v-else-if` has no adjacent `v-if` chain to join | The directive is dropped |
| `XVIfSameKey` | Two branches in one chain declare the same `:key` | Reported at the duplicate key's location |

No diagnostic is raised as an exception. Every recoverable compiler error is pushed through
`TransformOptions.OnError` — an `Action<CompilerError>?` that defaults to swallowing them — and surfaces
as a build warning or error; see [Compiler Diagnostics](../../api/diagnostics.md). (The handful of
`InvalidOperationException`s left in the compiler guard internal invariants on unreachable paths, not
user input.)

## List rendering

### v-for basics

Both `in` and `of` are accepted, exactly as in Vue.

```viu
@template {
    <ul>
        <li v-for="item in Items" :key="item.Id">{{ item.Title }}</li>
    </ul>
}

@script {
    using Assimalign.Viu.Reactivity;

    public readonly ReactiveList<TodoItem> Items = new()
    {
        new TodoItem { Id = 1, Title = "Port the reactivity graph", Done = true },
        new TodoItem { Id = 2, Title = "Port the renderer", Done = false },
    };
}
```

The item type is an ordinary source-generated reactive object, so mutating `item.Done` inside the
loop re-renders only the row that changed:

```csharp
using Assimalign.Viu.Reactivity;

[Reactive]
public partial class TodoItem
{
    public partial int Id { get; set; }

    public partial string Title { get; set; }

    public partial bool Done { get; set; }
}
```

`v-for` aliases are **template-local**: inside the loop body, `item` shadows any component member of
the same name, and the shadow is ref-counted so nested loops that reuse a name restore correctly.
Because the alias is a local, it is emitted bare — no `_ctx.` prefix and no `.Value` unwrapping.

### The five `_renderList` shapes

`v-for` always compiles to a `_renderList` call wrapped in a `Fragment` block. The compiler picks the
overload from the alias shape; the source expression's C# type picks the rest. All five live on
`Assimalign.Viu.RuntimeCore.RenderHelpers`.

| Template | Overload | Alias meaning |
| --- | --- | --- |
| `v-for="item in items"` | `_renderList<T>(IEnumerable<T>?, Func<T, VirtualNode?>)` | `item` = element |
| `v-for="(item, index) in items"` | `_renderList<T>(IEnumerable<T>?, Func<T, int, VirtualNode?>)` | `index` is zero-based |
| `v-for="n in 10"` | `_renderList(int, Func<int, VirtualNode?>)` | `n` is **one-based** |
| `v-for="(n, index) in 10"` | `_renderList(int, Func<int, int, VirtualNode?>)` | `n` one-based, `index` zero-based |
| `v-for="(value, key, index) in map"` | `_renderList<TKey, TValue>(IEnumerable<KeyValuePair<TKey, TValue>>?, Func<TValue, TKey, int, VirtualNode?>)` | value first, then key, then index |

Two details worth internalising:

- **A null source renders nothing, it does not throw** — every `IEnumerable` overload returns an
  empty `VirtualNode?[]` when the source is `null`, and the `int` overloads clamp a negative count
  to zero.
- **The numeric form is one-based** — `v-for="n in 3"` yields `n` of `1, 2, 3`, matching Vue's
  `renderList` number arm. If you want zero-based, take the second alias.

Iterating a dictionary follows Vue's `(value, key, index)` order, which is the reverse of what a C#
`KeyValuePair<TKey, TValue>` deconstruction would suggest:

```viu
@template {
    <dl>
        <template v-for="(count, label, index) in Totals" :key="label">
            <dt>{{ index }}. {{ label }}</dt>
            <dd>{{ count }}</dd>
        </template>
    </dl>
}

@script {
    using Assimalign.Viu.Reactivity;

    public readonly ReactiveDictionary<string, int> Totals = new()
    {
        ["open"] = 4,
        ["closed"] = 11,
    };
}
```

### `<template v-for>`

Use `<template v-for>` when each iteration produces several siblings. The inner children compile to a
stable `Fragment` nested inside the outer `renderList` fragment. Verified emitter output for
`<template v-for="row in rows"><td>{{ row }}</td><td>b</td></template>`:

```csharp
return _createElementBlock(_openBlock(true), _Fragment, null, _renderList(_ctx.rows, (row) => {
    return _createElementBlock(_openBlock(), _Fragment, null, new object?[] {
        _createElementVNode("td", null, _toDisplayString(row), 1 /* TEXT */),
        _createElementVNode("td", null, "b")
    }, 64 /* STABLE_FRAGMENT */);
}), 256 /* UNKEYED_FRAGMENT */);
```

**The `:key` belongs on the `<template>`, not on a child.** Placing it on an inner element reports
`XVForTemplateKeyPlacement` ("`<template v-for>` key should be placed on the `<template>` tag") —
which is correct, because the keyed unit of the outer fragment is the whole iteration, not one of its
elements.

```viu
@template {
    <!-- correct -->
    <template v-for="row in Rows" :key="row.Id">
        <dt>{{ row.Label }}</dt>
        <dd>{{ row.Amount }}</dd>
    </template>

    <!-- XVForTemplateKeyPlacement -->
    <template v-for="row in Rows">
        <dt :key="row.Id">{{ row.Label }}</dt>
        <dd>{{ row.Amount }}</dd>
    </template>
}
```

### Keys and reconciliation

The keyed form is the one you want in almost every real list. Verified emitter output for
`<li v-for="item in items" :key="item.id">{{ item.label }}</li>`:

```csharp
return _createElementBlock(_openBlock(true), _Fragment, null, _renderList(_ctx.items, (item) => {
    return _createElementBlock(_openBlock(), "li", _createProps(("key", item.id)),
        _toDisplayString(item.label), 1 /* TEXT */);
}), 128 /* KEYED_FRAGMENT */);
```

Note `_openBlock(true)` — block tracking is **disabled** for the fragment, because the set of dynamic
descendants changes with the data and cannot be collected once. That is precisely why keys matter:
with block tracking off, the renderer falls back to a full children diff for that fragment.

`Renderer<TNode>` runs the upstream five-phase keyed children diff — sync from the head, sync from the
tail, mount the remaining new nodes, unmount the remaining old ones, and for a genuinely reordered
middle run a true **longest-increasing-subsequence** pass so only the nodes *outside* the subsequence
are moved. Keys are what make that possible; without them, a reorder degenerates into patching every
node in place. The renderer also warns on duplicate keys and on a keyed/keyless mix within one
fragment.

Which fragment flag you get:

| Flag | Value | When |
| --- | --- | --- |
| `PatchFlags.StableFragment` | `64` | The source expression is constant, or the fragment is a `<template>`'s fixed child list |
| `PatchFlags.KeyedFragment` | `128` | A `:key` is present on the iterated element |
| `PatchFlags.UnkeyedFragment` | `256` | No `:key` |

In practice a `v-for` source is **never** `StableFragment` in Viu: constant-expression evaluation is
not implemented (it would require the dynamic codegen AOT forbids), so a `v-for` source is always
`ConstantType.NotConstant`. `StableFragment` shows up only on the inner child fragments, as in the
`<template v-for>` output above.

### v-if and v-for on the same element

Don't. The transform order is fixed — `v-once`, `v-if`, `v-memo`, `v-for`, then expression
rewriting — so `v-if` is processed **before** `v-for` and its condition is evaluated in the outer
scope, where the loop alias does not exist yet. Referencing the alias from the condition either fails
to resolve or silently binds to a same-named component member.

Wrap instead, choosing which directive should be outermost:

```viu
@template {
    <!-- filter the list: v-if inside the loop -->
    <template v-for="item in Items" :key="item.Id">
        <li v-if="!item.Done">{{ item.Title }}</li>
    </template>

    <!-- gate the whole list: v-if outside the loop -->
    <ul v-if="Items.Count > 0">
        <li v-for="item in Items" :key="item.Id">{{ item.Title }}</li>
    </ul>
    <p v-else>Nothing to do.</p>
}
```

The second shape is usually better when you are filtering, because doing the filtering in C# keeps
the rendered list dense. `v-for="item in Items.Where(x => !x.Done)"` is a legal template expression:
the lambda parameter `x` is declared inside the expression, so rewriting leaves it alone, and `Where`
is a member name, never prefixed. It needs `using System.Linq;` in the `@script` block, though — the
generated file emits only the two `using static` render-helper imports plus whatever usings you hoist
from `@script` (unless your project turns on `ImplicitUsings`):

```viu
@script {
    using System.Linq;
    using Assimalign.Viu.Reactivity;

    public readonly ReactiveList<TodoItem> Items = new();
}
```

The compiler's global allow-list — the identifiers that are never prefixed with `_ctx.` — is a
separate mechanism; it includes `Enumerable`, so the static-call spelling
`Enumerable.Where(Items, x => !x.Done)` also survives rewriting.

### Reactive list sources

Use `ReactiveList<T>` when the *list itself* mutates. Its dependency model is fine-grained: one
dependency per index (created lazily, only on a tracked read), one iteration dependency, and one
length dependency.

| Read | Tracks |
| --- | --- |
| `list[i]` | index `i` only |
| `Count` | length |
| `Contains`, `IndexOf`, `CopyTo`, enumeration | iteration |

| Write | Triggers |
| --- | --- |
| `list[i] = v` on an existing index | that index and iteration — **not** length, and only when the value differs by `EqualityComparer<T>.Default` |
| `Add`, `AddRange`, `Insert`, `Remove`, `RemoveAt`, `RemoveRange`, `Clear` | iteration, length, and the shifted indices |
| `Clear()` on an already-empty list | nothing |

Because a render function that iterates the list takes the iteration dependency, adding or removing
an item re-renders the list; changing one item's own `[Reactive]` property does not, and only that
row patches.

```csharp
Items.Add(new TodoItem { Id = 3, Title = "Write the docs", Done = false });  // list re-renders
Items[0].Done = true;                                                        // only row 0 patches
```

**Watching a reactive collection needs the getter overload.** `Reactive.Watch(myList, callback)` does
not compile: the reactive-object overload is constrained to `IReactiveObject`, and
`ReactiveList<T>` / `ReactiveDictionary<TKey, TValue>` / `ReactiveSet<T>` implement
`IReactiveTraversable` but not `IReactiveObject`. Use a getter plus `Deep`:

```csharp
using System;

using Assimalign.Viu.Reactivity;

// does NOT compile — the generic constraint fails
// Reactive.Watch(Items, (value, oldValue, onCleanup) => { });

// correct: the Func<T> overload, T = ReactiveList<TodoItem>
WatchHandle handle = Reactive.Watch(
    () => Items,
    (value, oldValue, onCleanup) => Console.WriteLine($"{value.Count} items"),
    new WatchOptions { Deep = true });
```

The callback shape is the `WatchCallback<T>` delegate —
`void WatchCallback<T>(T value, T oldValue, OnCleanup onCleanup)` — so all three parameters are
required even when you ignore the last two.

Inside a component, prefer `ViuWatch.Watch` from `Assimalign.Viu.RuntimeCore` — it binds the handle to
the component's scope and supplies the scheduler that makes `Pre`/`Post` flush modes work. See
[Watchers](watchers.md), which also covers the `Flush` default that differs from Vue's.

Also remember that deep traversal is reflection-free: it descends only through `IReference` cells and
`IReactiveTraversable` values, so a plain CLR object stored in a list is a **leaf**. A deep watch will
never observe a mutation inside an un-annotated POCO. Mark item types `[Reactive]` — see
[Reactivity Fundamentals](reactivity-fundamentals.md).

### List diagnostics

| Code | Meaning |
| --- | --- |
| `XVForNoExpression` | `v-for` has no expression |
| `XVForMalformedExpression` | The expression does not match the `alias in source` / `alias of source` shape |
| `XVForTemplateKeyPlacement` | A `:key` sits on a child of a `<template v-for>` instead of the `<template>` |

## A note on string literals in conditions

Template expressions are C#, so `'active'` is a **char literal**, not a string. A condition like
`:class="ok ? 'on' : 'off'"` is a Roslyn parse error reported as `XInvalidExpression`. Delimit the
attribute with single quotes and use C# double-quoted strings inside:

```viu
@template {
    <li v-for="item in Items" :key="item.Id" :class='item.Done ? "done" : null'>
        {{ item.Title }}
    </li>
}
```

The same rule bites `v-if` conditions that compare against string constants. This is a general
property of the template language rather than something specific to these two directives —
[Template Syntax](template-syntax.md) covers the full list of JavaScript forms that do not carry over.

## Not yet implemented

- **Destructuring aliases** — Viu never destructures a `v-for` alias. A parenthesized alias list is
  always positional (`value`, then `key`, then `index`), exactly as in the table above, so
  `v-for="(a, b) in pairs"` over a list of C# tuples binds `b` to the **zero-based index**, not the
  tuple's second element. Deconstruct in the body (`a.Item2`) or project the source first. The
  matching slot-side gap is real rather than semantic: `#item="{ label }"` is emitted verbatim and is
  not a legal C# lambda parameter list — see [Slots](../components/slots.md).
- **Stringification of `v-for` / `v-if` body runs** — static descendants inside a loop or branch body
  still cache, they just never fold into a single `_createStaticVNode` innerHTML string. This is a
  throughput optimisation, not a correctness gap.
- **`v-memo` on the C# path** — `v-memo` parses and produces the per-item memo loop IR when placed on
  the same element as `v-for`, but the emitted memo condition is not yet legal C# end to end. Treat
  `v-memo` as roadmap.

See [Project Status](../../roadmap/status.md) for the wave-by-wave picture and
[Differences from Vue 3](../../roadmap/vue-differences.md) for the naming map.

## Related

- [Template Syntax](template-syntax.md) — interpolation, bindings, and the C# expression rules
- [Built-in Directives](../../api/built-in-directives.md) — the full directive reference including `v-show`
- [Reactive Collections](../../api/reactive-collections.md) — `ReactiveList<T>`, `ReactiveDictionary<TKey, TValue>`, `ReactiveSet<T>`
- [Render Functions & VirtualNode](../../api/render-function.md) — `_renderList`, `VirtualNodeFactory`, and `PatchFlags`
- [Performance](../best-practices/performance.md) — block trees, patch flags, and keying strategy
- [Compiler Diagnostics](../../api/diagnostics.md) — every `XV*` code and what triggers it
