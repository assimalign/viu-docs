# Event Handling

Listening to DOM events with `v-on`, the modifier and key guards, and the `BrowserEvent` payload a
handler receives.

> **Status:** Partial. Event-name resolution, every modifier, the key guards, the `BrowserEvent`
> payload, and the invoker attachment path are implemented. What is *not* wired is the last hop for
> **inline** template handlers written without a modifier — they compile to `Action<object?>` /
> `Func<object?, object?>`, a shape the DOM invoker rejects. See
> [Not yet implemented](#not-yet-implemented) and [Project Status](../../roadmap/status.md).

Viu's event system is a port of Vue's — see
[Event Handling](https://vuejs.org/guide/essentials/event-handling.html) upstream. The template
syntax is identical, the modifiers are identical, and `withModifiers`/`withKeys` are ported verbatim
as `BrowserEvents.WithModifiers` and `BrowserEvents.WithKeys`. What differs is the payload: instead
of a live DOM `Event` object, a handler receives a `BrowserEvent` — a flat, pre-marshaled snapshot,
because DOM nodes and events cross the WebAssembly boundary as primitives rather than as JS proxies.

## Listening to events

Use `v-on:click`, or the `@click` shorthand. The handler may be a method reference, an inline
statement, an inline call, or several statements separated by semicolons.

```viu
@template {
  <div class="counter">
    <p>Count: {{ Count }}</p>

    <!-- method reference -->
    <button @click="Increment">+1</button>

    <!-- inline statement -->
    <button @click="Count++">+1 inline</button>

    <!-- inline call, passing the event; a modifier types $event as BrowserEvent -->
    <button @click.stop="Record($event)">record</button>

    <!-- multiple statements -->
    <button @click="Reset(); Log()">reset</button>
  </div>
}

@script {
using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeDom;

public Reference<int> Count = Reactive.Reference(0);

public void Increment() => Count.Value++;

public void Record(BrowserEvent browserEvent) => Count.Value = browserEvent.Detail;

public void Reset() => Count.Value = 0;

public void Log() { }
}
```

Template expression bodies are **C#**, not JavaScript — see
[Template Syntax](./template-syntax.md) for the rules that govern what you may write inside the
quotes.

> **Which of those four shapes actually dispatch today.** A **method reference** (`@click="Increment"`)
> dispatches, and so does **any** handler carrying at least one guard modifier
> (`@click.stop="Record($event)"`, `@keyup.enter="Submit"`), because a guard routes the handler through
> `_withModifiers`/`_withKeys`, which return `Action<BrowserEvent>`. A **modifier-less inline
> statement** — `@click="Count++"`, `@click="Reset(); Log()"` — compiles, but the delegate it produces
> is `Action<object?>`/`Func<object?, object?>`, and the invoker registry accepts only `Action` and
> `Action<BrowserEvent>`. Such a handler is silently dropped at dispatch. See
> [Not yet implemented](#not-yet-implemented).

The same rule decides the static type of `$event`: under a guard modifier the wrapping lambda's
parameter is a `BrowserEvent`, so `Record(BrowserEvent)` binds. Without a modifier the parameter is
`object?`, and a `BrowserEvent`-typed method would not even compile.

### What each handler shape compiles to

The `v-on` transform rewrites identifiers through `_ctx.` and, for a member the `@script` analyzer
classified as a reactive reference, appends `.Value` in both read and write positions. Only a member
whose *declared type name* is `Reference`, `ShallowReference`, `CustomReference`, `Computed`, or
`IReference` is classified that way — classification is syntactic, so a `var`-typed or otherwise
untyped member is left alone. The `$event` you write in a template is substituted to the legal C#
identifier `__event`.

Below, `count` is declared `Reference<int>` and `open` is a plain `bool` field:

| Template | Emitted handler expression |
| --- | --- |
| `@click="submit"` | `_ctx.submit` |
| `@click="count++"` | `__event => (_ctx.count.Value++)` |
| `@click="count += 1"` | `__event => (_ctx.count.Value += 1)` |
| `@click="open = true"` | `__event => (_ctx.open = true)` |
| `@click="save($event)"` | `__event => { _ctx.save(__event); }` |
| `@click="first(); second()"` | `__event => {_ctx.first(); _ctx.second();}` |

That column is the handler *expression*. What lands in the props tuple is that expression wrapped —
`("onClick", _withHandler(__event => (_ctx.count.Value++)))` — except when a modifier already wrapped
it in `_withModifiers`/`_withKeys`, whose own signatures supply the delegate target type.

Two C#-specific consequences fall out of that table:

- **A single-statement handler that is a *call* emits a statement-block lambda** — `__event => { … ; }`
  rather than `__event => ( … )`. A parenthesized expression lambda over a possibly-`void` call binds
  no C# delegate, so the emitter always reaches for the block form when the body is a call.
- **C# has no automatic semicolon insertion**, so the compiler synthesizes the trailing `;` for
  multi-statement handlers. Writing `@click="first(); second();"` yourself is fine — the terminator
  is never doubled.

Bare lambdas and method groups are routed through the `_withHandler` helper, which exists only to
give the C# compiler a delegate target type to bind the handler against.

### The same thing in hand-written C#

A template is not required. Handlers are ordinary props on a vnode whose name is `on` followed by an
**uppercase** letter — that is the `VirtualNodeFactory.IsEventListenerName` test, the port of upstream's
`isOn`. `onclick` (lowercase `c`) is an attribute, not a listener:

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;
using Assimalign.Viu.RuntimeDom;

internal sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        var count = Reactive.Reference(0);

        void Increment() => count.Value++;

        void OnKey(BrowserEvent browserEvent) => count.Value = browserEvent.Detail;

        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Properties(
                ("onClick", (Action)Increment),
                ("onKeydown", (Action<BrowserEvent>)OnKey),
                // the raw prop name carries the listener options; see the suffix table below
                ("onScrollPassiveCapture", (Action)Increment)),
            VirtualNodeFactory.Text(count.Value.ToString()));
    }
}
```

Note the explicit casts. The prop bag is `object?`-typed, so a method group needs a delegate target
type — and the delegate shape is load-bearing (see
[Handler delegate shapes](#handler-delegate-shapes)).

## Event name resolution

- **Static names** become `on` + `Capitalize(camelize(name))` — `@click` is the prop `onClick`,
  `@keyup` is `onKeyup`, `@my-event` is `onMyEvent`.
- **A `vue:` prefix** becomes `onVnodeX` — retained deliberately from upstream, not renamed.
- **A name containing an uppercase letter on a native element** emits `on:name` verbatim, preserving
  the author's casing for custom elements.
- **A dynamic argument** — `@[eventName]="fn"` — is wrapped in the `toHandlerKey` helper at runtime.
- **`v-on="handlersObject"`** without an argument merges the whole object through `toHandlers` and
  escalates the vnode to `FullProps`.

Writing `@click` with neither an expression nor modifiers is template compiler code **35**
(`XVOnNoExpression`, "v-on is missing expression."). That is not a diagnostic ID: it rides on the
message of a `VIU1101` error, as ` (template compiler code 35)`. See
[Compiler Diagnostics](../../api/diagnostics.md).

## Event modifiers

Modifiers fall into three buckets, and which bucket a modifier lands in determines whether it becomes
a *guard around the delegate* or a *suffix on the prop name*.

| Modifier | Bucket | Result |
| --- | --- | --- |
| `.stop` | guard | wraps in `_withModifiers`; records `StopPropagation()` and always runs the handler |
| `.prevent` | guard | wraps in `_withModifiers`; records `PreventDefault()` and always runs the handler |
| `.self` | guard | runs only when `BrowserEvent.IsSelfTarget` is true |
| `.ctrl` `.shift` `.alt` `.meta` | guard | runs only when that bit is set in `BrowserEvent.Modifiers` |
| `.exact` | guard | runs only when the pressed system-modifier set *equals* the set named on the handler |
| `.left` `.right` | guard or remap | classified by event — see below |
| `.middle` | guard or remap | always a mouse modifier, never a key one — see below |
| `.capture` | prop suffix | `onClickCapture` — listener attached with `capture: true` |
| `.once` | prop suffix | `onClickOnce` — listener attached with `once: true` |
| `.passive` | prop suffix | `onClickPassive` — listener attached with `passive: true` |
| anything else | key guard | wraps in `_withKeys` — see [Key modifiers](#key-modifiers) |

```viu
@template {
  <form @submit.prevent="Save">
    <div @click.self="Dismiss">
      <button @click.stop.prevent="Confirm">confirm</button>
    </div>
  </form>

  <!-- listener options: these change the prop NAME, not the delegate -->
  <div @scroll.passive.capture="OnScroll"></div>
  <button @click.once="InitializeOnce">initialize</button>

  <!-- system modifiers -->
  <div @click.ctrl="OpenInBackground"></div>
  <div @click.ctrl.exact="OnlyControl"></div>
}
```

### Mouse-button modifiers

`.left` and `.right` are classified *by event*: on `@keyup`/`@keydown`/`@keypress` they are arrow-key
modifiers, on any other event they are button guards. (On a **dynamic** event argument — `@[name].left`
— the compiler cannot tell, so it registers the modifier as both.) `.middle` is never a key modifier;
it is always a mouse guard.

On `@click` specifically, two of them additionally **remap the event**:

- **`@click.right`** compiles to the prop `onContextmenu` — a different DOM event entirely.
- **`@click.middle`** compiles to the prop `onMouseup`.

The remap does not replace the guard: the handler is still wrapped in `_withModifiers(…, ["right"])` /
`["middle"]`, so the button check runs on the remapped event too.

Where they *are* guards, they deliberately pass for non-mouse events, because `BrowserEvent.Button`
is `-1` when no mouse button is involved:

| Modifier | Passes when |
| --- | --- |
| `left` | `Button <= 0` |
| `middle` | `Button is < 0 or 1` |
| `right` | `Button is < 0 or 2` |

### `.exact`

`.exact` compares the pressed system-modifier set against the set of `ctrl`/`shift`/`alt`/`meta`
names listed *on the same handler*. It is order-independent, but it must be written alongside the
modifiers it constrains:

```viu
<!-- fires on Ctrl+Click, and also on Ctrl+Shift+Click -->
<button @click.ctrl="Fires">loose</button>

