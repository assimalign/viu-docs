# Transition & TransitionGroup

The two built-in components Viu actually ships — enter/leave animation for a single child, and
FLIP-based list animation for a keyed collection.

> **Status:** Implemented. See [Project status](../../roadmap/status.md) for the built-ins that are
> not, and [Current limits](#current-limits) below for the edges of this one.

Viu's `Transition` and `TransitionGroup` are line-by-line ports of Vue's
[`<Transition>`](https://vuejs.org/guide/built-ins/transition.html) and
[`<TransitionGroup>`](https://vuejs.org/guide/built-ins/transition-group.html). The class
choreography, the modes, the FLIP move, and the hook names are all the upstream contract. What
differs is spelled out in [JavaScript hooks](#javascript-hooks) and [Current limits](#current-limits)
— everything else behaves the way the Vue documentation describes.

## The two layers

Vue splits transitions across `runtime-core` and `runtime-dom`, and Viu keeps that split exactly.

| Type | Assembly | Role |
| --- | --- | --- |
| `BaseTransition` | `Assimalign.Viu.RuntimeCore` | The platform-agnostic state machine — modes, appear, leave deferral, cancellation. Knows nothing about CSS. |
| `Transition` | `Assimalign.Viu.RuntimeDom` | Resolves CSS-class enter/leave hooks from its props, then renders `BaseTransition` with them. |
| `TransitionGroup` | `Assimalign.Viu.RuntimeDom` | Stamps the same resolved hooks onto every keyed child of a list, plus the FLIP move. |

Three rules apply to all three, and they are the ones a reader trips on first:

- **Every one has a private constructor** — you use the `Instance` singleton: `BaseTransition.Instance`,
  `Transition.Instance`, `TransitionGroup.Instance`. There is no `new Transition()`.
- **`InheritAttributes` is `false` on all three** — a transition owns no element of its own, so
  undeclared attributes never fall through onto the child. See
  [Props & Fallthrough Attributes](../components/props.md).
- **`BaseTransition` with no property bag at all renders its child completely untouched** — no hooks,
  no deferral, no warning. The pass-through is triggered by the component vnode's `Properties` being
  `null`, and nothing weaker: a bag that is merely *empty*, or that carries none of the recognized
  names, still builds a `BaseTransitionProperties` with every hook null, and the state machine runs
  (as a no-op) around the child.

## `<Transition>` in a template

`<Transition>` is recognized as a built-in component tag by the DOM parser and transform options
(`ParserOptions.CreateDom()` and `TransformOptions.CreateDom()` in `Assimalign.Viu.Syntax.Templates`,
which match `Transition`/`transition` and `TransitionGroup`/`transition-group`), so it needs no
registration. Wrap a single element or component whose presence is controlled by `v-if`, `v-else`, or
a dynamic `:is`.

> **`.viu` components do not mount yet.** The generator emits a `partial class` with a `static Render`
> method, but **no runtime adapter turns that class into an `IComponentDefinition`** — see
> [Single-File Components — Not yet implemented](../scaling-up/single-file-components.md#not-yet-implemented).
> Every `.viu` snippet on this page shows the template shape the compiler accepts today; the working
> path for actually mounting a transition is
> [hand-written C#](#using-transition-from-hand-written-c) below.

```viu
@template {
    <section>
        <button @click="Show = !Show">Toggle</button>

        <Transition name="fade">
            <p v-if="Show" key="panel">Now you see me.</p>
        </Transition>
    </section>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<bool> Show = Reactive.Reference(false);
}

@style scoped {
    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.3s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }
}
```

Two `.viu` rules are load-bearing in that snippet and are easy to get wrong here specifically. First,
**block content must be indented** — the `@`-block parser closes a block at the first later line whose
*first column* is `}`, so CSS written flush against column 0 terminates the `@style` block at its first
rule's closing brace. Second, `Show` is declared as a `Reference<bool>`, which classifies as a setup
reference, so the compiler inserts `.Value` in **both** read and write positions: the template writes
`Show = !Show`, not `Show.Value = !Show.Value`. See
[Single-File Components](../scaling-up/single-file-components.md) for both rules.

The template compiler resolves the `<Transition>` tag to the `_Transition` helper and the generated
render binds it against `DomRenderHelpers._Transition`, which is `Transition.Instance` itself. See
[SFC CSS Features](../scaling-up/sfc-css-features.md) for what `scoped` does to those class names.

## Transition props

Every prop below is read off the raw vnode property bag by name. Unrecognized props are ignored.

| Prop | Type read | Default | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | `"v"` | The class prefix. `name="fade"` yields `fade-enter-from`, `fade-enter-active`, and so on. |
| `mode` | `string` | `null` | `"out-in"`, `"in-out"`, or null/`"default"`. |
| `appear` | `bool` | `false` | Run the enter (appear) choreography on the very first mount. |
| `persisted` | `bool` | `false` | Makes the renderer skip enter/leave entirely — reserved for the `v-show` integration. |
| `css` | `bool` | `true` | `false` skips all class and end-detection work; only your own hooks run. |
| `type` | `string` | `null` | `"transition"` or `"animation"` — which end event to wait on when both are present. |
| `duration` | number or map | `-1` (none) | An explicit duration in milliseconds, or an `{ enter, leave }` map. |
| `enterFromClass` … `leaveToClass` | `string` | derived from `name` | Per-phase class overrides. |
| `appearFromClass`, `appearActiveClass`, `appearToClass` | `string` | the enter counterparts | Per-phase overrides for the appear pass. |
| `onBeforeEnter` … `onAppearCancelled` | delegates | none | The twelve hooks. See [JavaScript hooks](#javascript-hooks). |

Two of those are read strictly enough to be worth calling out, because a near-miss fails silently:

- **`appear` and `persisted` are read as `value is true`** — a bare `appear` attribute is the empty
  string, not a boolean, so it does nothing. Write `:appear="true"`.
- **`css` is only honoured when the value is literally `false`** — write `:css="false"`. Any other
  value, including the string `"false"`, leaves class choreography on.

A class-override prop is only taken when it is a non-empty `string`; otherwise the derived default
from `name` wins. `duration` accepts `int`, `long`, `double`, `float`, or a parseable `string`, or an
`IReadOnlyDictionary<string, object?>` carrying `"enter"` and `"leave"` keys. A missing or
unparseable duration is recorded as `-1`, which means "no explicit duration" — end detection then
reads the computed style instead.

## Transition classes

With `name="fade"`, the enter pass is:

1. `fade-enter-from` and `fade-enter-active` are added immediately, before insertion, by
   `OnBeforeEnter`.
2. On the next frame, `fade-enter-from` is removed and `fade-enter-to` is added.
3. When the transition ends, `fade-enter-to` and `fade-enter-active` are removed.

The leave pass mirrors it with `fade-leave-from` / `-active` / `-to`, with one addition: a reflow is
forced between adding the from-class and the active-class, so the browser commits the starting state
before the transition begins. The element is not removed from the DOM until the leave completes.

The appear pass uses `fade-enter-*` unless you override `appearFromClass` / `appearActiveClass` /
`appearToClass`, each of which defaults to its enter counterpart.

## Transition modes

`mode` controls how an outgoing child and an incoming child overlap when the content swaps.

| `mode` | Behavior |
| --- | --- |
| null / `"default"` | Enter and leave run simultaneously. |
| `"out-in"` | The outgoing child leaves first; an empty placeholder is rendered while it does, and the update job is re-queued once the leave finishes. |
| `"in-out"` | The incoming child enters first; the outgoing child's leave is deferred until the enter completes. |

The `in-out` deferral is expressed by `TransitionDelayLeave`:

```csharp
public delegate void TransitionDelayLeave(object element, Action earlyRemove, Action delayedLeave);
```

`earlyRemove` removes the outgoing element immediately — used when it re-enters before the delayed
leave has run — and `delayedLeave` starts the real leave once the incoming element has entered.

Keys matter here. Two branches of a `v-if` that render the same tag are the same vnode type to the
diff, so give each branch a distinct `key` or the renderer will patch in place rather than swapping
children. See [Conditional & List Rendering](../essentials/conditional-and-list.md).

## Appear

`appear` runs the enter choreography on the initial mount rather than only on subsequent toggles.
`TransitionState.IsMounted` is what gates it: an internal mounted hook sets it, and without `appear`
the enter hooks are suppressed until it is true.

```viu
@template {
    <Transition name="fade" :appear="true">
        <p key="hello">Fades in on first paint.</p>
    </Transition>
}
```

`TransitionState` is public and exposes three flags. All three have `internal` setters — they are
written by the runtime's own lifecycle hooks and are read-only from your code:

| Member | Meaning |
| --- | --- |
| `IsMounted` | Whether the transition has completed its initial mount. Gates enter without `appear`. |
| `IsLeaving` | Whether a leave is currently in flight. |
| `IsUnmounting` | Set before unmount — makes a leave remove synchronously instead of animating. |

## JavaScript hooks

`BaseTransitionProperties` is the resolved configuration object, and it carries all twelve hooks —
four each for enter, leave, and appear. The names match Vue's `@before-enter`, `@enter`, and so on.

```csharp
public sealed class BaseTransitionProperties
{
    public string? Mode { get; init; }
    public bool Appear { get; init; }
    public bool Persisted { get; init; }

    public Action<object>? OnBeforeEnter { get; init; }
    public TransitionEnterHook? OnEnter { get; init; }
    public Action<object>? OnAfterEnter { get; init; }
    public Action<object>? OnEnterCancelled { get; init; }

    public Action<object>? OnBeforeLeave { get; init; }
    public TransitionEnterHook? OnLeave { get; init; }
    public Action<object>? OnAfterLeave { get; init; }
    public Action<object>? OnLeaveCancelled { get; init; }

    public Action<object>? OnBeforeAppear { get; init; }
    public TransitionEnterHook? OnAppear { get; init; }
    public Action<object>? OnAfterAppear { get; init; }
    public Action<object>? OnAppearCancelled { get; init; }
}
```

The appear hooks each default to their enter counterpart when you do not supply them:
`OnBeforeAppear` falls back to `OnBeforeEnter`, `OnAppear` to `OnEnter`, `OnAfterAppear` to
`OnAfterEnter`, and `OnAppearCancelled` to `OnEnterCancelled`.

**The `element` argument is `object`, not a DOM node.** On the browser it is a boxed `int` node
handle — DOM nodes cross the WASM boundary as positive integers, with `0` reserved as the "no node"
sentinel. A hook that wants to touch the element casts with `(int)element` and goes through the
runtime's operations; there is no `JSObject` to reach for. The same constraint applies to
[custom directives](../reusability/custom-directives.md).

### The `done` contract

The three phase-running hooks are `TransitionEnterHook`, not `Action<object>`:

```csharp
public delegate void TransitionEnterHook(object element, Action done);
```

This is a deliberate divergence from upstream. Vue inspects a hook's declared arity to decide whether
to auto-invoke `done` for you; C# delegates cannot be arity-inspected, so **a `TransitionEnterHook`
always receives `done` and the hook is responsible for invoking it exactly once.** Forget it and the
phase never completes — the element stays mid-animation and, for a leave, is never removed.

If you do not want to manage completion, supply an `Action<object>` instead. `Transition` adapts a
fire-and-forget `Action<object>` given as `onEnter` / `onLeave` / `onAppear` into the two-argument
shape and invokes `done` itself the moment your hook returns.

The distinction is also what decides end detection. A hook supplied as an explicit
`TransitionEnterHook` suppresses the built-in `transitionend` / duration wait entirely — your `done`
is the only thing that finishes the phase. A hook supplied as `Action<object>` does not, so the
normal end detection still runs.

| Supplied as | `done` | End detection |
| --- | --- | --- |
| `TransitionEnterHook` | You must call it | Suppressed — you own completion |
| `Action<object>` | Called for you on return | Still runs |
| Not supplied | — | Still runs |

### Hook delegate types are matched exactly

Hook props are read with `value as Action<object>` and a type-pattern match on
`TransitionEnterHook`. There is no structural conversion. A lambda stored as any other delegate type
— `Action<int>`, `Func<object, bool>`, `Action` — reads back as null and the hook is silently
skipped. Cast explicitly when you build the property bag:

```csharp
var properties = VirtualNodeFactory.Properties(
    ("name", "fade"),
    ("onBeforeEnter", (Action<object>)(element => Log($"before enter: handle {(int)element}"))),
    ("onEnter", (TransitionEnterHook)((element, done) =>
    {
        // Drive your own animation here, then complete the phase exactly once.
        StartCustomFade((int)element, onComplete: done);
    })),
    ("onAfterEnter", (Action<object>)(_ => Log("entered"))),
    ("onLeaveCancelled", (Action<object>)(_ => Log("leave cancelled"))));
```

### A template can only bind the one-argument shape

This is the sharpest edge on the page. The `v-on` transform wraps every handler value in
`RenderHelpers._withHandler`, whose overloads supply the delegate target type a method group has no way
to get in an `object?`-typed prop slot. Those overloads are `Func<object?, object?>`, `Action<object?>`,
`Action`, `Func<object?>`, and a `Delegate` catch-all — and **none of them is `TransitionEnterHook`**.

The consequence is asymmetric:

| `@script` member bound as `@enter="…"` | Binds `_withHandler` overload | Stored delegate | Read back by `Transition` |
| --- | --- | --- | --- |
| `void OnEnter(object element)` | `Action<object?>` | `Action<object>` | Yes — adapted, `done` auto-invoked |
| `void OnEnter(object element, Action done)` | `Delegate` | `Action<object, Action>` | **No — reads back null, hook silently skipped** |

So `@enter="OnEnter"` works for the fire-and-forget shape and *compiles but does nothing* for the
`(element, done)` shape. If you need to own completion, build the property bag from C# as above and cast
to `TransitionEnterHook` explicitly. There is no template spelling for it.

## Disabling CSS with `css: false`

`css` is only honoured when the value is literally `false`, and `:css="false"` then returns the base
properties untouched — no class is ever added or removed, no reflow is forced, and no end detection is
scheduled. Only your hooks run, and the `done` contract above is the only thing that advances a phase.

This is the mode to use when an external animation library owns the timing — which means it is also the
mode that most needs the `(element, done)` hook shape, and therefore the C# property bag rather than a
template. A one-argument hook passed here completes the phase the instant it returns, so the animation
would be cut short:

```csharp
using System;

using Assimalign.Viu.RuntimeCore;

var properties = VirtualNodeFactory.Properties(
    ("css", false),
    ("onEnter", (TransitionEnterHook)((element, done) => StartCustomFade((int)element, onComplete: done))),
    ("onLeave", (TransitionEnterHook)((element, done) => StartCustomFadeOut((int)element, onComplete: done))));

return VirtualNodeFactory.Component(Transition.Instance, properties, slots);
```

Note the reading rule: `("css", false)` works because the value is the `bool` `false`. The string
`"false"` — which is what a plain `css="false"` attribute would produce — leaves class choreography on.

## Using `<Transition>` from hand-written C#

Until the `.viu` runtime adapter lands, this is the **only** way to actually mount a transition.
`Transition` is a plain `IComponentDefinition`: pass the transition props as the component vnode's
property bag and the animated child through the default slot.

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

namespace MyApp;

public sealed class FadePanel : IComponentDefinition
{
    public string? Name => "FadePanel";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var show = Reactive.Reference(false);

        return () =>
        {
            var slots = new ComponentSlots();
            slots["default"] = _ => show.Value
                ? [VirtualNodeFactory.Element(
                    "p",
                    VirtualNodeFactory.Properties(("key", "panel")),
                    "Now you see me.")]
                : [VirtualNodeFactory.Comment()];

            return VirtualNodeFactory.Element(
                "section",
                (VirtualNodeProperties?)null,
                VirtualNodeFactory.Element(
                    "button",
                    VirtualNodeFactory.Properties(
                        ("onClick", (Action)(() => show.Value = !show.Value))),
                    "Toggle"),
                VirtualNodeFactory.Component(
                    Transition.Instance,
                    VirtualNodeFactory.Properties(("name", "fade")),
                    slots));
        };
    }
}
```

Returning a comment vnode from the falsy branch is what a compiled `v-if` does too — it keeps a
stable anchor in the parent's children so the diff has something to patch against. The
`(VirtualNodeProperties?)null` cast is not decoration: `VirtualNodeFactory.Element` has both a
`(string, VirtualNodeProperties?, params VirtualNode?[]?)` and a `(string, params VirtualNode?[]?)`
overload, so a bare `null` in the second position is worth pinning to the props parameter explicitly.
The `(Action)` cast on `onClick` is required too — the browser event invoker dispatches only `Action`
and `Action<BrowserEvent>`, and throws `NotSupportedException` for anything else.

## `BaseTransition` directly

Reach for `BaseTransition` when you want the mode/appear/cancellation state machine without any CSS
class handling — a non-DOM renderer, or a transition driven entirely by your own timing.

Configuration arrives one of two ways. `Transition` uses the first: it passes a pre-resolved
`BaseTransitionProperties` under the reserved prop key `BaseTransition.PropertiesKey`, whose value is
the literal string `"$baseTransition"`. Direct users may instead pass the individual props (`"mode"`,
`"appear"`, `"persisted"`, `"onBeforeEnter"`, `"onEnter"`, and so on) and let `BaseTransition`
assemble them.

```csharp
using System;

using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.Shared;   // SlotFlags lives here, not in RuntimeCore

var transitionProperties = new BaseTransitionProperties
{
    Mode = "in-out",
    Appear = true,
    OnBeforeEnter = _ => Log("beforeEnter"),
    OnEnter = (_, done) => _pendingEnterDone = done,
    OnAfterEnter = _ => Log("afterEnter"),
    OnLeave = (_, done) => _pendingLeaveDone = done,
    OnAfterLeave = _ => Log("afterLeave"),
};

var bag = VirtualNodeFactory.Properties((BaseTransition.PropertiesKey, transitionProperties));

var slots = new ComponentSlots { Flag = SlotFlags.Dynamic };
slots["default"] = _ => which.Value == "a"
    ? [VirtualNodeFactory.Element("div", VirtualNodeFactory.Properties(("key", "a")), "A")]
    : [VirtualNodeFactory.Element("span", VirtualNodeFactory.Properties(("key", "b")), "B")];

return VirtualNodeFactory.Component(BaseTransition.Instance, bag, slots);
```

Holding the `done` callbacks like that is exactly how `in-out` mode is observable: swapping `which`
runs `beforeEnter` and `enter` on the incoming child while the outgoing child's leave has not started
at all. Invoking the stored enter `done` then fires `afterEnter`, `beforeLeave`, and `leave` in that
order, and invoking the leave `done` finally removes the old child.

Note the `SlotFlags.Dynamic` on the slots object. `ComponentSlots` defaults to `SlotFlags.Stable`,
which lets a parent-only re-render skip the child; content that changes structurally — a `v-if`
branch swap, a `v-for`, a dynamic slot name — needs `Dynamic`. See [Slots](../components/slots.md).

## `<TransitionGroup>`

`<TransitionGroup>` animates a keyed list: children entering and leaving get the same CSS-class
choreography `Transition` resolves, and children that merely move get a FLIP transform.

```viu
@template {
    <TransitionGroup tag="ul" name="list">
        <li v-for="item in Items" :key="item.Id">{{ item.Label }}</li>
    </TransitionGroup>
}

@script {
    using Assimalign.Viu.Reactivity;

    public readonly ReactiveList<ListItem> Items = new();

    public sealed record ListItem(int Id, string Label);
}

@style scoped {
    .list-enter-active,
    .list-leave-active,
    .list-move {
        transition: all 0.4s ease;
    }

    .list-enter-from,
    .list-leave-to {
        opacity: 0;
        transform: translateY(12px);
    }
}
```

It accepts every `Transition` prop, plus two of its own:

| Prop | Type read | Default | Meaning |
| --- | --- | --- | --- |
| `tag` | `string` | none | The real element to render the children into. Omit it and the group renders a fragment. |
| `moveClass` | `string` | `name` + `"-move"`, or `"v-move"` | The class applied to elements that changed position. |

Three behaviors follow from the implementation and are worth knowing:

- **Only keyed children get transition hooks** — a child whose `Key` is null is rendered but never
  stamped, so it neither enters nor leaves with an animation. Always bind `:key`.
- **One level of fragments is flattened** — a `v-for` renders its items as a keyed fragment, and the
  group unwraps that fragment so the items become the group's direct children.
- **A missing `moveClass` transition disables the whole FLIP pass** — before doing any work the group
  measures whether the move class actually adds a transform transition, and bails out entirely if it
  does not. A `-move` rule that forgets `transform` in its `transition` shorthand means nothing
  animates.

The same C# shape works here:

```csharp
var slots = new ComponentSlots { Flag = SlotFlags.Dynamic };
slots["default"] = _ =>
{
    var items = list.Value;
    var children = new VirtualNode?[items.Length];
    for (var index = 0; index < items.Length; index++)
    {
        children[index] = VirtualNodeFactory.Element(
            "span",
            VirtualNodeFactory.Properties(("key", items[index])),
            items[index]);
    }
    return children;
};

return VirtualNodeFactory.Component(
    TransitionGroup.Instance,
    VirtualNodeFactory.Properties(("tag", "div")),
    slots);
```

### The FLIP move

The move animation is upstream's FLIP, in the same three non-interleaved passes, driven by a set of
bridge operations so that the read pass and the write pass never thrash layout:

1. **Snapshot before the patch** — during render, each outgoing child's position is recorded with a
   `MeasurePosition` call.
2. **Gate on the move class** — after the patch, a single `HasCssTransform` probe against a clone
   decides whether the move class contributes a transform transition at all. If not, the pass stops.
3. **Finish pending callbacks** — any in-flight move or enter callback is force-completed so
   positions are measured settled rather than mid-animation.
4. **Read every new position** — a second `MeasurePosition` pass over all outgoing children.
5. **Write the inverting transforms** — `SetMoveTransform` is applied to every child whose delta is
   non-zero, then `ForceReflow` commits it.
6. **Animate back** — the move class is added, `ClearMoveStyles` drops the inverse transform, and
   `WhenMoveEnds` removes the class when the transition finishes.

The snapshot in step 1 is only taken when the transition operations are installed, which happens as
a side effect of building the browser node operations during `BrowserRuntime.CreateApp`. See
[Quick Start](../quick-start.md) for the bootstrap.

## How the compiler resolves the tags

`<Transition>` and `<TransitionGroup>` are recognized as built-in component tags by the DOM parser and
transform options in `Assimalign.Viu.Syntax.Templates` — `ParserOptions.CreateDom()` treats the four
spellings `Transition`, `transition`, `TransitionGroup`, and `transition-group` as built-ins, and
`TransformOptions.CreateDom()`'s `IsBuiltInComponent` maps them to `HelperNames.Transition` /
`HelperNames.TransitionGroup`. They therefore resolve to the `_Transition` / `_TransitionGroup` helpers
rather than to a name-based `_resolveComponent` lookup. Both live in `DomRenderHelpers`:

```csharp
public static readonly object _Transition = Transition.Instance;
public static readonly object _TransitionGroup = TransitionGroup.Instance;
```

Two details a reader may notice and misread:

- **They are typed `object`, not `IComponentDefinition`.** They are passed as a vnode tag and
  resolved by the vnode factory's component arm. The type is not a sign that they are unimplemented
  markers — they are the real singletons, and creating a vnode from either produces
  `VirtualNodeType.Component`.
- **The `_`-prefixed lowercase spelling is deliberate.** `RenderHelpers` and `DomRenderHelpers`
  reproduce Vue's `helperNameMap` names verbatim because the code generator binds them literally.
  This is the one documented exception to the repo's whole-word naming rule; everywhere else Viu
  spells things `Properties`, `Attributes`, `Subtree`.

`BaseTransition` is likewise a real component behind `RenderHelpers._BaseTransition`, unlike
`_Teleport`, `_Suspense`, and `_KeepAlive`, which are inert markers that throw at render time. See
[KeepAlive, Teleport & Suspense](deferred-built-ins.md).

## Current limits

Everything above works. These are the known gaps, each a scheduled follow-up rather than a
misbehavior.

- **`@style scoped` transition classes do not match yet.** Every `.viu` snippet on this page puts its
  `.fade-*` / `.list-*` rules in a `@style scoped` block, which is the intended authoring form — but
  the renderer never stamps the `data-v-<hash>` attribute those rewritten selectors depend on
  (`RendererOptions<TNode>.SetScopeId` is declared and never invoked). Until that lands, transition
  CSS must live in a **non-scoped** `@style` block or in a plain stylesheet to have any effect. The
  class add/remove choreography itself is fully implemented — it is only the scoped selector that
  fails to match. See [SFC CSS Features](../scaling-up/sfc-css-features.md).
- **Transition operations always run direct, never through the command buffer** — even with
  `BrowserRuntime.CreateApp(root, useCommandBuffer: true)`, the class add/remove, timing, and FLIP
  operations bypass the batched interop frame, because they are frame-timed and read-then-write.
  Buffered-frame ordering of transition class writes is a documented follow-up. The rendering itself
  is still batched; only these operations are excepted.
- **`v-show` + `<Transition>` coordination is not wired.** The state machine honours a
  `persisted` transition and `VShow` carries the seam, but `VShow`'s transition hooks are
  documented-inert placeholders — nothing builds the persisted transition object yet. Use `v-if`
  with a `<Transition>` today; `v-show` toggles `display` without animating.
- **`BaseTransition`'s inner-child resolution does not unwrap `KeepAlive` or `Teleport` children.**
  The private `GetInnerChild` helper returns the vnode itself, so a plain element, component, or
  comment is its own inner child. This is moot until those built-ins exist.
- **No *compile-time* single-child validation is performed.** The diagnostic
  `XTransitionInvalidChildren` (`CompilerErrorCode` value 63, message "`<Transition>` expects exactly
  one child element or component.") is defined with its message but is never actually emitted — the
  element transform only raises the `<KeepAlive>` equivalent, `XKeepAliveInvalidChildren`. Passing
  multiple children therefore compiles without complaint. At **runtime** `BaseTransition` does notice:
  it walks the children, keeps the *first* non-comment one, and reports "&lt;transition&gt; can only be
  used on a single element or component. Use &lt;transition-group&gt; for lists." through the dev-warning
  sink — which defaults to `Debug.WriteLine`, so it is invisible in a Release WASM build. See
  [Compiler Diagnostics](../../api/diagnostics.md).
- **End detection in a real browser is covered by an e2e harness that does not exist yet.** The
  class sequence, forced reflow, next-frame swap, appear, and cancellation paths are pinned by
  deterministic in-memory tests against the injectable timing seam; real `transitionend` behavior is
  deferred.

## Related

- [Conditional & List Rendering](../essentials/conditional-and-list.md) — `v-if` and keyed `v-for`,
  the two things a transition wraps.
- [Slots](../components/slots.md) — `ComponentSlots`, `SlotFlags`, and why structurally-changing
  content needs `Dynamic`.
- [SFC CSS Features](../scaling-up/sfc-css-features.md) — `@style scoped` and how it rewrites the
  transition class names.
- [KeepAlive, Teleport & Suspense](deferred-built-ins.md) — the built-ins that are markers only.
- [Differences from Vue 3](../../roadmap/vue-differences.md) — the naming map and the behavioral
  divergences, including the `done` contract.
- [Project status](../../roadmap/status.md) — area-by-area coverage.
