# Differences from Vue 3

The complete naming map plus every intentional behavioral divergence, for developers arriving from
Vue 3.

> **Status:** Partial. Every divergence below describes shipped behavior; features that simply do
> not exist yet are catalogued separately in [Project status](status.md).

This page is about **intentional divergence** — places where Viu deliberately does something other
than what [Vue 3](https://vuejs.org) does, and why. It is not the missing-features list. Router,
Store, SSR/hydration, and DevTools **do not exist on disk in any form**, and `Teleport`,
`KeepAlive`, and `Suspense` exist only as marker objects (`RenderHelpers._Teleport`,
`._KeepAlive`, `._Suspense`) that throw `NotSupportedException` when the renderer reaches them.
For what has and has not been built, read [Project status](status.md) instead.

Viu is a port, not an inspiration: the reactivity engine, virtual-node model, renderer, scheduler,
component model, and template compiler are translated from `vuejs/core` function by function, with
upstream semantics treated as the specification. Where this page says "divergence", it means a
deliberate decision recorded in the source — not a gap.

## Structural differences and their causes

Five constraints of the C#/WebAssembly target produce every large-scale difference. Everything else
on this page follows from one of them.

- **C# has no `Proxy`** — Vue's [`reactive()`](https://vuejs.org/api/reactivity-core.html#reactive)
  wraps an object in a proxy that intercepts every property read and write. C# has no equivalent, so
  Viu is **Ref-first**: `Reactive.Reference<T>` is the primary state container, object reactivity
  comes from the `[Reactive]` attribute plus a Roslyn source generator that compiles per-property
  tracking into the class, and Vue's proxied `Array`/`Map`/`Set` become the dedicated
  `ReactiveList<T>`, `ReactiveDictionary<TKey, TValue>`, and `ReactiveSet<T>` types.
- **WebAssembly has no `new Function`** — Vue's full build compiles templates in the browser at
  runtime. Viu forbids dynamic code generation entirely (it is an AOT/trimming target), so **there
  is no runtime template compilation**. Templates compile at build time inside a source generator or
  they do not compile at all.
- **There is no `this`-proxy** — Vue's `setup()` returns a state object that the framework wraps in
  a render-context proxy. Viu's `IComponentDefinition.Setup` runs exactly once per instance and
  **returns the render function**; the closure it returns *is* the proxy-free realization of Vue's
  state object. Consequently there is no Options API, no mixins, and no
  [`app.config.globalProperties`](https://vuejs.org/api/application.html#app-config-globalproperties).
- **`.viu` uses an @-block container** — a single-file component wraps its blocks in
  `@template { … }` / `@script { … }` / `@style scoped { … }` rather than HTML-like tags. Block
  *semantics* are unchanged from the [Vue SFC spec](https://vuejs.org/api/sfc-spec.html); only the
  container differs. This was an explicit design decision dated 2026-07-17.
- **Expression bodies are C#, not JavaScript** — markup syntax is Vue's verbatim, but everything
  inside `{{ }}`, `:prop="…"`, and `@click="…"` is parsed by Roslyn's
  `SyntaxFactory.ParseExpression` (multi-statement inline handlers go through
  `SyntaxFactory.ParseStatement`).

### Component authoring, side by side

Vue's Composition API with `<script setup>`:

```js
// Counter.vue
import { ref, computed } from 'vue'
const count = ref(0)
const doubled = computed(() => count.value * 2)
function increment() { count.value++ }
```

The same component in Viu, hand-written against the runtime API:

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
        // Setup runs exactly once per instance.
        var count = Reactive.Reference(0);
        var doubled = Reactive.Computed(() => count.Value * 2);

        void Increment() => count.Value++;

        // The returned closure is the render function; it re-executes on every update.
        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Element("p", $"{count.Value} doubled is {doubled.Value}"),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", (Action)Increment)),
                "increment"));
    }
}
```

And as a `.viu` single-file component. The generator derives the class name from the file name, so
this is `Counter.viu`; it emits `internal static object? Render(Counter _ctx, object?[] _cache)`
into a `partial class Counter` and merges the `@script` body verbatim into that same partial:

```viu
@template {
    <div>
        <p>{{ Count }} doubled is {{ Doubled }}</p>
        <button @click="Increment()">increment</button>
    </div>
}