<!-- fires ONLY on Ctrl+Click, with no other system modifier held -->
<button @click.ctrl.exact="Fires">strict</button>

<!-- fires only on a click with NO system modifier at all -->
<button @click.exact="Fires">bare</button>
```

## Key modifiers

Key guards wrap the handler in `_withKeys`, and are applied only when the key is dynamic or the event
is `onKeyup` / `onKeydown` / `onKeypress`.

```viu
<input @keyup.enter="Submit" />
<input @keyup.escape="Cancel" />
<input @keydown.enter.stop="SubmitAndStop" />
<input @keyup.arrow-up="SelectPrevious" />
```

**The matching rule is exact and easy to get wrong.** `WithKeys` compares each name you wrote against
`Hyphenate(browserEvent.Key).ToLowerInvariant()`. A DOM `event.key` of `"ArrowUp"` therefore becomes
`arrow-up`, and `"PageDown"` becomes `page-down`. Write **hyphenated lowercase** names, or use one of
the seven aliases:

| Alias | Matches the hyphenated key |
| --- | --- |
| `esc` | `escape` |
| `space` | `" "` (a single space) |
| `up` | `arrow-up` |
| `left` | `arrow-left` |
| `right` | `arrow-right` |
| `down` | `arrow-down` |
| `delete` | `backspace` |

An event whose `Key` is the empty string — every non-keyboard event — never matches any key guard, so
the handler never runs.

## The `BrowserEvent` payload

`BrowserEvent` is the single argument shape a DOM handler can take. It is not a wrapper around a live
JS object: every field is extracted JS-side and marshaled as a flat primitive in one interop call, so
reading `browserEvent.ClientX` costs nothing and no proxy is retained per event. The constructor is
`internal` — you receive instances, you never construct them.

| Member | Type | Notes |
| --- | --- | --- |
| `EventName` | `string` | the resolved DOM event name, e.g. `"click"` |
| `TimeStamp` | `double` | the DOM `event.timeStamp`, carried for inspection (the attach-timestamp guard below runs JS-side, before this payload is ever built) |
| `Key` | `string` | `event.key`; the **empty string**, never null, for non-keyboard events |
| `Code` | `string` | `event.code`; likewise empty for non-keyboard events |
| `Modifiers` | `BrowserEventModifiers` | `[Flags]` — `None`, `Control`, `Shift`, `Alt`, `Meta` |
| `Button` | `int` | `-1` for non-mouse events |
| `Buttons` | `int` | the `event.buttons` bitmask |
| `ClientX` / `ClientY` | `double` | pointer coordinates |
| `Detail` | `int` | `event.detail` — click count, and similar |
| `IsSelfTarget` | `bool` | what the `.self` guard reads |
| `TargetValue` | `string?` | the target's `value`, so `v-model` needs no follow-up interop read |
| `TargetChecked` | `bool` | the target's `checked` |
| `SelectedValues` | `IReadOnlyList<string>?` | non-null **only** for a `<select multiple>` target |
| `PropagationStopped` | `bool` | whether `StopPropagation()` was called |
| `DefaultPrevented` | `bool` | whether `PreventDefault()` was called |
| `StopPropagation()` | `void` | records a deferred intent |
| `PreventDefault()` | `void` | records a deferred intent |

### `StopPropagation()` and `PreventDefault()` are deferred intents

This is the one behavioral divergence from Vue worth memorizing. Neither method touches the live JS
event. They set flags that the dispatcher returns to JavaScript as a bitmask (bit 0 = stop,
bit 1 = prevent), which the JS listener applies **after the synchronous dispatch returns**.

The consequence: calling them from an `async` continuation is too late — the dispatch has already
returned and the bitmask has already been applied.

```csharp
// Correct — the intent is recorded during the synchronous dispatch.
void OnSubmit(BrowserEvent browserEvent)
{
    browserEvent.PreventDefault();
    _ = SaveAsync();
}

