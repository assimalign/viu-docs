# Render Functions & VirtualNode

Building virtual nodes by hand with `VirtualNodeFactory`, the `VirtualNode` model itself, and the
`RenderHelpers` contract that compiled `.viu` render bodies bind to.

> **Status:** Implemented. Two exceptions are labelled inline: the `_Teleport` / `_Suspense` /
> `_KeepAlive` tags are markers that throw (see [Built-in markers](#built-in-markers)), and of the
> optional renderer ops only `InsertStaticContent` is consumed (see
> [`RendererOptions<TNode>`](#rendereroptionstnode-and-the-optional-ops)). See
> [Project status](../roadmap/status.md).

Every Viu component ultimately produces a `VirtualNode` tree. A `.viu` file gets there through the
template compiler; a hand-written `IComponentDefinition` gets there by calling `VirtualNodeFactory`
directly. Both paths converge on the same model and the same renderer, so anything the compiler can
express you can also write by hand.

## There is no `h()`

Vue's [`h()`](https://vuejs.org/api/render-function.html#h) is a single overloaded function whose
arguments are disambiguated at runtime by inspecting their JavaScript types. Viu has no such alias.
The API is the explicit overload set on `VirtualNodeFactory`, one method per node kind:

```csharp
VirtualNodeFactory.Element("div", "hello");
VirtualNodeFactory.Text("hello");
VirtualNodeFactory.Comment(" placeholder ");
VirtualNodeFactory.Fragment(first, second);
VirtualNodeFactory.Component(new MyChild());
```

- **Why no alias** — runtime argument sniffing is exactly what a statically typed, AOT-compiled
  target should push to compile time; C# overload resolution does the same job with no allocation
  and no type tests.
- **Why the names are long** — the repo's whole-word naming rule applies to every hand-authored
  API. `RenderHelpers` is the one documented exception, and it exists for generated code only.

## Building nodes with `VirtualNodeFactory`

`VirtualNodeFactory` is a static class in `Assimalign.Viu.RuntimeCore`. It is the port of upstream's
`createVNode`/`cloneVNode`/`mergeProps`/`isVNode`/`normalizeVNode`, the `openBlock` family, and
`renderSlot`. All `VirtualNode` constructors are internal, so this class (or `RenderHelpers`) is the
only way to get one.

### A complete hand-written component

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

        void Increment() => count.Value++;

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(("class", "counter")),
            VirtualNodeFactory.Element("span", $"count is {count.Value}"),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", (Action)Increment)),
                "+1"));
    }
}
```

`Setup` runs once and returns the render function; the returned closure re-executes on every update.
See [Component API](component.md) and [Components](../guide/essentials/components.md) for the full
contract.

Note the cast on the handler. Prop values are typed `object?`, so a method group or lambda has no
target type and will not compile unwrapped — and a DOM listener must be exactly `Action` or
`Action<BrowserEvent>`. Any other delegate shape throws `NotSupportedException` at dispatch
(`"…handlers must be Action or Action<BrowserEvent>."`); the browser layer catches it and routes it
to the app error handler rather than letting it escape into the JS listener, so the symptom is a
reported error and a handler that never ran. Generated code solves the same problem with
`RenderHelpers._withHandler`; by hand, cast explicitly.

### Element overloads

| Overload | Use |
| --- | --- |
| `Element(string tag)` | Childless element. |
| `Element(string tag, params VirtualNode?[]? children)` | Element with node children. |
| `Element(string tag, string textChildren)` | Element with a single text child. |
| `Element(string tag, VirtualNodeProperties? properties, string textChildren)` | Props plus text. |
| `Element(string tag, VirtualNodeProperties? properties, params VirtualNode?[]? children)` | Props plus node children. |
| `Element(string tag, VirtualNodeProperties? properties, string textChildren, PatchFlags patchFlag, string[]? dynamicProperties = null)` | Compiler-shaped: text child with patch hints. |
| `Element(string tag, VirtualNodeProperties? properties, VirtualNode?[]? children, PatchFlags patchFlag, string[]? dynamicProperties = null)` | Compiler-shaped: node children with patch hints. |

The last two exist so a hand-written render function can opt into the same targeted patching the
compiler emits. See [Patch flags](#patchflags) below.

### Text, comments, and static content

```csharp
VirtualNodeFactory.Text("plain text");
VirtualNodeFactory.Text(count.Value.ToString(), PatchFlags.Text);
VirtualNodeFactory.Comment();               // empty comment
VirtualNodeFactory.Comment("v-if");         // labelled placeholder
VirtualNodeFactory.Static("<b>pre-rendered</b>");
```

- **`Text(string content, PatchFlags patchFlag = default)`** — a text node; pass `PatchFlags.Text`
  when the content is dynamic so the renderer patches text without a structural diff.
- **`Comment(string content = "")`** — a comment node. This is what an unsatisfied `v-if` branch
  becomes, and what a null child normalizes to.
- **`Static(string content)`** — a pre-rendered markup chunk inserted in one platform operation.
  Mounting one requires `RendererOptions<TNode>.InsertStaticContent`; without it the renderer throws
  `NotSupportedException`.

### Fragments

```csharp
VirtualNodeFactory.Fragment(header, body, footer);
VirtualNodeFactory.Fragment(children, key: "list", PatchFlags.KeyedFragment);
VirtualNodeFactory.FragmentBlock(children, key: null, PatchFlags.StableFragment);
```

A fragment renders its children with no wrapper element. `Fragment` is the port of Vue's
[`Fragment`](https://vuejs.org/api/built-in-special-elements.html#component). It and
`BaseTransition` are the only two built-in tags RuntimeCore realizes; `_Teleport`, `_Suspense`, and
`_KeepAlive` are markers that throw — see [Built-in markers](#built-in-markers).

### Components and slots

```csharp
var slots = new ComponentSlots
{
    ["default"] = _ => [VirtualNodeFactory.Element("span", "provided")],
    ["header"] = properties => [VirtualNodeFactory.Element("h1", properties as string ?? "untitled")],
};