@script {
    using Assimalign.Viu.Reactivity;

    public readonly Reference<int> Count = Reactive.Reference(0);
    public readonly Computed<int> Doubled;

    public Counter() => Doubled = Reactive.Computed(() => Count.Value * 2);

    public void Increment() => Count.Value++;
}

@style scoped {
    button { font-weight: 600; }
}
```

The `using` is not optional: the generator's own preamble emits only
`using static Assimalign.Viu.RuntimeCore.RenderHelpers;` and
`using static Assimalign.Viu.RuntimeDom.DomRenderHelpers;`, and `Assimalign.Viu.Reactivity` is not
a global using. Leading `using` directives in `@script` are hoisted above the generated namespace;
everything after them is merged into the class body.

Two things to notice. First, the template writes `{{ Count }}`, not `{{ Count.Value }}` — a
`@script` member whose type is `Reference<T>`, `ShallowReference<T>`, `CustomReference<T>`,
`IReference<T>`, or `Computed<T>` is classified as `BindingType.SetupReference`, and the compiler
inserts the `.Value` unwrap for you. Second, block bodies **must be indented**: column 0 is
structural in `.viu`, so a `}` at the start of a line closes the block regardless of what language
the content is written in. See
[Single-File Components](../guide/scaling-up/single-file-components.md).

## The naming map

Viu's public names are PascalCase, whole-word renames of Vue's camelCase. Abbreviations are expanded
everywhere: `Ref` becomes `Reference`, `Dep` becomes `Dependency`, `props` becomes `Properties`,
`attrs` becomes `Attributes`. The sole documented exception is `RenderHelpers` and
`DomRenderHelpers`, whose `_`-prefixed lowercase members (`_openBlock`, `_createElementBlock`,
`_toDisplayString`, `_vModelText`) keep upstream's spelling because those names *are* the
`helperNameMap` contract that generated render code binds to by name.

### Reactivity

| Vue 3 | Viu | Notes |
| --- | --- | --- |
| [`ref()`](https://vuejs.org/api/reactivity-core.html#ref) | `Reactive.Reference<T>(value)` → `Reference<T>` | There is no type named `Ref` |
| `shallowRef()` | `Reactive.ShallowReference<T>(value)` → `ShallowReference<T>` | |
| `customRef()` | `Reactive.CustomReference<T>(factory)` → `CustomReference<T>` | Factory is `CustomReferenceFactory<T>` |
| `computed()` | `Reactive.Computed<T>(getter, setter?)` → `Computed<T>` | `IsWritable` reports whether a setter was given |
| `.value` | `.Value` | Capital `V`, both read and write |
| `reactive(obj)` | `[Reactive]` on a `partial class` | Compile-time only; no runtime function |
| `shallowReactive(obj)` | `[ShallowReactive]` | Compile-time only |
| `readonly(obj)` | `[Reactive(Readonly = true)]` | Compile-time only |
| reactive `Array` / `Map` / `Set` | `ReactiveList<T>` / `ReactiveDictionary<TKey, TValue>` / `ReactiveSet<T>` | Dedicated types, not proxies |
| `effect()` | `Reactive.Effect(action, scheduler?)` → `ReactiveEffect` | |
| `effectScope()` | `Reactive.EffectScope(detached)` → `EffectScope` | |
| `getCurrentScope()` | `Reactive.CurrentScope` | A **property**, not a method |
| `onScopeDispose()` | `Reactive.OnScopeDispose(callback, failSilently)` | `failSilently` is a Viu addition |
| `triggerRef()` | `Reactive.TriggerReference(reference)` | |
| `pauseTracking()` / `resetTracking()` | `Reactive.PauseTracking()` / `Reactive.ResetTracking()` | |
| `isRef()` / `isReactive()` / `isReadonly()` | `Reactive.IsRef(object?)` / `IsReactive(object?)` / `IsReadonly(object?)` | Interface checks (`IReference`, `IReactiveTraversable`, `IReadonlyReactive`), no reflection |
| `unref()` | `Reactive.Unref` | Six overloads; see the gotcha below |
| `toRef(getter, setter)` | `Reactive.ToRef<T>(Func<T>, Action<T>?)` → `IReference<T>` | Delegate form only |
| `toRefs(obj)` | generated `obj.ToReferences()` | Returns a nested `readonly struct ReactiveReferences` |
| `toRaw()` | `Reactive.ToRaw<T>(T)` | Semantics differ — see below |
| `markRaw()` | `Reactive.MarkRaw<T>(T) where T : class` | Permanent; there is no unmark |
| `watch()` / `watchEffect()` | `Reactive.Watch` / `Reactive.WatchEffect` | Use `ViuWatch` inside a component |
| `flush: 'sync' \| 'pre' \| 'post'` | `WatchFlushMode.Sync` / `.Pre` / `.Post` | |
| `deep: number` | `WatchOptions.DeepDepth` (an `int?`) | Alongside the boolean `WatchOptions.Deep` |
| `Dep` | `Dependency` | `Track()` / `Trigger()` are public |
| `Sub` | `Subscriber` | Public abstract, effectively opaque |
| `traverse()` | `new ReactiveTraversal(depth).Visit(value)` | An instance method, not a static — the depth ceiling is a constructor argument |

### Runtime

| Vue 3 | Viu | Notes |
| --- | --- | --- |
| `setup(props, ctx)` | `IComponentDefinition.Setup(ComponentProperties, ComponentSetupContext)` | Returns `Func<VirtualNode?>` |
| `props` | `Properties` / `ComponentProperties` | |
| `attrs` | `Attributes` / `ComponentAttributes` | Not `Attrs` |
| `slots` | `Slots` / `ComponentSlots` | |
| `emit` / `expose` | `ComponentSetupContext.Emit` / `.Expose` | |
| `vnode` | `VirtualNode` | |
| `subTree` | `ComponentInstance.Subtree` | |
| [`h()`](https://vuejs.org/api/render-function.html#h) | `VirtualNodeFactory.Element` / `.Component` / `.Text` / `.Comment` / `.Static` / `.Fragment` | There is no short `h` alias |
| `createRenderer()` | `RendererFactory.CreateRenderer<TNode>(options)` | |
| `createApp()` | `BrowserRuntime.CreateApp(root)` → `BrowserApplication` | |
| `app.use/component/directive/provide/mount` | `Use` / `Component` / `Directive` / `Provide` / `Mount` | The registration methods are fluent and return the application; `Mount` returns `ComponentInstance?` and `Unmount` returns `void` |
| `provide()` / `inject()` | `DependencyInjection.Provide<T>` / `Inject<T>` | |
| `InjectionKey<T>` (a `Symbol`) | `InjectionKey<T>` (a **class**) | Reference identity, deliberately not a record |
| `onMounted()`, `onUnmounted()`, … | `Lifecycle.OnMounted`, `Lifecycle.OnUnmounted`, … | |
| `nextTick()` | `Scheduler.NextTick()` | Returns `Task.CompletedTask` when nothing is queued |
| `getCurrentInstance()` | `ComponentInstance.Current` | A property |
| `PatchFlags` / `ShapeFlags` / `SlotFlags` | Same names, in `Assimalign.Viu.Shared` | |

### Compiler

| Vue 3 | Viu |
| --- | --- |
| `baseParse()` | `TemplateParser.Parse` |
| `transform()` | `Transformer.Transform` |
| `generate()` | `RenderFunctionEmitter.Emit` |
| `NodeTypes` | `NodeType` |
| `ElementTypes` | `ElementType` |
| `Namespaces` | `ElementNamespace` |
| `ConstantTypes` | `ConstantType` |
| `BindingTypes` | `BindingType` |
| `ElementNode.props` | `ElementNode.Properties` |
| `objectIndexAlias` | `ForNode.ObjectIndexAlias` |
| `X_V_IF_NO_EXPRESSION` | `CompilerErrorCode.XVIfNoExpression` |

Note that `ElementNode.Properties` is a `SyntaxList<PropertyNode>` holding attributes **and**
directives in source order — there is no separate attribute collection. `AttributeNode` and
`DirectiveNode` are the two records deriving from the abstract `PropertyNode`, so filter with
`is AttributeNode` / `is DirectiveNode`.

## Behavioral divergences

These are the ones that will bite a Vue developer who assumes upstream semantics. Each is stated as
Vue's behavior followed by Viu's.

### Watchers default to synchronous flush in the reactivity layer

**Vue:** `watch()` defaults to `flush: 'pre'`.
**Viu:** `WatchOptions.Flush` defaults to `WatchFlushMode.Sync`, and `Pre`/`Post` require a
`WatchOptions.Scheduler` — without one they silently fall back to synchronous delivery. No
`IWatchScheduler` implementation ships in `Assimalign.Viu.Reactivity` at all.

Inside a component, use `ViuWatch` from `Assimalign.Viu.RuntimeCore`, which injects the
`RuntimeWatchScheduler` and restores Vue's pre-flush default:

```csharp
using System.Diagnostics;
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

