# Essentials

The nine chapters that together cover everything needed to build a real Viu component.

> **Status:** Partial. Seven of the nine chapters document fully implemented behavior; **Form Input
> Bindings** and **Lifecycle Hooks & Template Refs** are `Partial`, and several chapters carry a
> `Not yet implemented` tail where the compiler or runtime is still catching up. See
> [Project status](../../roadmap/status.md).

These chapters are meant to be read in order. Each one assumes the vocabulary the previous chapter
introduced, and by the end of the ninth you will have met every primitive the framework asks you to
know: the component contract, refs and computeds, the template language, the directives, watchers,
and the lifecycle. Everything after this section — [Components In-Depth](../components/index.md),
[Reusability](../reusability/composables.md), [Built-ins](../built-ins/transition.md) — is depth on
top of this foundation, not a prerequisite for it.

This section mirrors [Vue's Essentials](https://vuejs.org/guide/essentials/application.html) chapter
for chapter, so a Vue developer can navigate by muscle memory. The names are different, the model
is not.

## Before you start

Read [Introduction](../introduction.md) for the five founding divergences that shape every API here,
and work through [Quick Start](../quick-start.md) so you have a project that actually runs. If you
are arriving from Vue, [Differences from Vue 3](../../roadmap/vue-differences.md) is the fastest
route to the naming map and the behavioral divergences.

## The shape of a Viu component

Every chapter in this section is a detail of the following picture, so it is worth holding the whole
thing in view first. `IComponentDefinition.Setup` runs exactly **once** per component instance and
**returns** the render function — the closure it returns is the proxy-free realization of Vue's
state object. There is no `this`, no `data`/`methods`/`computed` options, and no Options API.

```csharp
using System;

using Assimalign.Viu.Reactivity;
using Assimalign.Viu.RuntimeCore;

internal sealed class Counter : IComponentDefinition
{
    public string? Name => "Counter";

    public Func<VirtualNode?> Setup(ComponentProperties properties, ComponentSetupContext context)
    {
        // Reactivity Fundamentals — state lives in refs, read and written through .Value.
        var count = Reactive.Reference(0);

        // Computed Properties — derived, cached, invalidated automatically.
        var label = Reactive.Computed(() => count.Value == 1 ? "click" : "clicks");

        // Event Handling — a plain method the render closure captures.
        void Increment() => count.Value++;

        // Lifecycle Hooks — registered synchronously, inside Setup, never outside it.
        Lifecycle.OnMounted(() => Console.WriteLine("Counter mounted"));

        // Setup returns the render function. It re-runs on every update; Setup does not.
        return () => VirtualNodeFactory.Element(
            "button",
            VirtualNodeFactory.Properties(("type", "button"), ("onClick", (Action)Increment)),
            VirtualNodeFactory.Text($"{count.Value} {label.Value}"));
    }
}
```

That is the hand-written form, built from [`VirtualNodeFactory`](../../api/render-function.md) calls
— Viu's counterpart to Vue's [`h()`](https://vuejs.org/guide/extras/render-function.html). It is the
form the one working in-repo demo uses, and **it is the only path that runs end to end today**.

The same component written as a [single-file component](../scaling-up/single-file-components.md)
looks like this. The `.viu` file uses an `@`-block container rather than Vue's tag-wrapped blocks,
and the SFC source generator emits a partial class carrying a compiled `static Render` method:

```viu
@template {
    <button type="button" @click="Count++">{{ Count }} clicks</button>
}

@script {
    using Assimalign.Viu.Reactivity;

    public Reference<int> Count = Reactive.Reference(0);
}
```

> **Not yet implemented.** The `.viu` form does **not** yet produce a runnable component. The
> generator emits the partial class and its `Render` method, but nothing wires that method into
> `IComponentDefinition.Setup` — today the only proof is a test harness that calls `Render` by hand.
> Write components in the hand-written form above until the runtime adapter lands; see
> [Single-File Components](../scaling-up/single-file-components.md#not-yet-implemented).

Note `Count++` in the template. Template expressions are **C#**, not JavaScript, and the compiler
inserts `.Value` in both read and write positions — that markup emits `_ctx.Count.Value++`. The
[Template Syntax](template-syntax.md) chapter covers the rewriting rules in full.

## The chapters

Read top to bottom.

- **[Components](components.md)** — the component contract: `Setup(ComponentProperties,
  ComponentSetupContext)` returning `Func<VirtualNode?>`, the defaulted `IComponentDefinition`
  members, `ComponentInstance`, and why there is no `this` and no Options API. Read this first; every
  other chapter assumes it.
- **[Reactivity Fundamentals](reactivity-fundamentals.md)** — `Reactive.Reference<T>` and `.Value`,
  the `[Reactive]` Roslyn source generator that replaces Vue's `reactive(obj)`, the `VUER1001`–
  `VUER1004` diagnostics, and `ReactiveList<T>`/`ReactiveDictionary<TKey,TValue>`/`ReactiveSet<T>`.
- **[Computed Properties](computed.md)** — `Reactive.Computed<T>` with and without a setter,
  `IsWritable`, subscriber-driven cleanup, and the three read-only shapes that fail in two different
  ways.
- **[Template Syntax](template-syntax.md)** — interpolation and `v-bind`, the C#-expression rule and
  the global allow-list, identifier rewriting through `_ctx.`, class and style bindings, `v-pre` and
  `v-once`.
- **[Conditional & List Rendering](conditional-and-list.md)** — `v-if`/`v-else-if`/`v-else`, `v-for`
  in both `in` and `of` spellings, `:key`, and the true longest-increasing-subsequence diff that keys
  unlock.
- **[Event Handling](event-handling.md)** — `v-on` and `@`, the full modifier set, the `BrowserEvent`
  payload, and the two silent-failure traps: unsupported handler delegate shapes and unrecognized
  modifier names.
- **[Form Input Bindings](form-bindings.md)** — `v-model` across text, checkbox, radio, select and
  dynamic `:type` inputs, plus component `v-model` as a `modelValue` prop and an
  `onUpdate:modelValue` handler. **Partial:** the runtime directives are implemented, but the
  compiler does not yet emit the carrier they read.
- **[Watchers](watchers.md)** — `ViuWatch.Watch` and `ViuWatch.WatchEffect` (the API you call inside
  `Setup`), every source overload, `WatchOptions` and `WatchHandle`, and the flush-mode trap:
  `WatchOptions.Flush` itself defaults to `WatchFlushMode.Sync`, so passing an options object
  without setting `Flush` opts you out of the `Pre` timing `ViuWatch` otherwise supplies. The
  standalone `Reactive.Watch`/`Reactive.WatchEffect` in `Assimalign.Viu.Reactivity` are `Sync` and
  schedulerless by default — that is the real divergence from Vue's `pre`.
- **[Lifecycle Hooks & Template Refs](lifecycle-and-template-refs.md)** — every `Lifecycle` hook with
  its real status, `OnErrorCaptured`'s counter-intuitive `bool` return (`false` **stops**
  propagation — upstream parity, not a divergence), and template refs as `IReference<object?>` or
  `Action<object?>` applied post-flush. **Partial:** `OnActivated`, `OnDeactivated` and
  `OnServerPrefetch` register but are never invoked.

## What this section does not cover

- **Component contract depth** — props and fallthrough attributes, emits, slots, provide/inject and
  dynamic components live in [Components In-Depth](../components/index.md).
- **Reuse mechanisms** — `EffectScope`, composables and custom directives live in
  [Reusability](../reusability/composables.md). There are no mixins, and there never will be.
- **Built-in components** — `Transition` and `TransitionGroup` are
  [implemented](../built-ins/transition.md); `KeepAlive`, `Teleport` and `Suspense` are
  [marker objects that throw](../built-ins/deferred-built-ins.md) when rendered.
- **Anything routing- or store-shaped** — Router, Store, SSR/hydration and DevTools do not exist in
  the codebase. See [Project status](../../roadmap/status.md) before designing around them.