var node = VirtualNodeFactory.Component(
    new MyPanel(),
    VirtualNodeFactory.Properties(("title", "Report")),
    slots);
```

And from inside the child, `RenderSlot` renders an outlet with optional fallback:

```csharp
public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    => () => VirtualNodeFactory.Element(
        "div",
        VirtualNodeFactory.RenderSlot(context.Slots, "header", null,
            () => [VirtualNodeFactory.Element("h1", "fallback header")]),
        VirtualNodeFactory.RenderSlot(context.Slots, "default"));
```

- **`Component(IComponentDefinition definition, VirtualNodeProperties? properties = null)`** — the
  simple form.
- **`Component(definition, properties, PatchFlags patchFlag, string[]? dynamicProperties)`** and
  **`Component(definition, properties, ComponentSlots? slots, PatchFlags patchFlag = default, string[]? dynamicProperties = null)`**
  — the compiler-shaped forms.
- **`ComponentBlock(definition, properties, slots, patchFlag, dynamicProperties)`** — a component
  vnode that also opens as a block root.
- **`RenderSlot(ComponentSlots? slots, string name, object? properties = null, Func<VirtualNode?[]?>? fallback = null)`**
  — the port of [`renderSlot`](https://vuejs.org/api/render-function.html). The output fragment is
  keyed `"_" + name` and the fallback branch is keyed `"_" + name + "_fb"`, so content and fallback
  never patch against each other. Fallback renders when the slot is absent **or** when its content
  renders empty — comments and null entries count as empty.

See [Slots](../guide/components/slots.md) for the template-side syntax and the `SlotFlags`
stability rules.

### Block factories

Blocks are the mechanism behind Viu's targeted patching: a block root collects its dynamic
descendants into a flat `DynamicChildren` list, and updating it visits only those nodes rather than
walking the whole subtree.

```csharp
VirtualNodeFactory.OpenBlock();
var block = VirtualNodeFactory.ElementBlock(
    "section",
    null,
    new VirtualNode?[]
    {
        VirtualNodeFactory.Element("header", "static-1"),
        VirtualNodeFactory.Element("nav", "static-2"),
        VirtualNodeFactory.Element("span", null, message.Value, PatchFlags.Text),
    });

