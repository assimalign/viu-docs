# Reactivity Fundamentals

Refs, the `[Reactive]` source generator, and how Viu tracks state without a JavaScript `Proxy`.

> **Status:** Implemented. See [Project status](../../roadmap/status.md) for area-by-area coverage.

`Assimalign.Viu.Reactivity` is a port of [`@vue/reactivity`](https://vuejs.org/guide/extras/reactivity-in-depth.html)
v3.5 — the same `Dep`/`Sub`/`Link` graph, the same version-based dependency cleanup, the same
global-version fast path for computeds. What changed is the surface, and it changed for one reason:
**C# has no `Proxy` and WebAssembly forbids reflection.** Vue's two proxy-driven halves therefore
split apart in Viu:

- **Refs stay refs** — `Reactive.Reference<T>` is a direct port of [`ref()`](https://vuejs.org/api/reactivity-core.html#ref),
  and it is the primary reactivity primitive in Viu. Reach for it first.
- **Object reactivity moves to compile time** — there is no runtime `reactive(obj)` function.
  You annotate a `partial class` with `[Reactive]` and a Roslyn source generator compiles
  per-property dependency tracking into it.
- **Collections become real types** — Vue's proxied `Array`/`Map`/`Set` become `ReactiveList<T>`,
  `ReactiveDictionary<TKey, TValue>`, and `ReactiveSet<T>`.

Everything is fronted by the static `Reactive` class, whose members are PascalCase, spelled-out
renames of Vue's camelCase functions. See [Differences from Vue 3](../../roadmap/vue-differences.md)
for the complete naming map.

> **About the examples on this page.** The behavioral snippets are lifted from
> `Assimalign.Viu.Reactivity`'s own test suite, so they assert with
> [Shouldly](https://docs.shouldly.org/) (`ShouldBe`, `ShouldBeTrue`, `ShouldBeSameAs`,
> `ShouldNotBeNull`). To run them yourself, add `using Shouldly;` alongside the `using` directives
> shown. Snippets that are statements only are meant to sit inside a method body.

## Refs

`Reactive.Reference<T>(value)` creates a ref and returns a `Reference<T>`. You read and write it
through `.Value` — capital `V`, the C# counterpart of Vue's `.value`.

```csharp
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(0);

count.Value.ShouldBe(0);
count.Value = 7;
count.Value.ShouldBe(7);
```

A ref on its own is just a cell. It becomes reactive when something *subscribes* to it — an effect,
a computed, a watcher, or a component's render function. Reading `.Value` inside an active
subscriber establishes a dependency; writing a *different* value notifies every subscriber.

```csharp
var count = Reactive.Reference(1);
var runs = 0;
var seen = 0;

Reactive.Effect(() =>
{
    runs++;
    seen = count.Value;   // tracked read -> this effect now depends on `count`
});

runs.ShouldBe(1);         // Reactive.Effect runs the action immediately
seen.ShouldBe(1);

count.Value = 7;
runs.ShouldBe(2);
seen.ShouldBe(7);
```

Dependencies are re-collected on every run, so an abandoned branch stops notifying:

```csharp
var flag = Reactive.Reference(true);
var a = Reactive.Reference(1);
var b = Reactive.Reference(10);
var runs = 0;

Reactive.Effect(() =>
{
    runs++;
    _ = flag.Value ? a.Value : b.Value;
});
runs.ShouldBe(1);

a.Value = 2;
runs.ShouldBe(2);

b.Value = 11;   // while on the `a` branch, `b` is not a dependency
runs.ShouldBe(2);

flag.Value = false;
runs.ShouldBe(3);

a.Value = 3;    // abandoned branch: `a` no longer notifies
runs.ShouldBe(3);
```

### The names

This is the single most common stumbling block for a reader arriving from Vue, so it is worth
stating flatly:

- **There is no type named `Ref` anywhere in the library** — the ref types are `Reference<T>`,
  `ShallowReference<T>`, and `CustomReference<T>`. Not `Ref<T>`, `ShallowRef<T>`, `CustomRef<T>`.
- **The factory method shares its name with the type it returns** — `Reactive.Reference<T>(T)` is
  the method (Vue's `ref()`), `Reference<T>` is the class it constructs. The same shadowing applies
  to `Reactive.EffectScope(bool)` versus the `EffectScope` type.
- **`.value` becomes `.Value`** — everywhere, on every ref-like type including `Computed<T>`.

| Vue | Viu | Kind |
| --- | --- | --- |
| [`ref()`](https://vuejs.org/api/reactivity-core.html#ref) | `Reactive.Reference<T>(T)` | returns `Reference<T>` |
| [`shallowRef()`](https://vuejs.org/api/reactivity-advanced.html#shallowref) | `Reactive.ShallowReference<T>(T)` | returns `ShallowReference<T>` |
| [`customRef()`](https://vuejs.org/api/reactivity-advanced.html#customref) | `Reactive.CustomReference<T>(CustomReferenceFactory<T>)` | returns `CustomReference<T>` |
| [`computed()`](https://vuejs.org/api/reactivity-core.html#computed) | `Reactive.Computed<T>(Func<T>, Action<T>?)` | returns `Computed<T>` |
| [`triggerRef()`](https://vuejs.org/api/reactivity-advanced.html#triggerref) | `Reactive.TriggerReference(IReference)` | method |
| [`unref()`](https://vuejs.org/api/reactivity-utilities.html#unref) | `Reactive.Unref(...)` | 6 overloads |
| [`toRef()`](https://vuejs.org/api/reactivity-utilities.html#toref) | `Reactive.ToRef<T>(Func<T>, Action<T>?)` | delegate form only; returns `IReference<T>` |
| [`toRaw()`](https://vuejs.org/api/reactivity-advanced.html#toraw) | `Reactive.ToRaw(...)` | 4 overloads |
| [`markRaw()`](https://vuejs.org/api/reactivity-advanced.html#markraw) | `Reactive.MarkRaw<T>(T)` | method |
| [`isRef()`](https://vuejs.org/api/reactivity-utilities.html#isref) / `isReactive()` / `isReadonly()` | `Reactive.IsRef` / `Reactive.IsReactive` / `Reactive.IsReadonly` | methods |

### Refs in a component

`IComponentDefinition.Setup` runs exactly once per instance and *returns* the render function. State
lives in refs the returned closure captures — that closure is the proxy-free realization of Vue's
state object. See [Components](components.md) for the full contract.

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
        // Runs once. Everything below is captured by the render closure.
        var count = Reactive.Reference(0);
        var doubled = Reactive.Computed(() => count.Value * 2);

        // Runs on every update, re-reading .Value and re-tracking as it goes.
        return () => VirtualNodeFactory.Element(
            "div",
            VirtualNodeFactory.Element("p", $"{count.Value} doubled is {doubled.Value}"),
            VirtualNodeFactory.Element(
                "button",
                VirtualNodeFactory.Properties(("onClick", new Action(() => count.Value++))),
                "Increment"));
    }
}
```

In a `.viu` single-file component the compiler inserts `.Value` for you in both read and write
positions, so the template says `count` and `count++` where the C# says `count.Value` and
`count.Value++`:

```viu
@template {
    <p>Count: {{ count }}</p>
    <button @click="count++">Increment</button>
}

@script {
    using Assimalign.Viu.Reactivity;

    private readonly Reference<int> count = Reactive.Reference(0);
}
```

A field or property typed `Reference<>`, `ShallowReference<>`, `CustomReference<>`, `Computed<>`, or
`IReference<>` is classified as a reference binding and unwrapped; anything else is passed through
untouched. See [Template Syntax](template-syntax.md) and
[Single-File Components](../scaling-up/single-file-components.md).

### Change detection uses `EqualityComparer<T>.Default`

Writing a value the ref already holds does not trigger. The comparison is
`EqualityComparer<T>.Default`, **not** JavaScript's `Object.is` — a deliberate .NET divergence:

```csharp
var count = Reactive.Reference(5);
var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = count.Value;
});
runs.ShouldBe(1);

count.Value = 5;   // equal value: no trigger
runs.ShouldBe(1);

// Like Object.is, NaN is self-equal.
var number = Reactive.Reference(double.NaN);
var numberRuns = 0;
Reactive.Effect(() =>
{
    numberRuns++;
    _ = number.Value;
});
number.Value = double.NaN;
numberRuns.ShouldBe(1);
```

The one behavioral difference from `Object.is`: **`+0.0` and `-0.0` compare equal** under
`EqualityComparer<double>.Default`, where `Object.is` distinguishes them. There is no way to inject a
custom `IEqualityComparer<T>` — see [Not yet implemented](#not-yet-implemented).

### Shallow refs

`ShallowReference<T>` is the port of [`shallowRef()`](https://vuejs.org/api/reactivity-advanced.html#shallowref):
only *replacement* of `.Value` triggers. Mutating the held object in place notifies nobody, and you
force a notification with `Reactive.TriggerReference`.

```csharp
var list = Reactive.ShallowReference(new List<int> { 1 });
var runs = 0;
var lastCount = 0;
Reactive.Effect(() =>
{
    runs++;
    lastCount = list.Value.Count;
});
runs.ShouldBe(1);

list.Value.Add(2);              // in-place mutation: nothing notified
runs.ShouldBe(1);

Reactive.TriggerReference(list); // force-notify regardless of equality
runs.ShouldBe(2);
lastCount.ShouldBe(2);
```

`Reactive.TriggerReference` works on any ref that owns a dependency — `Reference<T>`,
`ShallowReference<T>`, `CustomReference<T>`, and `Computed<T>` (upstream parity). It is a silent
no-op on an `Reactive.ToRef` accessor ref, which owns no dependency of its own.

### Custom refs

`Reactive.CustomReference<T>` takes a `CustomReferenceFactory<T>` — a delegate that receives `track`
and `trigger` actions bound to this ref's dependency and returns a getter/setter tuple. The ref does
no tracking, triggering, or change detection of its own; you own all three. Here is Vue's canonical
debounced ref, with a manual flush standing in for the timer:

```csharp
Action? flush = null;
var backing = 0;

var debounced = Reactive.CustomReference<int>((track, trigger) => (
    Get: () =>
    {
        track();
        return backing;
    },
    Set: value =>
    {
        backing = value;
        flush = trigger;   // defer the notification
    }));

var runs = 0;
var seen = -1;
Reactive.Effect(() =>
{
    runs++;
    seen = debounced.Value;
});
runs.ShouldBe(1);

debounced.Value = 5;
runs.ShouldBe(1);   // deferred: no trigger yet

flush!();
runs.ShouldBe(2);
seen.ShouldBe(5);
```

## Reactive objects: the `[Reactive]` source generator

Vue's [`reactive()`](https://vuejs.org/api/reactivity-core.html#reactive) wraps an object in a
`Proxy` at runtime. Viu cannot, so it does the same job at compile time. You mark a `partial class`
with `[Reactive]` and declare its reactive members as `partial` properties; the
`Assimalign.Viu.Reactivity.Generators` incremental generator emits the instrumented implementation.

```csharp
using Assimalign.Viu.Reactivity;

namespace MyApp;

[Reactive]
public partial class TodoItem
{
    public partial string Title { get; set; }

    public partial bool Done { get; set; }
}
```

The rest of this page uses three shapes, declared here once. They are the same shapes the library's
test suite uses, so every snippet below is runnable against them:

```csharp
using Assimalign.Viu.Reactivity;

namespace MyApp;

[Reactive]
public partial class ReactivePerson
{
    public partial string Name { get; set; }

    public partial int Age { get; set; }
}

[Reactive]
public partial class ReactiveOrder
{
    public partial ReactivePerson Customer { get; set; }

    public partial int Total { get; set; }
}

[ShallowReactive]
public partial class ShallowBox
{
    public partial ReactivePerson Content { get; set; }

    public partial int Version { get; set; }
}
```

Tracking is **per property**, exactly as Vue's per-key tracking is:

```csharp
var person = new ReactivePerson { Name = "Ada", Age = 30 };
var runs = 0;
string? seen = null;

Reactive.Effect(() =>
{
    runs++;
    seen = person.Name;
});
runs.ShouldBe(1);
seen.ShouldBe("Ada");

person.Age = 99;      // the effect read only Name: no re-run
runs.ShouldBe(1);

person.Name = "Grace";
runs.ShouldBe(2);

person.Name = "Grace"; // equal value (EqualityComparer<string>.Default): no trigger
runs.ShouldBe(2);
```

### Generator requirements

The generator is strict, and its rules are worth internalizing before you hit a diagnostic:

- **Must be a `partial class`** — `[ReactiveAttribute]` and `[ShallowReactiveAttribute]` are declared
  `AttributeTargets.Class`. Structs, records, and interfaces are not supported.
- **Reactive members must be `partial` properties** — with both a getter and a **non-init** setter.
- **Fields are never made reactive** — a plain field is simply ignored. There is no diagnostic for it.
- **C# partial-property support is required** — the generator reads whatever language version the
  consuming compilation sets; the repo compiles with `LangVersion=preview`, and the generator's own
  test harness parses at `LanguageVersion.Preview`.
- **Nested types are handled** — containing types are re-declared `partial` in the emitted file.

### Diagnostics

| ID | Severity | Meaning | Effect on generation |
| --- | --- | --- | --- |
| `VUER1001` | Error | The attributed type is not declared `partial`. | Aborts generation for that type. |
| `VUER1002` | Error | The attributed type is `static`; reactive objects must be instantiable. | Aborts generation for that type. |
| `VUER1003` | Warning | A reactive partial property is get-only, set-only, or init-only. | That property is skipped; the rest of the class still generates. |
| `VUER1004` | Error | The type carries both `[Reactive]` and `[ShallowReactive]`. | Emits no source at all for that type. |

`VUER1004` is reported exactly once, by the deep pass; the shallow pass stays silent. No code-fix
providers exist for any of the four. See [Compiler Diagnostics](../../api/diagnostics.md).

### What the generator emits

For the `TodoItem` above, the generator writes `MyApp.TodoItem.Reactive.g.cs` containing a
`Dependency` cell and a raw backing field per property, plus the instrumented accessors:

```csharp
public partial class TodoItem : global::Assimalign.Viu.Reactivity.IReactiveObject
{
    private global::Assimalign.Viu.Reactivity.Dependency __TitleDependency = new global::Assimalign.Viu.Reactivity.Dependency();
    private string __TitleValue = default!;

    public partial string Title
    {
        get
        {
            this.__TitleDependency.Track();
            return this.__TitleValue;
        }
        set
        {
            if (!global::System.Collections.Generic.EqualityComparer<string>.Default.Equals(this.__TitleValue, value))
            {
                this.__TitleValue = value;
                this.__TitleDependency.Trigger();
            }
        }
    }

    // ... plus IReactiveObject.ToRaw(), IReactiveObject.GetDependency(string),
    //     IReactiveTraversable.Traverse(...), ToReferences(), and ToRawValues().
}
```

Two consequences follow directly from that shape:

- **`__{Property}Value` and `__{Property}Dependency` are reserved names** — a hand-written member with
  either name collides with the generated one.
- **`Dependency.Track()` and `Dependency.Trigger()` are public** — they are exactly the API the
  generator emits into your class, which makes them a supported extension point for hand-written
  reactive sources. Everything else on `Dependency` is internal.

`IReactiveObject.ToRaw()` and `IReactiveObject.GetDependency(string)` are emitted as **explicit**
interface implementations, so you must cast to reach them. Property names are ordinal and
case-sensitive; an unknown name returns `null`:

```csharp
var person = new ReactivePerson { Name = "Ada" };
var reactive = (IReactiveObject)person;

reactive.GetDependency("Name").ShouldNotBeNull();
reactive.GetDependency("DoesNotExist").ShouldBeNull();
```

### Shallow and read-only variants

| Attribute | Vue counterpart | Behavior |
| --- | --- | --- |
| `[Reactive]` | [`reactive()`](https://vuejs.org/api/reactivity-core.html#reactive) | Each property tracks and triggers; deep traversal descends into reactive members. |
| `[ShallowReactive]` | [`shallowReactive()`](https://vuejs.org/api/reactivity-advanced.html#shallowreactive) | Each property still tracks and triggers, but the emitted `Traverse` reads properties without descending — deep traversal stops at the root. |
| `[Reactive(Readonly = true)]` | [`readonly()`](https://vuejs.org/api/reactivity-core.html#readonly) | Reads still track; setters emit a dev-mode warning and neither mutate nor trigger. |
| `[ShallowReactive(Readonly = true)]` | [`shallowReadonly()`](https://vuejs.org/api/reactivity-advanced.html#shallowreadonly) | The shallow traversal rule plus the read-only setter rule. |

Note carefully that **the read-only setter does not throw** — it is a warned no-op. This is one of
three read-only shapes in Viu with two different failure modes, covered under
[Read-only shapes fail in two different ways](#read-only-shapes-fail-in-two-different-ways) below.

The shallow variant is easiest to see against the deep one:

```csharp
// [Reactive]: watching the object is deep by default.
var order = new ReactiveOrder { Customer = new ReactivePerson { Name = "A" }, Total = 10 };
var runs = 0;
Reactive.Watch(order, (_, _, _) => runs++);

order.Total = 20;           // root property
runs.ShouldBe(1);
order.Customer.Name = "B";  // nested reactive member: deep traversal subscribed to it
runs.ShouldBe(2);

// [ShallowReactive]: traversal stops at the root.
var box = new ShallowBox { Content = new ReactivePerson { Name = "A" }, Version = 1 };
var boxRuns = 0;
Reactive.Watch(box, (_, _, _) => boxRuns++);

box.Version = 2;
boxRuns.ShouldBe(1);
box.Content.Name = "B";     // nested member: no re-run
boxRuns.ShouldBe(1);
box.Content = new ReactivePerson { Name = "C" };  // slot replacement does trigger
boxRuns.ShouldBe(2);
```

### `ToReferences()` — the `toRefs` counterpart

Every `[Reactive]`/`[ShallowReactive]` class with at least one reactive property gets a generated
`ToReferences()` method returning a nested `readonly struct ReactiveReferences` with one
`IReference<T>` property per reactive property. This is the **only** counterpart to Vue's
[`toRefs()`](https://vuejs.org/api/reactivity-utilities.html#torefs) — there is no
`Reactive.ToRefs(obj)` static method, and no string-key `toRef(obj, "key")` form. Both were omitted
deliberately, because both would require reflection.

Each projection is a write-through ref built from `Reactive.ToRef`, so the link runs in both
directions:

```csharp
var person = new ReactivePerson { Name = "Ada", Age = 30 };
var references = person.ToReferences();

Reactive.IsRef(references.Name).ShouldBeTrue();
references.Name.Value.ShouldBe("Ada");

var runs = 0;
string? seen = null;
Reactive.Effect(() =>
{
    runs++;
    seen = references.Name.Value;
});

// Object -> ref: a reader of the ref re-runs when the object property changes.
person.Name = "Grace";
runs.ShouldBe(2);
seen.ShouldBe("Grace");

// Ref -> object: writing the ref mutates the object and triggers its dependency.
references.Name.Value = "Hopper";
person.Name.ShouldBe("Hopper");
runs.ShouldBe(3);

// The property's equality cutoff still applies.
references.Name.Value = "Hopper";
runs.ShouldBe(3);
```

`ToReferences()` is how you hand a caller destructurable, individually-passable handles onto a
reactive object's properties — the pattern [composables](../reusability/composables.md) use to return
state.

### `ToRawValues()` — the genuinely untracked view

Also generated when the class has at least one reactive property: `ToRawValues()`, returning a nested
`readonly struct RawValues` that reads and writes the raw backing fields directly. Reads do not
track, writes do not trigger, and both hit the *same* state the instrumented properties use.

```csharp
var person = new ReactivePerson { Name = "Ada", Age = 30 };
var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = person.Name;
});
runs.ShouldBe(1);

var raw = person.ToRawValues();
raw.Name = "Grace";   // mutates the shared backing field without triggering
runs.ShouldBe(1);
person.ToRawValues().Name.ShouldBe("Grace");

// The instrumented path is intact — and its equality guard now compares against "Grace".
person.Name = "Grace";
runs.ShouldBe(1);
person.Name = "Hopper";
runs.ShouldBe(2);
```

`ToRawValues()` is emitted for `Readonly = true` classes too, matching upstream's
`toRaw(readonly(obj))` returning the mutable target. That makes it a write escape hatch around
`Readonly = true` — intended, but worth knowing before you rely on read-only as a guarantee.

## Two behavioral truths that will bite you

Everything above is API surface. These two are semantics, and they are the places where a mental
model carried over from Vue produces wrong predictions.

### There is no identity-swapping proxy

In Vue, `reactive(obj)` returns a *different* object — the proxy — and `toRaw(proxy)` returns the
original. Viu has no such split. **A `[Reactive]` instance IS the reactive object.**

```csharp
var person = new ReactivePerson { Name = "Ada" };

// The instance is its own raw. Reads through the result STILL TRACK.
Reactive.ToRaw(person).ShouldBeSameAs(person);
((IReactiveObject)person).ToRaw().ShouldBeSameAs(person);
```

So `Reactive.ToRaw(obj)` on a generated object gives you no escape from tracking at all. The only
genuinely untracked view of a generated object is `ToRawValues()`.

Collections are the exception: `Reactive.ToRaw` has dedicated overloads for `ReactiveList<T>`,
`ReactiveDictionary<TKey, TValue>`, and `ReactiveSet<T>` that return the live underlying `List<T>`,
`Dictionary<,>`, and `HashSet<T>`. Reads off those do not track and writes do not trigger.

```csharp
var list = new ReactiveList<int> { 1, 2 };
var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = list.Count;
});
runs.ShouldBe(1);

var raw = Reactive.ToRaw(list);
raw.Add(3);      // same storage, no trigger
runs.ShouldBe(1);

list.Add(4);     // reactive mutation still triggers
runs.ShouldBe(2);
```

### Deep traversal is reflection-free, so plain objects are leaves

Vue's `traverse()` enumerates every own key of every reachable object. Viu's `ReactiveTraversal`
cannot — reflection is off the table under AOT. It descends only through two things:

- **`IReference` cells** — unwrapping `.Value`, costing one depth level.
- **`IReactiveTraversable` values** — generated `[Reactive]` objects (via `IReactiveObject`) and the
  three reactive collections, also costing one depth level.

**Plain CLR objects are leaves.** A deep watch will never see a mutation inside an un-annotated POCO.
This is documented behavior, not a gap:

```csharp
using Assimalign.Viu.Reactivity;

namespace MyApp;

public sealed class Address                 // NOT [Reactive]
{
    public string City { get; set; } = "";
}

[Reactive]
public partial class Customer
{
    public partial Address Home { get; set; }
}
```

```csharp
var customer = new Customer { Home = new Address { City = "Paris" } };
var runs = 0;
Reactive.Watch(customer, (_, _, _) => runs++);

customer.Home.City = "Lyon";                // Address is a leaf: nothing observed this
runs.ShouldBe(0);

customer.Home = new Address { City = "Nice" };  // replacing the slot DOES trigger
runs.ShouldBe(1);
```

The fix is to annotate `Address` with `[Reactive]` and make `City` a partial property. If you cannot
change the type, hold it in a `ShallowReference<T>` and call `Reactive.TriggerReference` after
mutating it.

Traversal depth is bounded by `WatchOptions.DeepDepth`, cycles are broken by reference identity, and
`Reactive.MarkRaw`'d objects are skipped entirely:

```csharp
var order = new ReactiveOrder
{
    Customer = Reactive.MarkRaw(new ReactivePerson { Name = "A" }),
    Total = 10,
};
var runs = 0;
Reactive.Watch(order, (_, _, _) => runs++);

order.Total = 11;
runs.ShouldBe(1);

order.Customer.Name = "B";   // marked raw -> skipped by traversal
runs.ShouldBe(1);
```

`Reactive.MarkRaw` records the instance in a `ConditionalWeakTable` by reference identity — no
reflection, and the table never keeps the object alive. It is **permanent**: there is no unmark. A
marked object also reports `Reactive.IsReactive(...) == false` even when it is a generated
`IReactiveObject`.

## Read-only shapes fail in two different ways

Viu has three read-only shapes and two failure modes, and describing them uniformly would be wrong:

| Shape | On write | Vue counterpart |
| --- | --- | --- |
| Getter-only `Computed<T>` | **Throws** `NotSupportedException("Cannot write to a computed without a setter.")` | [`computed()`](https://vuejs.org/api/reactivity-core.html#computed) with a getter only |
| `Reactive.ToRef(getter)` with no setter | **Silent no-op** with a `Debug.WriteLine` warning | [`toRef()`](https://vuejs.org/api/reactivity-utilities.html#toref) over a read-only source |
| `[Reactive(Readonly = true)]` property | **Silent no-op** with a `Debug.WriteLine` warning | [`readonly()`](https://vuejs.org/api/reactivity-core.html#readonly) |

Because `Debug.WriteLine` is compiled out of a Release build, the two no-op cases are **invisible in
a Release WASM build**. Do not treat a read-only ref or object as an enforcement boundary; treat it
as documentation with a debug-build assist.

```csharp
var person = new ReactivePerson { Name = "Ada", Age = 30 };

// Getter + setter: fully write-through.
var nameRef = Reactive.ToRef(() => person.Name, value => person.Name = value);
nameRef.Value = "Hopper";
person.Name.ShouldBe("Hopper");

// Getter only: the write is a warned no-op. No exception.
var ageRef = Reactive.ToRef(() => person.Age);
ageRef.Value = 99;
person.Age.ShouldBe(30);
```

## Introspection

All three classification helpers are interface checks, so they are O(1) and trim/AOT-safe.

```csharp
Reactive.IsRef(Reactive.Reference(1)).ShouldBeTrue();
Reactive.IsRef(Reactive.Computed(() => 1)).ShouldBeTrue();
Reactive.IsRef(Reactive.ToRef(() => 1)).ShouldBeTrue();
Reactive.IsRef(new ReactivePerson { Name = "A" }).ShouldBeFalse();   // a reactive OBJECT, not a ref
Reactive.IsRef(new ReactiveList<int>()).ShouldBeFalse();

Reactive.IsReactive(new ReactivePerson { Name = "A" }).ShouldBeTrue();
Reactive.IsReactive(new ReactiveList<int>()).ShouldBeTrue();
Reactive.IsReactive(new ShallowBox { Version = 1 }).ShouldBeTrue();  // shallow is still reactive
Reactive.IsReactive(Reactive.Reference(1)).ShouldBeFalse();          // refs are not reactive objects
Reactive.IsReactive(Reactive.Computed(() => 1)).ShouldBeFalse();

Reactive.IsReadonly(Reactive.Computed(() => 1)).ShouldBeTrue();          // no setter
Reactive.IsReadonly(Reactive.Computed(() => 1, _ => { })).ShouldBeFalse(); // writable
Reactive.IsReadonly(new ReactivePerson { Name = "A" }).ShouldBeFalse();
```

`Reactive.Unref` has six overloads: five typed ref overloads that perform a **tracked** read, plus a
generic passthrough `Unref<T>(T value) => value` that returns non-refs unchanged without boxing. The
trap is static typing — a ref whose static type is only `object` binds to the passthrough and comes
back unwrapped. Unwrap through `Unref<T>(IReference<T>)` when the static type is not concrete.

## Reactive collections

`ReactiveList<T>`, `ReactiveDictionary<TKey, TValue>`, and `ReactiveSet<T>` replace Vue's proxied
`Array`, `Map`, and `Set`. Their tracking granularity mirrors upstream precisely — per-index,
per-key, and per-member dependency cells created lazily on a tracked read, alongside an iteration
dependency on each collection, plus a separate length dependency on `ReactiveList<T>` and a separate
key-iteration dependency on `ReactiveDictionary<TKey, TValue>`.

```csharp
var list = new ReactiveList<int>(new[] { 1, 2, 3 });
var indexRuns = 0;
Reactive.Effect(() =>
{
    indexRuns++;
    _ = list[1];      // tracks index 1 only
});

list[0] = 10;         // a different index: no re-run
indexRuns.ShouldBe(1);
list[1] = 20;
indexRuns.ShouldBe(2);
```

One constraint carries over into watching. Collections implement `IReactiveTraversable` but **not**
`IReactiveObject`, so `Reactive.Watch(myReactiveList, callback)` does not compile — the generic
constraint fails. Use the getter overload and opt into `Deep` explicitly:

```csharp
var first = new ReactivePerson { Name = "A" };
var list = new ReactiveList<ReactivePerson> { first };
var runs = 0;

Reactive.Watch(() => list, (_, _, _) => runs++, new WatchOptions { Deep = true });

first.Name = "B";                            // nested reactive element
runs.ShouldBe(1);
list.Add(new ReactivePerson { Name = "C" }); // structural change: the iteration dependency
runs.ShouldBe(2);
```

Full trigger-granularity rules — including the ones that are easy to get wrong, like a dictionary's
`Keys` not re-running on a value replacement — live in
[Reactive Collections](../../api/reactive-collections.md).

## Batching and tracking control

`Reactive.StartBatch()` / `Reactive.EndBatch()` coalesce triggers so several writes produce at most
one run per effect. These are **public** in Viu where they are internal in Vue.

```csharp
var a = Reactive.Reference(1);
var b = Reactive.Reference(2);
var runs = 0;
var sum = 0;
Reactive.Effect(() =>
{
    runs++;
    sum = a.Value + b.Value;
});
runs.ShouldBe(1);

Reactive.StartBatch();
a.Value = 10;
b.Value = 20;
runs.ShouldBe(1);      // deferred while the batch is open
Reactive.EndBatch();

runs.ShouldBe(2);
sum.ShouldBe(30);
```

Nested batches flush only at the outermost `EndBatch`. Calling `EndBatch` with no batch open throws
`InvalidOperationException`, and the failed call does not corrupt the batch depth.

`Reactive.PauseTracking()` / `Reactive.ResetTracking()` suppress dependency collection for a region
of an effect — the port of Vue's `pauseTracking()`/`resetTracking()`:

```csharp
var tracked = Reactive.Reference(1);
var untracked = Reactive.Reference(2);
var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = tracked.Value;
    Reactive.PauseTracking();
    _ = untracked.Value;      // read, but not subscribed to
    Reactive.ResetTracking();
});

untracked.Value = 20;
runs.ShouldBe(1);
tracked.Value = 10;
runs.ShouldBe(2);
```

## Nothing here is thread-safe

Every piece of ambient state in the reactivity engine — the active subscriber, the tracking flag, the
global version, the batch queues, `EffectScope.Current` — is a plain `static` field with no
synchronization and no thread-static or async-local isolation. **This is a design decision, not a
gap.** Viu targets the browser's single-threaded event-loop model, and paying for synchronization on
every dependency `Track()` would be a permanent tax on the hottest path in the framework.

Multi-threaded use is unsupported. The library's own test project disables test parallelization for
exactly this reason.

## Packaging

A project or package reference to `Assimalign.Viu.Reactivity` alone is enough to enable `[Reactive]`.
The generator ships **inside** that package as an analyzer reference. Do not add a separate reference
to `Assimalign.Viu.Reactivity.Generators` — it is an implementation detail of the runtime package.
See [The Viu SDK & Build](../scaling-up/sdk-and-build.md).

## Not yet implemented

Named here so nothing on this page implies more than the codebase delivers. See
[Project status](../../roadmap/status.md).

- **No runtime `reactive(obj)` / `shallowReactive(obj)`** — deep and shallow reactive objects exist
  only through the compile-time `[Reactive]` / `[ShallowReactive]` attributes. There is no way to
  make an arbitrary existing instance reactive at runtime.
- **No runtime `readonly(obj)` / `shallowReadonly(obj)` wrappers** — read-only is decided at compile
  time via `Readonly = true`. You cannot derive a read-only view of an existing mutable object.
- **No `Reactive.ToRefs(obj)`** — the `toRefs` counterpart is the generated instance method
  `ToReferences()` only.
- **No string-key `toRef(obj, "key")`** — deliberately omitted for AOT/trim safety. Only the delegate
  form `Reactive.ToRef<T>(Func<T>, Action<T>?)` exists.
- **No custom `IEqualityComparer<T>` injection** — change detection in `Reference<T>`,
  `ShallowReference<T>`, `Computed<T>`, and generated property setters is hardwired to
  `EqualityComparer<T>.Default`. `ReactiveDictionary<TKey, TValue>` and `ReactiveSet<T>` do accept an
  `IEqualityComparer<TKey>`/`IEqualityComparer<T>` constructor argument, but that governs storage
  lookup, not the value-change cutoff; `ReactiveList<T>` takes no comparer at all.
- **No `unmarkRaw`** — `Reactive.MarkRaw` is permanent and cannot be reversed.
- **No `onTrack` / `onTrigger` debug hooks** — Vue's dev-only debugger callbacks do not exist on
  `ReactiveEffect`, `Computed<T>`, or `WatchOptions`.
- **No generator support for records, structs, or interfaces** — `[Reactive]` is
  `AttributeTargets.Class` only, and fields are never made reactive.
- **No code-fix providers** — `VUER1001`–`VUER1004` report but offer no automatic fix.
- **No thread safety of any kind** — see above; this one is permanent by design.

## Next

- **[Computed Properties](computed.md)** — `Reactive.Computed<T>`, caching, writability, and why a
  computed is never owned by an `EffectScope`.
- **[Watchers](watchers.md)** — `Reactive.Watch` and `ViuWatch.Watch`, and the flush-mode divergence
  you should read before writing your first watcher.
- **[Composables](../reusability/composables.md)** — `EffectScope`, `Reactive.OnScopeDispose`, and
  packaging reactive state for reuse.
- **[Reactivity API: Core](../../api/reactivity-core.md)** and
  **[Utilities & Advanced](../../api/reactivity-utilities.md)** — the complete signature reference.