// WRONG — the dispatch returned long before this line runs, so nothing is prevented.
async void OnSubmitBroken(BrowserEvent browserEvent)
{
    await SaveAsync();
    browserEvent.PreventDefault();
}
```

## Handler delegate shapes

**A DOM event handler delegate must be `Action` or `Action<BrowserEvent>`.** Nothing else works.

Any other shape — `Action<MyArgs>`, `Func<BrowserEvent, bool>`, `EventHandler` — throws
`NotSupportedException` *inside* the invoker registry's `try`/`catch`. That exception is routed to
the registry's `ErrorSink`, whose default implementation is a `Debug.WriteLine`. In a Release WASM
build a `Debug.WriteLine` compiles away, so **a wrong-shaped handler fails completely silently**:
nothing throws, nothing logs, the click just does nothing.

> **This is exactly what a modifier-less inline template handler runs into.** `_withHandler`, the
> helper the emitter wraps such a handler in, target-types it as `Action<object?>` or
> `Func<object?, object?>` — neither of which is `Action` or `Action<BrowserEvent>`. The prop value
> reaches the registry unchanged, and dispatch takes the `NotSupportedException` branch. Writing the
> handler as a method reference, or adding any guard modifier, produces an accepted shape.

The same is true of any exception your handler throws — it reaches `ErrorSink` and never escapes into
the JS listener. The app-level error pipeline that would route these to
`ApplicationConfiguration.ErrorHandler` is not yet wired, so today handler exceptions are effectively
invisible in Release builds.

Component **emits** use a *different* allowed set — `Action`, `Action<object?>`, or
`Action<object?[]>`. Confusing the two is an easy silent failure; see
[Component Events](../components/events.md).

## Applying guards from C#

The guards the compiler emits are public API you can call yourself.
`BrowserEvents.WithModifiers(Action<BrowserEvent>, params string[])` and
`BrowserEvents.WithKeys(Action<BrowserEvent>, params string[])` both return an
`Action<BrowserEvent>`, so they nest:

```csharp
using Assimalign.Viu.RuntimeDom;