// block.DynamicChildren has exactly one entry — the <span>.
```

Re-rendering that block visits the block root plus the single dynamic `<span>`; the three static
siblings are never touched. See [Performance](../guide/best-practices/performance.md).

| Member | Purpose |
| --- | --- |
| `OpenBlock(bool disableTracking = false)` | Pushes a new dynamic-child accumulator. `disableTracking: true` is the `v-for` case. |
| `SetBlockTracking(int value, bool inVOnce = false)` | Adjusts the tracking depth — how `v-once` pauses collection. |
| `ElementBlock(string tag, VirtualNodeProperties?, VirtualNode?[]?, PatchFlags, string[]?)` | Closes the open block onto an element vnode. |
| `ElementBlock(string tag, VirtualNodeProperties?, string textChildren, PatchFlags, string[]?)` | Same, with a text child. |
| `ComponentBlock(IComponentDefinition, VirtualNodeProperties?, ComponentSlots?, PatchFlags, string[]?)` | Closes the open block onto a component vnode. |
| `FragmentBlock(VirtualNode?[]?, object? key = null, PatchFlags = default)` | Closes the open block onto a fragment. |

A vnode is collected into the enclosing block when it carries a **positive** patch flag or is a
component; a vnode whose only flag is `PatchFlags.NeedHydration` is not collected.

### Utilities

| Member | Behavior |
| --- | --- |
| `Properties(params (string Name, object? Value)[] entries)` | Builds a `VirtualNodeProperties` from tuples. Upstream's object literal has no C# spelling. |
| `IsVirtualNode(object? value)` | The port of `isVNode`. |
| `Clone(VirtualNode node, VirtualNodeProperties? extraProperties = null)` | The port of `cloneVNode`; extra props are merged over the original. |
| `MergeProperties(params VirtualNodeProperties?[] sources)` | The port of [`mergeProps`](https://vuejs.org/api/render-function.html#mergeprops). |
| `Normalize(VirtualNode? node)` | Returns a comment vnode for `null`; clones a node that already has an `El`. |
| `IsEventListenerName(string name)` | The port of `@vue/shared`'s `isOn`: `on` followed by an upper-case letter. |

`MergeProperties` merge rules, in order of specificity:

- **`class`** — string values concatenate space-separated.
- **`style`** — string values join with `";"`; dictionary values merge later-wins.
- **`onX` handlers** — chained with `Delegate.Combine`, so both run. Chaining applies only when both
  values are delegates and are not the same instance; otherwise the later source wins.
- **Everything else** — later source wins.

Class and style values beyond plain strings and dictionaries fall through to later-wins here. The
full normalization lives in `RenderHelpers._normalizeClass` / `_normalizeStyle`.

## `VirtualNode`

One sealed class models every node kind. The `Type` discriminant lets the patch dispatcher branch
without type tests, and `ShapeFlag` carries the finer-grained bits.

```csharp
public sealed class VirtualNode
{
    public VirtualNodeType Type { get; }
    public string? ElementTag { get; }
    public object? ComponentType { get; }
    public VirtualNodeProperties? Properties { get; }
    public object? Key { get; }
    public TemplateReference? Reference { get; }
    public string? TextChildren { get; }
    public VirtualNode[]? ArrayChildren { get; }
    public ComponentSlots? SlotChildren { get; }
    public ShapeFlags ShapeFlag { get; }
    public PatchFlags PatchFlag { get; }
    public string[]? DynamicProperties { get; }
    public IReadOnlyList<VirtualNode>? DynamicChildren { get; }
    public object? El { get; }
    public object? Anchor { get; }
    public object? Component { get; }
}
```

Every setter above is `internal` — the shape shown is the consumer's view. Vnodes are created only
through `VirtualNodeFactory` (or `RenderHelpers`) and mutated only by the renderer. A few internal
members are omitted here because they are not part of the public surface.

- **`El`, `Anchor`, `Component`** — renderer-owned back-pointers written at mount. `El` is `object?`
  because `VirtualNode` is not generic over `TNode`; on the browser the boxed value is an `int`
  interop handle, not a DOM object.
- **`Key` and `Reference`** — extracted from the `"key"` and `"ref"` props at creation. They
  **remain in the prop bag**, but the renderer never patches them to the platform.
- **`DynamicChildren`** — populated only on block roots.

### `VirtualNodeType`

| Value | Created by |
| --- | --- |
| `Element` | `Element`, `ElementBlock` |
| `Component` | `Component`, `ComponentBlock`, `DynamicComponents.DynamicComponent` |
| `Text` | `Text` |
| `Comment` | `Comment`, `Normalize(null)`, a null array child |
| `Static` | `Static` |
| `Fragment` | `Fragment`, `FragmentBlock`, `RenderSlot` |

### Reserved prop names

The renderer never patches these to the platform:

- **`"key"`** — extracted onto `VirtualNode.Key`.
- **`"ref"`** — extracted onto `VirtualNode.Reference`. It must be an `IReference<object?>` or an
  `Action<object?>`; anything else warns and is treated as no ref. String template refs are
  intentionally not ported.
- **Anything starting with `"onVnode"`** — the six `VirtualNodeHook` prop names
  (`onVnodeBeforeMount`, `onVnodeMounted`, `onVnodeBeforeUpdate`, `onVnodeUpdated`,
  `onVnodeBeforeUnmount`, `onVnodeUnmounted`).

## `VirtualNodeProperties`

The prop bag. It is array-backed with an ordinal linear scan up to 16 entries and migrates to a
`Dictionary<string, object?>` beyond that, so small bags — the overwhelming majority — allocate two
small arrays and never hash.

```csharp
var properties = new VirtualNodeProperties(capacity: 3);
properties.Set("id", "row-1");
properties.Set("class", "active");
properties.Set("onClick", (Action)Handle);