var count = Reactive.Reference(0);
WatchCallback<int> handler = (value, oldValue, onCleanup) => Debug.WriteLine(value);

// Pre-flush, exactly like Vue's default — the scheduler is injected for you.
ViuWatch.Watch(count, (value, oldValue, onCleanup) => Debug.WriteLine(value));

// TRAP: passing any WatchOptions instance re-exposes the Sync default, because
// WatchOptions.Flush initializes to WatchFlushMode.Sync. This watcher fires synchronously.
ViuWatch.Watch(count, handler, new WatchOptions { Deep = true });

// Be explicit whenever you construct options yourself.
ViuWatch.Watch(count, handler, new WatchOptions { Deep = true, Flush = WatchFlushMode.Pre });
```

`ViuWatch` only injects a scheduler when the options you pass ask for a non-`Sync` flush. See
[Watchers](../guide/essentials/watchers.md).

### Change detection uses `EqualityComparer<T>.Default`, not `Object.is`

**Vue:** compares with `Object.is`, so `+0` and `-0` are *different* values and a write of `-0` over
`+0` triggers.
**Viu:** compares with `EqualityComparer<T>.Default`. Like `Object.is`, `NaN` is self-equal, so
writing `double.NaN` over `double.NaN` does not trigger. Unlike `Object.is`, `+0.0` and `-0.0`
compare **equal**, so that write does not trigger either. There is no way to inject a custom
`IEqualityComparer<T>` into `Reference<T>`, `ShallowReference<T>`, `Computed<T>`, or a generated
property setter.

### There is no identity-swapping proxy

**Vue:** `reactive(obj)` returns a *different* object — the proxy — and `toRaw(proxy)` hands back the
untracked target. Reads through the raw target do not track.
**Viu:** a `[Reactive]` instance **is** the reactive object. `Reactive.ToRaw(obj)` returns the same
instance, and reads through it still track. The only genuinely untracked view of a generated object
is its emitted `ToRawValues()`.

```csharp
using Assimalign.Viu.Reactivity;