void Submit(BrowserEvent browserEvent) { /* … */ }

// @keyup.enter.stop="Submit"
var guarded = BrowserEvents.WithKeys(
    BrowserEvents.WithModifiers(Submit, "stop"),
    "enter");
```

Modifier names are passed **unprefixed** — `"stop"`, not `".stop"`. The recognized set is exactly
`stop`, `prevent`, `self`, `ctrl`, `shift`, `alt`, `meta`, `left`, `middle`, `right`, `exact`.

> **`WithModifiers` passes for any unrecognized name.** A typo such as `"prevnt"` does not throw and
> does not warn — the guard simply returns true and the modifier silently does nothing.

The `DomRenderHelpers._withModifiers` and `._withKeys` helpers the compiler binds to are the same
guards behind four overloads each, target-typing the four handler shapes the emitter can produce
(`Func<BrowserEvent, object?>`, `Action<BrowserEvent>`, `Func<object?>`, `Action`). The `_`-prefixed
lowercase spelling is deliberate — those names *are* the upstream `helperNameMap` contract that
generated code binds to by name.

## How listeners are attached: the invoker pattern

Viu ports Vue's invoker pattern exactly. There is **one JS listener per
`(element, eventName, capture)` triple**, and the .NET side holds the actual delegate behind it. A
re-render that produces a new handler closure is a pure delegate swap in managed memory.

`BrowserEventInvokerRegistry` is `internal` — you never call it, the renderer does. The sequence
below is the shape of its pinned test, shown only to make the cost model concrete:

```csharp
// The first SetListener attaches; the next two cost ZERO interop calls.
registry.SetListener(element, "onClick", (Action)(() => log.Add("first")));   // 1 bridge call
registry.SetListener(element, "onClick", (Action)(() => log.Add("second")));  // 0
registry.SetListener(element, "onClick", (Action)(() => log.Add("third")));   // 0
// dispatch now runs "third"
```

That is why a handler expression that allocates a fresh closure every render is not a performance
problem here: re-rendering swaps a field in managed memory rather than touching the DOM.

### Prop-name suffix parsing

The raw prop name carries the listener options. The registry strips a leading `on`, then repeatedly
strips a trailing `Once`, `Capture`, or `Passive` — in any combination and any order, each at most
once — and lower-cases the remainder to get the event name:

| Prop name | Event | Once | Capture | Passive |
| --- | --- | --- | --- | --- |
| `onClick` | `click` | no | no | no |
| `onClickOnce` | `click` | **yes** | no | no |
| `onClickCapture` | `click` | no | **yes** | no |
| `onClickPassive` | `click` | no | no | **yes** |
| `onClickCaptureOnce` | `click` | **yes** | **yes** | no |
| `onScrollPassiveCapture` | `scroll` | no | **yes** | **yes** |
| `onKeydown` | `keydown` | no | no | no |

**Listener identity is `(nodeHandle, eventName, capture)` only.** `Once` and `Passive` are *not* part
of the key. Registering `onClick` and then `onClickPassive` on the same element hits the same invoker;
the second registration is treated as a handler swap, and the `passive` flag from the first attach
wins.

### Two handler channels share one listener

Each invoker carries two independent channels for the same DOM event:

- **The property channel** — a template `@event` or an `onX` prop.
- **The model channel** — a listener installed by a `v-model` directive.

Both fire on dispatch, in **property-then-model order**, and the shared DOM listener is removed only
once both channels are null. This is what lets `<input v-model="text" @input="Track" />` work without
either binding clobbering the other. See [Form Input Bindings](./form-bindings.md).

### The attach-timestamp guard

The JS listener applies Vue's attach-timestamp guard — `if (event.timeStamp < attached) return`. An
event that fired before its listener was attached in the same patch is dropped silently, at zero
interop cost. This is correct for real browser events, but it surprises anyone dispatching synthetic
events carrying a stale `timeStamp`.

## Not yet implemented

- **Modifier-less inline template handlers do not dispatch.** `@click="Count++"`,
  `@click="Reset(); Log()"`, and `@click="Save($event)"` compile and render, but the emitter's
  `_withHandler` types them as `Action<object?>` / `Func<object?, object?>`, and the invoker registry
  dispatches only `Action` and `Action<BrowserEvent>`. The mismatch raises `NotSupportedException`
  into `ErrorSink`, which is a `Debug.WriteLine` — so in a Release build the handler silently does
  nothing. **Workarounds today:** write the handler as a method reference (`@click="Increment"`), add
  any guard modifier (`@click.stop="…"`, `@keyup.enter="…"`), or build the prop by hand in C# with an
  explicit `(Action)` / `(Action<BrowserEvent>)` cast.
- **Handler caching is off.** The compiler's `CacheHandlers` option exists and the `v-on` transform
  honors it, but the generator keeps it disabled: upstream's cached member-expression handler wraps in
  `(...args) => …`, which has no C# spelling yet. The invoker pattern already makes the cost of an
  uncached handler a delegate swap rather than an interop call.
- **The app-level error pipeline for handler exceptions.** `ErrorSink` is still the placeholder debug
  trace; `ApplicationConfiguration.ErrorHandler` is not yet wired to it.
- **SSR event handling.** `v-on` props are skipped under the compiler's SSR flag, but there is no SSR
  transform preset and no server renderer at all. See [Project Status](../../roadmap/status.md).

## Related

- [Template Syntax](./template-syntax.md) — what you may write inside a handler expression.
- [Form Input Bindings](./form-bindings.md) — `v-model` and the model listener channel.
- [Component Events](../components/events.md) — `Emit`, and the different delegate shapes it accepts.
- [Custom Directives](../reusability/custom-directives.md) — directives that install their own listeners.
- [Differences from Vue 3](../../roadmap/vue-differences.md) — the full naming and behavior map.