if (properties.TryGetValue("id", out var id)) { /* … */ }

var missing = properties["nope"];        // null — the indexer never throws
var present = properties.ContainsName("class");

foreach (var (name, value) in properties) { /* allocation-free struct enumerator */ }
```

- **`Count`** — entry count.
- **`this[string name]`** — returns `null` for an absent name rather than throwing.
- **`Set(string name, object? value)`** — adds or overwrites.
- **`TryGetValue(string name, out object? value)`** — distinguishes an absent name from a stored
  `null`, which the indexer cannot.
- **`ContainsName(string name)`** — presence test.
- **`GetEnumerator()`** — returns a `struct Enumerator` yielding
  `KeyValuePair<string, object?>`. Array-backed bags enumerate in insertion order.
- **`VirtualNodeProperties(int capacity)`** — pre-sizes the bag. The compiler always knows its prop
  count and uses this; hand-written code can too.

## `PatchFlags`

`PatchFlags` lives in `Assimalign.Viu.Shared` and carries the compiler's hints about what can change
on a node. It is bit-for-bit parity with `@vue/shared`.

| Flag | Value | Meaning |
| --- | --- | --- |
| `Text` | `1` | Text children are dynamic. |
| `Class` | `2` | The `class` binding is dynamic. |
| `Style` | `4` | The `style` binding is dynamic. |
| `Props` | `8` | The names in `DynamicProperties` are dynamic. |
| `FullProps` | `16` | Props contain dynamic keys; a full diff is required. |
| `NeedHydration` | `32` | Upstream's "requires hydration attention" bit, carried for parity. **There is no hydration in Viu**, so its only live effect is excluding the node from block collection. |
| `StableFragment` | `64` | Fragment children order never changes. |
| `KeyedFragment` | `128` | Fragment children are keyed. |
| `UnkeyedFragment` | `256` | Fragment children are unkeyed. |
| `NeedPatch` | `512` | Non-prop patch work only (a `ref` or a directive hook). |
| `DynamicSlots` | `1024` | Slots are dynamic; forces a child update regardless of `SlotFlags`. |
| `DevRootFragment` | `2048` | Dev-only root fragment marker. |
| `Cached` | `-1` | The node is cached (`v-once`). |
| `Bail` | `-2` | Opt out of optimized patching entirely. |

**The two negative values are sentinels, not bit fields.** Every flag test in the runtime is guarded
by `(int)patchFlag > 0` before any bit check, precisely so `Cached` and `Bail` — whose two's
complement representations have every bit set — never match. Never describe a flag bit as testable
on a `Bail` or `Cached` node; `Bail` forces both the full unoptimized diff and the full unoptimized
unmount walk.

## `ShapeFlags`

`ShapeFlags`, also from `Assimalign.Viu.Shared`, describes the node's structural shape.

| Flag | Value | Set by RuntimeCore |
| --- | --- | --- |
| `Element` | `1` | Yes |
| `FunctionalComponent` | `2` | No — functional components do not exist |
| `StatefulComponent` | `4` | Yes — always, for every component vnode |
| `TextChildren` | `8` | Yes |
| `ArrayChildren` | `16` | Yes |
| `SlotsChildren` | `32` | Yes |
| `Teleport` | `64` | No |
| `Suspense` | `128` | No |
| `ComponentShouldKeepAlive` | `256` | No |
| `ComponentKeptAlive` | `512` | No |
| `Component` | `6` | Composite of `StatefulComponent \| FunctionalComponent` |

`ShapeFlagsExtensions` supplies allocation-free predicates: `Has`, `IsElement`,
`IsFunctionalComponent`, `IsStatefulComponent`, `IsComponent`, `HasTextChildren`,
`HasArrayChildren`, `HasSlotsChildren`, `IsTeleport`, `IsSuspense`, `ShouldKeepAlive`, `IsKeptAlive`.

The last four predicates compile and run, but nothing in the renderer ever sets the bits they test,
so they always return `false`. See [KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md).

## `RenderHelpers` — the compiler-facing contract

`RenderHelpers` is the by-name helper surface that **generated** render bodies bind to through a
file-level static import. A DOM-targeted component emits a second one for the browser-only half:

```csharp
using static global::Assimalign.Viu.RuntimeCore.RenderHelpers;
using static global::Assimalign.Viu.RuntimeDom.DomRenderHelpers;
```

The `_`-prefixed lowercase names are not a style lapse — they **are** the upstream `helperNameMap`
contract, and the compiler emits calls to them by name without ever referencing the runtime
assembly. This is the one documented, deliberate exception to the repo's whole-word naming rule, and
it exists for generated code only. Application code should call `VirtualNodeFactory`,
`DependencyInjection`, `Directives`, and the rest of the whole-word API instead.

Documented here so you can read the generated output — for example, from a `.viu` template
`<div :id="dynamicId" class="static">{{ message }}</div>`:

```csharp
return _createElementBlock(_openBlock(), "div", _createProps(
    ("id", _ctx.dynamicId),
    ("class", "static")
), _toDisplayString(_ctx.message), 9 /* TEXT, PROPS */, ["id"]);
```

### Node construction

| Helper | Maps to |
| --- | --- |
| `_openBlock(bool disableTracking = false)` | `VirtualNodeFactory.OpenBlock` |
| `_setBlockTracking(int value, bool inVOnce = false)` | `VirtualNodeFactory.SetBlockTracking` |
| `_createElementBlock(BlockToken, object? tag, object? properties, object? children, int patchFlag, string[]? dynamicProperties)` | `ElementBlock` / `FragmentBlock` |
| `_createBlock(BlockToken, object? tag, …)` | `ComponentBlock` |
| `_createElementVNode(object? tag, …)` | `Element` |
| `_createVNode(object? tag, …)` | `Component` |
| `_createTextVNode(object? text = null, int patchFlag = 0)` | `Text` |
| `_createCommentVNode(string? text = "", bool asBlock = false)` | `Comment` |
| `_createStaticVNode(string content, int count)` | `Static` |

### Rendering and resolution

| Helper | Purpose |
| --- | --- |
| `_toDisplayString(object? value)` | Interpolation formatting. |
| `_renderList<T>(IEnumerable<T>?, Func<T, VirtualNode?>)` | `v-for` over a sequence. |
| `_renderList<T>(IEnumerable<T>?, Func<T, int, VirtualNode?>)` | …with index. |
| `_renderList(int count, Func<int, VirtualNode?>)` | `v-for` over a count. |
| `_renderList(int count, Func<int, int, VirtualNode?>)` | …with index. |
| `_renderList<TKey, TValue>(IEnumerable<KeyValuePair<TKey, TValue>>?, Func<TValue, TKey, int, VirtualNode?>)` | `v-for` over key/value pairs. |
| `_renderSlot(ComponentSlots?, string name, object? properties = null, Func<object?[]?>? fallback = null)` | Slot outlet. Note the fallback delegate returns `object?[]?`, unlike `VirtualNodeFactory.RenderSlot`, which returns `VirtualNode?[]?`. |
| `_withCtx(Func<object?[]?>)` / `_withCtx(Func<object?, object?[]?>)` | Wraps a slot body as a `Slot`. |
| `_resolveComponent(string name)` | Registry lookup; **warns** on a miss. |
| `_resolveDirective(string name)` | Registry lookup. |
| `_resolveDynamicComponent(object? value)` | `<component :is>`; deliberately does **not** warn on a miss, because an unresolved string is a legitimate element tag. |
| `_withDirectives(VirtualNode, object?[] directives)` | `Directives.WithDirectives`. |

### Value normalization

| Helper | Purpose |
| --- | --- |
| `_mergeProps(params object?[] sources)` | `v-bind="obj"` spread merge. |
| `_normalizeClass(object? value)` | Strings and dictionaries → a class string. |
| `_normalizeStyle(object? value)` | Strings and dictionaries → a style value. |
| `_normalizeProps(object? properties)` | Normalizes `class`/`style` inside a prop bag. |
| `_guardReactiveProps(object? properties)` | Upstream's reactive-props guard. |
| `_toHandlers(object? value)` | Converts an event map into `onX` props. |
| `_camelize`, `_capitalize`, `_toHandlerKey` | Name transforms. |
| `_unref(object? value)`, `_isRef(object? value)` | Maybe-ref unwrapping in templates. |
| `NormalizeRoot(object? renderResult)` | Coerces a render result (which may be a bare string) into a root vnode. |

### Viu-only helpers with no upstream counterpart

These five exist because C# lacks a JavaScript construct the upstream codegen relies on.

- **`_createProps(params (string Name, object? Value)[] entries)`** — a JavaScript object literal has
  no C# spelling, so props emit as a tuple list.
- **`_withHandler(...)`** — gives a lambda or method group a delegate target type in an
  `object?`-typed prop position. Overloads accept `Func<object?, object?>`, `Action<object?>`,
  `Action`, `Func<object?>`, and `Delegate`. Note that `_withModifiers` and `_withKeys` are **not**
  wrapped in `_withHandler` — their own overload sets already type the inner lambda.
- **`_setCache(int index, BlockToken tracking, object? value)`** — reproduces the `v-once` comma
  sequence. **The `index` parameter is a documented no-op**, accepted only for upstream parity:
  `VirtualNode` has no `cacheIndex`, and `v-once` reuse works purely through the generated `_cache`
  slot.
- **`_spreadCache(object? value)`** — clones a cached array so a reused block gets a fresh children
  array; C# has no `[...expr]` spread. Non-array values pass through unchanged.
- **`NormalizeRoot(object? renderResult)`** — listed above; a template whose root is bare text emits
  `return "hello";`, which this coerces.

### `BlockToken` and evaluation order

Upstream emits its block roots as a comma expression:

```js
(openBlock(), createElementBlock("div", null, "hi"))
```

C# has no comma operator. Viu reproduces the sequencing by threading an opaque `BlockToken` as the
**first argument** of `_createElementBlock` / `_createBlock`, relying on C#'s guaranteed
left-to-right argument evaluation:

```csharp
return _createElementBlock(_openBlock(), "div", null, "hi");
```

`_openBlock()` is evaluated before the remaining arguments purely because it is the first argument.
`BlockToken` is a public `readonly struct` with **no public members** and an internal constructor —
it is an opaque contract handle, not a payload. Its value is meaningless to everything except
`_setCache`.

### Built-in markers

`RenderHelpers` exposes five `object` fields used as vnode tags:

| Field | State |
| --- | --- |
| `_Fragment` | Realized. Renders as a fragment. |
| `_BaseTransition` | Realized — resolves to the real `BaseTransition.Instance` component. |
| `_Teleport` | Marker only. |
| `_Suspense` | Marker only. |
| `_KeepAlive` | Marker only. |

> **Status:** Not yet implemented — `_Teleport`, `_Suspense`, and `_KeepAlive`.

Passing any of the three markers as a vnode tag throws
`NotSupportedException("The built-in component <Teleport> is not yet supported by the runtime renderer.")`
(with the matching name for each). See
[KeepAlive, Teleport & Suspense](../guide/built-ins/deferred-built-ins.md).

### DOM helpers live elsewhere

`RenderHelpers` deliberately excludes every DOM-only helper, because `Assimalign.Viu.RuntimeCore` is
platform-agnostic and must not reference the browser layer. These live on `DomRenderHelpers` in
`Assimalign.Viu.RuntimeDom`:

- **Directive markers** — `_vShow`, `_vModelText`, `_vModelCheckbox`, `_vModelRadio`,
  `_vModelSelect`, `_vModelDynamic`.
- **Handler wrappers** — `_withModifiers(handler, params string[] modifiers)` and
  `_withKeys(handler, params string[] keys)`, each with four overloads over
  `Func<BrowserEvent, object?>`, `Action<BrowserEvent>`, `Func<object?>`, and `Action`.
- **Transition tags** — `_Transition` and `_TransitionGroup`, typed `object` rather than
  `IComponentDefinition` because they are passed as vnode tags and resolved by the factory's
  component arm.

See [Built-in Directives](built-in-directives.md) and
[Transition & TransitionGroup](../guide/built-ins/transition.md).

## Behavior notes

Two normalization behaviors surprise people reading a rendered tree.

- **A null array child becomes a comment placeholder, not a skipped entry.** Children arrays keep
  their length, so `Element("div", a, null, b)` mounts three nodes: `a`, a comment, and `b`. This is
  what keeps unkeyed positional diffing stable. `Normalize(null)` returns a comment vnode for the
  same reason.
- **Mounting an already-mounted vnode clones it.** `Normalize` returns the node unchanged when
  `El is null`, and returns `Clone(node)` otherwise, so the original's `El` back-pointer is never
  corrupted. Reusing a single vnode instance across two containers is safe only because of this.

A third note belongs with any hand-written render code: `Renderer<TNode>.Render` always drains the
pre- and post-flush scheduler queues before returning, so lifecycle hooks, directive hooks, and
template refs are observable immediately after a direct `Render` call. Reactive updates, by
contrast, wait for a flush — `Scheduler.NextTick()` is what awaits one, and it returns
`Task.CompletedTask` when nothing is queued.

## `RendererOptions<TNode>` and the optional ops

A renderer is built over injected platform node operations. Ten are required — `Insert`, `Remove`,
`CreateElement`, `CreateText`, `CreateComment`, `SetText`, `SetElementText`, `ParentNode`,
`NextSibling`, and `PatchProperty` — and four are optional. Of the optional four, only one is
actually consumed today:

| Optional op | State |
| --- | --- |
| `InsertStaticContent` | **Consumed.** Required to mount a `Static` vnode; without it the renderer throws `NotSupportedException`. |
| `QuerySelector` | Declared, never invoked by the current renderer. |
| `CloneNode` | Declared, never invoked by the current renderer. |

`PatchPropertyDelegate<TNode>` diverges from upstream by passing `elementTag` explicitly, because
upstream reads `el.tagName` inside `patchProp` — a round trip Viu cannot afford on a handle-based
interop boundary.

For a value-type `TNode` such as the browser's `int` handle, `default(TNode)` means "no node", so
the platform must never issue `default` as a real node. Browser handles are positive `int`s with `0`
reserved as the no-node sentinel.

## See also

- [Component API](component.md) — `IComponentDefinition`, `ComponentInstance`, and the setup contract.
- [Application API](application.md) — `RendererFactory`, `Application<TNode>`, and mounting.
- [Components](../guide/essentials/components.md) — the component model in prose.
- [Template Syntax](../guide/essentials/template-syntax.md) — what the compiler turns into these calls.
- [Slots](../guide/components/slots.md) — `ComponentSlots`, `Slot`, and slot stability.
- [Single-File Components (.viu)](../guide/scaling-up/single-file-components.md) — the generated
  partial class that carries a compiled render body.
- [Performance](../guide/best-practices/performance.md) — block trees and patch flags in practice.
- [Differences from Vue 3](../roadmap/vue-differences.md) — the naming map.
- [Project Status](../roadmap/status.md) — what is built, partial, and absent.