[Reactive]
public partial class Person
{
    public partial string Name { get; set; }
}

var person = new Person { Name = "Ada" };

Reactive.ToRaw(person);      // the SAME instance — reads through it still track
person.ToRawValues().Name;   // the untracked read you actually wanted
```

Reactive **collections** behave the upstream way: `Reactive.ToRaw(list)` does return the untracked
underlying `List<T>` / `Dictionary<TKey, TValue>` / `HashSet<T>`.

### Deep traversal stops at plain CLR objects

**Vue:** a deep watch enumerates every own key of every reachable object at runtime.
**Viu:** traversal is reflection-free and descends **only** through `IReference` cells and
`IReactiveTraversable` values — that is, generated `[Reactive]` objects and the reactive collections.
Plain CLR objects are **leaves**. A deep watch will never observe a mutation inside an un-annotated
POCO. This is documented behavior, not a bug; annotate the type with `[Reactive]` if you need it
observed.

### Computeds are never owned by an `EffectScope`

This one matches Vue 3.5 upstream, but surprises anyone carrying a pre-3.5 mental model. A `Computed<T>`
created inside a scope keeps serving fresh values and stays fully reactive after `scope.Stop()`.
Cleanup is subscriber-count driven instead: losing the last subscriber soft-detaches the computed
from its sources, and the next tracked read re-attaches it. `EffectScope.Pause()`/`Resume()` cascade
to child scopes and contained effects but **never** to computeds.

### Three read-only shapes, two different failure modes

**Vue:** writing a read-only computed logs a dev warning and is a no-op.
**Viu:** the three read-only shapes do not behave uniformly, and documentation must not describe them
as if they did.

| Shape | Writing to it |
| --- | --- |
| `Reactive.Computed<T>(getter)` with no setter | **Throws** `NotSupportedException("Cannot write to a computed without a setter.")` |
| `Reactive.ToRef<T>(getter)` with no setter | Silent no-op with a `Debug.WriteLine` only |
| `[Reactive(Readonly = true)]` property setter | Warned no-op |

Note also that `ToRawValues()` is emitted even for a `Readonly = true` class (matching upstream,
where `toRaw(readonly(obj))` returns the mutable target), which makes it a write escape hatch around
read-only.

### Ref unwrapping inserts `.Value` in both read and write positions

**Vue:** the compiler emits a read-time `unref(x)` plus an `isRef(x) ? x.value = v : (x = v)`
assignment guard.
**Viu:** because `Reference<T>.Value` is a settable C# property, the compiler simply inserts `.Value`
on both sides — `_ctx.count.Value++`, `_ctx.count.Value = 5`. Maybe-ref reads still route through
`_unref(...)`.

Two related compiler divergences: every binding routes through `_ctx.` rather than Vue's
`$setup.`/`$props.`/`__props.` split; and `$`-prefixed Vue spellings are remapped to legal C#
identifiers behind the scenes (`$event` → `__event`, `$slots` → `_ctx.__slots`, `$style` → a
generated accessor class). You still *write* `$event` and `$style` in templates.

### Template expressions are C#

The template allow-list names .NET types — `Math`, `Convert`, `String`, `DateTime`, `DateOnly`,
`TimeSpan`, `Guid`, `Uri`, `Enumerable`, `Array`, `CultureInfo`, the numeric types,
`StringComparison`, `Nullable`, `DayOfWeek`. There is no `JSON`, `Date`, or `parseInt`, and no
template literals, spread, `undefined`, or `typeof`. LINQ works, `?.` works, `nameof` works:

```viu
@template {
    <p>{{ Items.Where(x => x.Active).Count() }} active</p>
    <p>{{ Math.Round(Total, 2) }}</p>
    <p>{{ DateTime.UtcNow.ToString("yyyy-MM-dd") }}</p>
}
```

### String template refs are not ported

**Vue:** `<div ref="myDiv">` and `this.$refs.myDiv`.
**Viu:** string template refs require a component instance proxy, so they are intentionally absent. A
`"ref"` prop must be an `IReference<object?>` or an `Action<object?>`; anything else produces a dev
warning and is treated as no ref. Use `TemplateReference.FromReference` or
`TemplateReference.FromFunction`.

### Template refs are applied post-flush, not synchronously

**Vue:** invokes a *function* ref synchronously inside `setRef`, mid-patch.
**Viu:** defers **both** ref kinds to the post-flush phase, so no template ref is ever applied
synchronously during a patch. Nulling on unmount **is** synchronous. A direct `Renderer.Render` call
drains the pre- and post-flush queues before returning, so refs are observable immediately after it;
reactive updates wait for a flush. See
[Lifecycle Hooks & Template Refs](../guide/essentials/lifecycle-and-template-refs.md).

### A component ref falls back to the `ComponentInstance`

**Vue:** an un-exposed component ref yields the public instance proxy.
**Viu:** with nothing exposed, the ref receives the `ComponentInstance` itself — the stand-in for
that proxy. Once `context.Expose(...)` is called, only the exposed object is surfaced.

### `patchProp` does not probe `key in el`

**Vue:** decides property-vs-attribute at runtime by testing `key in el` against the live element.
**Viu:** decides on the .NET side using three curated ordinal `HashSet`s, falling back to the
attribute path for unknown keys. A custom-element IDL property, or an uncommon HTML property Vue
would set as a property, lands as an **attribute** in Viu today. Related: style-map keys must be
kebab-case CSS names (`"font-size"`) or `--custom` — camelCase normalization does not exist, and a
`"fontSize"` key is passed straight to `style.setProperty` and silently does nothing.

### Enumerated attributes write the literal string `"false"`

`draggable`, `spellcheck`, and `translate` are never removed when false, because removal means
"inherit" — they are written as the string `"false"`. Every *other* boolean attribute is removed when
false and written as the empty string when true.

### `ResolveDynamicComponent` deliberately does not warn

**Vue:** `resolveDynamicComponent` calls `resolveAsset(..., warnMissing: false)` because an
unresolved name is legitimately treated as an element tag — `:is="'div'"` is a normal path.
**Viu:** the same. `DynamicComponents.ResolveDynamicComponent` does **not** warn on an unresolved
name, while `RenderHelpers._resolveComponent` **does**. The asymmetry is intentional; do not report
it as a bug.

A second resolution asymmetry: `Application<TNode>.Component(name)` and `Directive(name)` *getters*
are exact-name lookups, while the render-time resolver tries three spellings in order — the raw
name, its kebab-to-camelCase form, then that form with the first character upper-cased. Every
comparison is **ordinal**; there is no case-insensitive matching anywhere. So with a component
registered as `MyChild`, `app.Component("MyChild")` finds it, `app.Component("my-child")` returns
`null`, but a template referencing `my-child` resolves (`my-child` → `myChild` → `MyChild`). A
template referencing `mychild` does **not** resolve — it only ever reaches `Mychild`. See
[Dynamic Components & Registration](../guide/components/dynamic-components.md).

### `Reactive.Unref` binds by static type

`Reactive.Unref` has six overloads: `IReference<T>`, `Reference<T>`, `ShallowReference<T>`,
`CustomReference<T>`, `Computed<T>`, and the passthrough `Unref<T>(T value) => value`. Concrete ref
types bind to the ref overloads; anything else binds to the passthrough. A ref whose *static* type
is only `object` is opaque to overload resolution, so it binds to the passthrough and comes back
**not unwrapped — the ref object itself**. Call `Unref<T>(IReference<T>)` explicitly when the static
type is not a concrete reference.

## Deliberate omissions

These are not roadmap items. They are decisions.

- **Filters** — removed in Vue 3 upstream. Only the helper name `ResolveFilter` survives in the
  helper table for parity; nothing parses or emits a filter.
- **The Options API and mixins** — no `this`-proxy means no `data`/`methods`/`computed` options and
  no mixin merge strategy. Composition is the only model; factor shared logic into
  [composables](../guide/reusability/composables.md).
- **`app.config.globalProperties`** — excluded because it requires a `Proxy` under AOT. The
  sanctioned replacement is typed app-level `Provide` plus `Inject`; see
  [Provide / Inject](../guide/components/provide-inject.md).
- **String-key `toRef(obj, "key")` and standalone `toRefs(obj)`** — omitted for AOT and trimming
  safety, since both require reflecting over property names. Per-property write-through references
  come only from a generated object's `ToReferences()`.
- **Thread safety** — every piece of ambient state is plain `static` storage with no
  synchronization: `EffectScope.Current` and the tracking flags are static fields,
  `ComponentInstance.Current` is a static property over a static instance stack, and the scheduler
  queues are static lists. Viu targets the single-threaded JS event-loop model. This is a design
  decision stated as such, not a gap to be filled.
- **`onTrack` / `onTrigger` debug hooks** — Vue's dev-only debugger callbacks do not exist on
  `ReactiveEffect`, `Computed<T>`, or `WatchOptions`. Neither do `onRenderTracked` /
  `onRenderTriggered`.
- **An `h()` alias** — `VirtualNodeFactory` exposes explicit `Element`/`Component`/`Text`/`Comment`/
  `Static`/`Fragment` overloads instead, because whole-word naming is a repo-wide rule and overload
  resolution replaces JavaScript's argument-shape sniffing.

## Where to go next

- [Project status](status.md) — what is implemented, partial, marker-only, and absent.
- [Introduction](../guide/introduction.md) — the architecture these divergences come from.
- [Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md) — refs and the
  `[Reactive]` generator in full.
- [Components](../guide/essentials/components.md) — the `Setup`-returns-render contract.
- [Template Syntax](../guide/essentials/template-syntax.md) — C# expressions inside Vue markup.
- [AOT & Trimming](../guide/best-practices/aot-and-trimming.md) — the constraint behind most of this
  page.
