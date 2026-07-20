# Reactivity API: Utilities & Advanced

Introspection, ref unwrapping, raw access, tracking control, and the low-level extension points of
`Assimalign.Viu.Reactivity`.

> **Status:** Implemented.

Everything on this page lives in the `Assimalign.Viu.Reactivity` namespace and is reached through the
static `Reactive` facade, the direct counterpart of the utility and advanced sections of
[Vue's reactivity API](https://vuejs.org/api/reactivity-utilities.html). For refs, computeds,
effects, scopes, and watchers see [Reactivity API: Core](reactivity-core.md); for
`ReactiveList<T>`/`ReactiveDictionary<TKey,TValue>`/`ReactiveSet<T>` see
[Reactive Collections](reactive-collections.md).

Three rules apply to every member below and are not repeated in each section:

- **Nothing is thread-safe** — the ambient subscriber, tracking flag, global version, batch queues,
  and current scope are plain static fields with no synchronization. This is a design decision for
  the single-threaded browser event loop, not a gap.
- **Change detection is `EqualityComparer<T>.Default`**, not JavaScript's `Object.is`. Like
  `Object.is`, `NaN` is self-equal; unlike it, `+0.0` and `-0.0` compare equal.
- **No reflection anywhere** — every introspection helper is an interface check, which is what keeps
  the library `IsAotCompatible` and trim-safe.

## Introspection

All three predicates are O(1) interface checks. They are the counterparts of Vue's
[`isRef()`](https://vuejs.org/api/reactivity-utilities.html#isref),
[`isReactive()`](https://vuejs.org/api/reactivity-utilities.html#isreactive), and
[`isReadonly()`](https://vuejs.org/api/reactivity-utilities.html#isreadonly).

```csharp
public static bool IsRef(object? value);
public static bool IsReactive(object? value);
public static bool IsReadonly(object? value);
```

- **`IsRef`** — `value is IReference`. True for `Reference<T>`, `ShallowReference<T>`,
  `CustomReference<T>`, `Computed<T>`, and the projections produced by `Reactive.ToRef` and a
  generated `ToReferences()`.
- **`IsReactive`** — `value is IReactiveTraversable traversable && !RawMarkers.IsMarked(traversable)`
  (`RawMarkers` is an internal type — the check is not callable directly). True for
  source-generated `[Reactive]`/`[ShallowReactive]` objects and for the three reactive collections
  — **unless the instance was passed to `Reactive.MarkRaw`**, which flips this to `false` even for a
  generated `IReactiveObject`.
- **`IsReadonly`** — `value is IReadonlyReactive readonlyReactive && readonlyReactive.IsReadonly`.
  True for a getter-only `Computed<T>` and for a generated `[Reactive(Readonly = true)]` or
  `[ShallowReactive(Readonly = true)]` object. A writable computed returns `false`.

| Value | `IsRef` | `IsReactive` | `IsReadonly` |
| --- | --- | --- | --- |
| `Reactive.Reference(1)` | true | false | false |
| `Reactive.ShallowReference(1)` | true | false | false |
| `Reactive.CustomReference<int>(...)` | true | false | false |
| `Reactive.Computed(() => 1)` | true | false | true |
| `Reactive.Computed(() => 1, _ => { })` | true | false | false |
| `Reactive.ToRef(() => x)` | true | false | false |
| `[Reactive]` instance | false | true | false |
| `[ShallowReactive]` instance | false | true | false |
| `[Reactive(Readonly = true)]` instance | false | true | true |
| `ReactiveList<T>` / `ReactiveDictionary<,>` / `ReactiveSet<T>` | false | true | false |
| any instance after `Reactive.MarkRaw(...)` | unchanged | **false** | unchanged |

```csharp
using System;
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(1);
var doubled = Reactive.Computed(() => count.Value * 2);
var person = new ReactivePerson { Name = "Ada" };
var items = new ReactiveList<int>();

Console.WriteLine(Reactive.IsRef(count));        // True
Console.WriteLine(Reactive.IsRef(person));       // False — generated objects are not refs
Console.WriteLine(Reactive.IsReactive(person));  // True
Console.WriteLine(Reactive.IsReactive(items));   // True — collections are reactive objects
Console.WriteLine(Reactive.IsReactive(count));   // False — a ref is not a reactive object
Console.WriteLine(Reactive.IsReadonly(doubled)); // True — no setter was supplied
```

## Unwrapping — `Reactive.Unref`

The counterpart of Vue's [`unref()`](https://vuejs.org/api/reactivity-utilities.html#unref), spread
across six overloads so that value types are never boxed on the passthrough path.

```csharp
public static T Unref<T>(IReference<T> reference);
public static T Unref<T>(Reference<T> reference);
public static T Unref<T>(ShallowReference<T> reference);
public static T Unref<T>(CustomReference<T> reference);
public static T Unref<T>(Computed<T> reference);
public static T Unref<T>(T value);
```

- **The five ref overloads** — throw `ArgumentNullException` on `null` and perform a **tracked**
  read, so calling `Unref` inside an effect subscribes to the ref exactly as reading `.Value` would.
- **The generic passthrough** — returns its argument unchanged and does not box a struct value.

**The binding trap.** Overload resolution happens at compile time against the *static* type of the
argument. A ref whose static type is only `object` binds to the passthrough and comes back **still
wrapped**:

```csharp
using Assimalign.Viu.Reactivity;

var count = Reactive.Reference(1);

int a = Reactive.Unref(count);                    // 1 — binds Unref<T>(Reference<T>)

IReference<int> typed = count;
int b = Reactive.Unref(typed);                    // 1 — binds Unref<T>(IReference<T>)

int c = Reactive.Unref(42);                       // 42 — binds the passthrough, no boxing

// TRAP: static type is `object`, so the passthrough wins and the REF ITSELF is returned.
object opaque = count;
object d = Reactive.Unref(opaque);                // still a Reference<int>, NOT 1
bool stillARef = Reactive.IsRef(d);               // true

// Fix: give the compiler a typed view of the ref.
int e = Reactive.Unref((IReference<int>)opaque);  // 1
```

Template-generated code never hits this trap — the compiler emits `_unref(...)` calls against
statically known types. It is a hazard only in hand-written glue code that stores refs in
`object`-typed fields, dictionaries, or prop bags.

## `Reactive.ToRef`

The delegate form of Vue's [`toRef()`](https://vuejs.org/api/reactivity-utilities.html#toref).

```csharp
public static IReference<T> ToRef<T>(Func<T> getter, Action<T>? setter = null);
```

Reading the returned ref invokes the getter, so it tracks whatever the getter reads; writing routes
through the setter, so it triggers whatever the setter mutates. Throws `ArgumentNullException` when
`getter` is null.

```csharp
using Assimalign.Viu.Reactivity;

var person = new ReactivePerson { Name = "Ada", Age = 30 };

// A write-through ref over a property of a generated reactive object.
var nameRef = Reactive.ToRef(() => person.Name, value => person.Name = value);

var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = nameRef.Value;
});

person.Name = "Grace";       // object -> ref: the reader re-runs. runs == 2
nameRef.Value = "Hopper";    // ref -> object: person.Name is now "Hopper". runs == 3

// Getter-only: the write is a WARNED NO-OP. No exception is thrown.
var ageRef = Reactive.ToRef(() => person.Age);
ageRef.Value = 99;           // person.Age is still 30
```

> **Read-only failure modes are not uniform.** Writing a getter-only `Computed<T>` throws
> `NotSupportedException("Cannot write to a computed without a setter.")`. Writing a getter-only
> `Reactive.ToRef` ref is a silent no-op with only a `Debug.WriteLine` warning. A
> `[Reactive(Readonly = true)]` setter is likewise a warned no-op. Three read-only shapes, two
> different failure modes — never describe them as one.

There is **no string-key form** (`toRef(obj, "key")`) and **no standalone `Reactive.ToRefs(obj)`**.
Both would require reflection, so per-property write-through refs come only from a generated
object's `ToReferences()`, described [below](#generated-members).

## Raw access — `ToRaw` and `MarkRaw`

### `Reactive.ToRaw`

```csharp
public static T ToRaw<T>(T value);
public static List<T> ToRaw<T>(ReactiveList<T> list);
public static Dictionary<TKey, TValue> ToRaw<TKey, TValue>(ReactiveDictionary<TKey, TValue> dictionary)
    where TKey : notnull;
public static HashSet<T> ToRaw<T>(ReactiveSet<T> set);
```

The counterpart of Vue's [`toRaw()`](https://vuejs.org/api/reactivity-utilities.html#toraw), with
one critical asymmetry, because Viu has no identity-swapping `Proxy`:

| Argument | Returns | Reads track? | Writes trigger? |
| --- | --- | --- | --- |
| a generated `[Reactive]` object | **the same instance** | **yes** | **yes** |
| `ReactiveList<T>` | the underlying `List<T>` | no | no |
| `ReactiveDictionary<TKey,TValue>` | the underlying `Dictionary<TKey,TValue>` | no | no |
| `ReactiveSet<T>` | the underlying `HashSet<T>` | no | no |
| anything else | the same instance | n/a | n/a |

For a generated object, `ToRaw` is effectively an identity function — the instance *is* the reactive
object. The only genuinely untracked view of a generated object is its emitted `ToRawValues()`.

```csharp
using Assimalign.Viu.Reactivity;

var list = new ReactiveList<int> { 1, 2 };
var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = list.Count;
});                                    // runs == 1

var raw = Reactive.ToRaw(list);        // the live List<int>, shared storage
raw.Add(3);                            // mutates the same storage, no trigger. runs == 1
list.Add(4);                           // reactive path. runs == 2

// A generated object is its own raw — and reads through it STILL track.
var person = new ReactivePerson { Name = "Ada" };
bool sameInstance = ReferenceEquals(Reactive.ToRaw(person), person);   // true
```

### `Reactive.MarkRaw`

```csharp
public static T MarkRaw<T>(T value) where T : class;
```

The counterpart of Vue's [`markRaw()`](https://vuejs.org/api/reactivity-utilities.html#markraw).
The instance is recorded in a `ConditionalWeakTable` by reference identity — no reflection, and the
table never keeps the object alive. A marked object is **skipped entirely by deep-watch traversal**
and reports `IsReactive == false`. The same instance is returned, so the call composes inline.

Marking is **permanent**. There is no `unmarkRaw` and no way to reverse it.

```csharp
using Assimalign.Viu.Reactivity;

// The nested customer is marked raw: deep traversal skips it.
var order = new ReactiveOrder
{
    Customer = Reactive.MarkRaw(new ReactivePerson { Name = "A" }),
    Total = 10,
};

var runs = 0;
Reactive.Watch(order, (_, _, _) => runs++);   // the IReactiveObject overload is deep by default

order.Total = 11;             // root property. runs == 1
order.Customer.Name = "B";    // marked -> skipped by traversal. runs is STILL 1
```

## Tracking control

### `TriggerReference`

```csharp
public static void TriggerReference(IReference reference);
```

The counterpart of Vue's
[`triggerRef()`](https://vuejs.org/api/reactivity-utilities.html#triggerref). Force-notifies a ref's
subscribers regardless of value equality. It works on any ref that owns a `Dependency` —
`Reference<T>`, `ShallowReference<T>`, `CustomReference<T>`, **and `Computed<T>`** (upstream parity).
The `IReference<T>` returned by `Reactive.ToRef` is backed by an internal accessor ref that owns no
dependency of its own — tracking and triggering flow entirely through the delegates — so
`TriggerReference` is a silent no-op for it. Throws `ArgumentNullException` on `null`.

```csharp
using System.Collections.Generic;
using Assimalign.Viu.Reactivity;

var list = Reactive.ShallowReference(new List<int> { 1 });
var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = list.Value.Count;
});                              // runs == 1

list.Value.Add(2);               // in-place mutation of a shallow ref's payload. runs == 1
Reactive.TriggerReference(list); // force the notification. runs == 2
```

### `PauseTracking` / `ResetTracking`

```csharp
public static void PauseTracking();
public static void ResetTracking();
```

Counterparts of Vue's internal `pauseTracking()`/`resetTracking()`, public in Viu. Backed by a
`Stack<bool>`; `ResetTracking` re-enables tracking when the stack is empty. Use them to read
reactive state inside an effect without subscribing to it.

```csharp
using Assimalign.Viu.Reactivity;

var tracked = Reactive.Reference(1);
var untracked = Reactive.Reference(2);
var runs = 0;

Reactive.Effect(() =>
{
    runs++;
    _ = tracked.Value;
    Reactive.PauseTracking();
    _ = untracked.Value;          // read, but not subscribed to
    Reactive.ResetTracking();
});                               // runs == 1

untracked.Value = 20;             // runs == 1 — never became a dependency
tracked.Value = 10;               // runs == 2
```

### `StartBatch` / `EndBatch`

```csharp
public static void StartBatch();
public static void EndBatch();
```

Opens and closes a batch: triggers are queued and coalesced until the outermost `EndBatch`, so
multiple writes produce at most one run per effect. These are `internal` in Vue and **public** in
Viu. `EndBatch` with no batch open throws
`InvalidOperationException("EndBatch called without a matching StartBatch.")`, and the failed call
does **not** corrupt the batch depth — a regression test pins that.

```csharp
using Assimalign.Viu.Reactivity;

var a = Reactive.Reference(1);
var b = Reactive.Reference(2);
var runs = 0;
var sum = 0;

Reactive.Effect(() =>
{
    runs++;
    sum = a.Value + b.Value;
});                        // runs == 1

Reactive.StartBatch();
a.Value = 10;
b.Value = 20;              // runs == 1 — deferred while the batch is open
Reactive.EndBatch();       // runs == 2, sum == 30
```

Nested batches flush only when the outermost one ends. Always pair the calls in a `try`/`finally` if
the batched work can throw.

## The dependency engine

These are the low-level pieces the rest of the library is built from. They are the C# port of Vue
3.5's [advanced reactivity internals](https://vuejs.org/api/reactivity-advanced.html), renamed:
`Dep` becomes `Dependency`, `Sub` becomes `Subscriber`, and `traverse()` becomes
`ReactiveTraversal.Visit`.

### `Dependency`

```csharp
public sealed class Dependency
{
    public void Track();
    public void Trigger();
}
```

A single reactive dependency cell. **`Track()` and `Trigger()` are the entire public surface** —
`Version`, `ActiveLink`, `Subscribers`, `Computed`, `SubscriberCount`, `Map`, `Key`, and `Notify()`
are all `internal` and visible only to the test assembly.

`Track()` links the ambient active subscriber, deduplicating via link versions. It is a no-op when
there is no active subscriber, when tracking is paused, or when the subscriber is this dependency's
own computed. `Trigger()` bumps this dependency's version *and* the global version, then notifies
subscribers inside a batch.

This pair is **exactly what the `[Reactive]` generator emits into your classes**, which makes it a
supported extension point for hand-written reactive sources:

```csharp
using Assimalign.Viu.Reactivity;

/// <summary>A hand-written reactive cell, equivalent to what the generator emits per property.</summary>
public sealed class ReactiveCounter
{
    private readonly Dependency _dependency = new();
    private int _value;

    public int Value
    {
        get
        {
            _dependency.Track();
            return _value;
        }
        set
        {
            if (_value != value)
            {
                _value = value;
                _dependency.Trigger();
            }
        }
    }
}
```

Prefer `[Reactive]` for ordinary state; reach for `Dependency` directly only when the state lives
somewhere the generator cannot see — an external cache, a computed index, a bridge to a non-reactive
source.

### `Subscriber`

```csharp
public abstract class Subscriber
{
    private protected Subscriber();
}
```

The base class for everything that subscribes to `Dependency` cells: `ReactiveEffect` and
`Computed<T>`. It is public **only** because those two derive from it. It exposes no public members
and its `private protected` constructor makes it un-subclassable outside the assembly, by design.
Its fields (`Dependencies`, `DependenciesTail`, `Flags`, `NextBatched`) are internal plain fields
rather than interface properties so hot paths use direct field access instead of interface stubs.

Treat `Subscriber` as an opaque token in a signature. There is nothing to call on it.

### `ReactiveTraversal`

```csharp
public sealed class ReactiveTraversal
{
    public ReactiveTraversal(int depth);
    public int Depth { get; }
    public void Visit(object? value);
}
```

The port of Vue 3.5's `traverse()`, and what a deep watch uses to subscribe to a whole value graph.
Recursion is **reflection-free**: it descends only through `IReference` cells (unwrapping `.Value`,
costing one depth level) and `IReactiveTraversable` values (also one level).

- **Plain CLR objects are leaves** — a deliberate divergence from Vue, which enumerates every own
  key. A deep watch will never see a mutation inside an un-annotated POCO.
- **`MarkRaw`-marked objects are skipped** entirely.
- **Cycles are broken by reference identity** using a `HashSet<object>` with
  `ReferenceEqualityComparer.Instance`.
- **`depth <= 0` visits nothing.** Pass `int.MaxValue` for unbounded traversal.
- **Construct one per traversal.** An instance is not reusable across traversals.

You normally reach this indirectly through `WatchOptions.Deep` / `WatchOptions.DeepDepth`. Call it
directly only when implementing `IReactiveTraversable` on a custom container.

## Reactive object interfaces

### `IReactiveObject`

```csharp
public interface IReactiveObject : IReactiveTraversable
{
    object ToRaw();
    Dependency? GetDependency(string propertyName);
}
```

The contract every source-generated `[Reactive]`/`[ShallowReactive]` class implements — the compiled
substitute for the object returned by Vue's
[`reactive()`](https://vuejs.org/api/reactivity-core.html#reactive).

Both members are emitted as **explicit interface implementations**, so consumers must cast. Property
names are matched **ordinal and case-sensitive**; an unknown name returns `null`.

```csharp
using Assimalign.Viu.Reactivity;

var person = new ReactivePerson { Name = "Ada" };
var reactive = (IReactiveObject)person;          // the cast is required

bool same = ReferenceEquals(reactive.ToRaw(), person);   // true — no identity-swapping wrapper
Dependency? name = reactive.GetDependency("Name");       // non-null
Dependency? missing = reactive.GetDependency("name");    // NULL — case-sensitive
Dependency? unknown = reactive.GetDependency("Nope");    // null
```

`GetDependency` is the escape hatch for forcing a notification on a property whose value did not
change (`dependency.Trigger()`), mirroring what `TriggerReference` does for refs.

### `IReactiveTraversable`

```csharp
public interface IReactiveTraversable
{
    void Traverse(ReactiveTraversal traversal);
}
```

Implemented by values that expose nested reactive members to a `ReactiveTraversal` — the
reflection-free stand-in for Vue's object/array/collection walking. Implemented by generated objects
(via `IReactiveObject`) and by `ReactiveList<T>`, `ReactiveDictionary<TKey,TValue>`, and
`ReactiveSet<T>`. **This is the interface `Reactive.IsReactive` keys on.**

The reactive collections implement this but **not** `IReactiveObject`, which is why
`Reactive.Watch(myReactiveList, callback)` does not compile — the generic constraint fails. Use a
getter source instead:

```csharp
using Assimalign.Viu.Reactivity;

var list = new ReactiveList<int> { 1, 2 };

Reactive.Watch(() => list, (_, _, _) => { }, new WatchOptions { Deep = true });
```

### `IReadonlyReactive`

```csharp
public interface IReadonlyReactive
{
    bool IsReadonly { get; }
}
```

The port of Vue's `ReactiveFlags.IS_READONLY`. Implemented explicitly by a getter-only `Computed<T>`
(returning whether its setter is null) and by generated `Readonly = true` classes (returning `true`).
Consulted by `Reactive.IsReadonly`.

## The `[Reactive]` source generator

Because C# has no `Proxy` and WASM forbids runtime code generation, object reactivity is a
**compile-time** feature. `ReactiveGenerator` is an `IIncrementalGenerator` that rewrites annotated
partial classes.

### Attributes

```csharp
[AttributeUsage(AttributeTargets.Class, AllowMultiple = false, Inherited = false)]
public sealed class ReactiveAttribute : Attribute
{
    public bool Readonly { get; set; }
}

[AttributeUsage(AttributeTargets.Class, AllowMultiple = false, Inherited = false)]
public sealed class ShallowReactiveAttribute : Attribute
{
    public bool Readonly { get; set; }
}
```

| Attribute | Vue counterpart | Traversal behavior |
| --- | --- | --- |
| `[Reactive]` | [`reactive()`](https://vuejs.org/api/reactivity-core.html#reactive) | emits `traversal.Visit(this.Prop)` for reference-typed properties — descends into nested reactive members; value-typed properties emit `_ = this.Prop;` (see below) |
| `[ShallowReactive]` | [`shallowReactive()`](https://vuejs.org/api/reactivity-advanced.html#shallowreactive) | emits `_ = this.Prop;` — tracks the slot, never descends |
| `[Reactive(Readonly = true)]` | [`readonly()`](https://vuejs.org/api/reactivity-core.html#readonly) | as `[Reactive]`; setters warn and neither mutate nor trigger |
| `[ShallowReactive(Readonly = true)]` | [`shallowReadonly()`](https://vuejs.org/api/reactivity-advanced.html#shallowreadonly) | as `[ShallowReactive]`; setters warn only |

**Value-typed properties never descend.** The traversal emitter special-cases `IsValueType`: under
`[Reactive]` a `struct`/primitive property emits `_ = this.Prop;`, exactly as `[ShallowReactive]`
would, because a value type cannot itself be a reactive object. Only reference-typed properties get
`traversal.Visit(...)`. This is why the emitted example below shows `traversal.Visit(this.Title)`
for a `string` but `_ = this.Done;` for a `bool`.

**Requirements.** The type must be a `partial class` — not a struct, record, or interface — and must
not be static. Reactive members must be `partial` **properties** with both a getter and a
**non-init** setter. Fields are ignored entirely. C# partial-property support is required.

**Packaging.** The generator ships inside the `Assimalign.Viu.Reactivity` package via a
`ViuAnalyzerReference` item. A package or project reference to `Assimalign.Viu.Reactivity` alone
enables `[Reactive]` — do not add a separate reference to the Generators package.

### Declaring reactive classes

```csharp
using Assimalign.Viu.Reactivity;

namespace Demo;

/// <summary>A deep reactive object.</summary>
[Reactive]
public partial class ReactivePerson
{
    public partial string Name { get; set; }

    public partial int Age { get; set; }
}

/// <summary>A deep reactive object that composes a nested reactive object.</summary>
[Reactive]
public partial class ReactiveOrder
{
    public partial ReactivePerson Customer { get; set; }

    public partial int Total { get; set; }
}

/// <summary>Only root-level property replacement is deep-traversed.</summary>
[ShallowReactive]
public partial class ShallowBox
{
    public partial ReactivePerson Content { get; set; }

    public partial int Version { get; set; }
}

/// <summary>The port of readonly(reactive()) — setters warn instead of mutating.</summary>
[Reactive(Readonly = true)]
public partial class ReadonlyProfile
{
    public partial string Handle { get; set; }
}
```

### Emitted output

For a two-property class — `TodoItem` with `string Title` and `bool Done` — the generator emits, per
property, a `Dependency` field, a raw backing field, and an instrumented property body. The listing
below shows the `Title` member set in full; the identical `Done` members are elided for brevity, but
their names still appear in the whole-class members that follow.

```csharp
// <auto-generated/>
#nullable enable

namespace Demo
{
    public partial class TodoItem : global::Assimalign.Viu.Reactivity.IReactiveObject
    {
        private global::Assimalign.Viu.Reactivity.Dependency __TitleDependency = new global::Assimalign.Viu.Reactivity.Dependency();
        private string __TitleValue = default!;

        // ... __DoneDependency and __DoneValue elided ...

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

        // ... the `Done` property body elided ...

        object global::Assimalign.Viu.Reactivity.IReactiveObject.ToRaw() => this;

        global::Assimalign.Viu.Reactivity.Dependency? global::Assimalign.Viu.Reactivity.IReactiveObject.GetDependency(string propertyName)
        {
            switch (propertyName)
            {
                case "Title":
                    return this.__TitleDependency;
                case "Done":
                    return this.__DoneDependency;
                default:
                    return null;
            }
        }

        void global::Assimalign.Viu.Reactivity.IReactiveTraversable.Traverse(global::Assimalign.Viu.Reactivity.ReactiveTraversal traversal)
        {
            traversal.Visit(this.Title);
            _ = this.Done;
        }
    }
}
```

- **Reserved member names** — `__{PropertyName}Value` and `__{PropertyName}Dependency` are emitted
  into your class. A hand-written member with either name will collide.
- **Hint name** — the generated file is
  `{Namespace}.{ContainingTypes...}.{TypeName}.Reactive.g.cs`.
- **Nested types** — containing types are re-declared `partial` around the generated member, so a
  `[Reactive]` class nested inside another class generates correctly.

### Generated members

Both are emitted **only when the class has at least one reactive property**.

#### `ToReferences()` and the `ReactiveReferences` struct

The compiled counterpart of Vue's
[`toRefs()`](https://vuejs.org/api/reactivity-utilities.html#torefs), and the only one Viu has —
there is no static `Reactive.ToRefs`.

```csharp
public readonly struct ReactiveReferences
{
    internal ReactiveReferences(TodoItem source)
    {
        this.Title = global::Assimalign.Viu.Reactivity.Reactive.ToRef<string>(
            () => source.Title,
            value => source.Title = value);

        // ... one assignment per remaining property, elided ...
    }

    public global::Assimalign.Viu.Reactivity.IReference<string> Title { get; }

    // ... one property per remaining property, elided ...
}

public ReactiveReferences ToReferences() => new ReactiveReferences(this);
```

Each property becomes a write-through `IReference<T>` built from `Reactive.ToRef`, so the link runs
in both directions and honours the property's equality cutoff:

```csharp
using Assimalign.Viu.Reactivity;

var person = new ReactivePerson { Name = "Ada", Age = 30 };
var references = person.ToReferences();

var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = references.Name.Value;
});                                  // runs == 1

person.Name = "Grace";               // object -> ref. runs == 2
references.Name.Value = "Hopper";    // ref -> object; person.Name == "Hopper". runs == 3
references.Name.Value = "Hopper";    // equal value hits the setter's cutoff. runs == 3
```

#### `ToRawValues()` and the `RawValues` struct

An untracked view straight over the raw backing fields: **reads do not track and writes do not
trigger**, but both hit the same state the instrumented properties use.

```csharp
public readonly struct RawValues
{
    private readonly TodoItem _owner;

    internal RawValues(TodoItem owner)
    {
        this._owner = owner;
    }

    public string Title
    {
        get => this._owner.__TitleValue;
        set => this._owner.__TitleValue = value;
    }

    // ... one pass-through property per remaining property, elided ...
}

public RawValues ToRawValues() => new RawValues(this);
```

This is the **only genuinely untracked view** of a generated object — `Reactive.ToRaw(obj)` returns
the instance itself and still tracks.

```csharp
using Assimalign.Viu.Reactivity;

var person = new ReactivePerson { Name = "Ada", Age = 30 };
var runs = 0;
Reactive.Effect(() =>
{
    runs++;
    _ = person.Name;
});                                       // runs == 1

var raw = person.ToRawValues();
raw.Name = "Grace";                       // shared backing field, no trigger. runs == 1

// The instrumented path is intact — and its equality guard now compares against "Grace".
person.Name = "Grace";                    // equal to the raw-written value. runs == 1
person.Name = "Hopper";                   // runs == 2
```

> **`ToRawValues()` is emitted for `Readonly = true` classes too**, matching upstream, where
> `toRaw(readonly(obj))` returns the mutable target. That makes it a **write escape hatch around
> `Readonly = true`**. Readonly is a compile-time authoring convention, not a security boundary.

### Diagnostics

| ID | Severity | Condition | Effect |
| --- | --- | --- | --- |
| `VUER1001` | Error | the attributed type is not `partial` | generation aborted for that type |
| `VUER1002` | Error | the attributed type is `static` | generation aborted for that type |
| `VUER1003` | Warning | a `partial` property is get-only, set-only, or init-only | that property is skipped; the rest of the class still generates |
| `VUER1004` | Error | both `[Reactive]` and `[ShallowReactive]` are applied | **no source is emitted at all** |

`VUER1004` is reported exactly once, by the deep pass; the shallow pass stays silent. See
[Compiler Diagnostics](diagnostics.md) for the full site-wide diagnostic index.

## Not yet implemented

These are absent by design or simply not built yet. None of them should be worked around by
reflection — see [AOT & Trimming](../guide/best-practices/aot-and-trimming.md) for why.

- **No runtime `reactive()` / `shallowReactive()`** — there is no way to make an arbitrary existing
  instance reactive at runtime. Object reactivity is compile-time only.
- **No runtime `readonly()` / `shallowReadonly()`** — you cannot derive a read-only view of an
  existing mutable reactive object; readonly is decided by the attribute at compile time.
- **No `Reactive.ToRefs(obj)`** — the `toRefs` counterpart is the generated instance method
  `ToReferences()` only.
- **No string-key `toRef(obj, "key")`** — deliberately omitted for AOT and trim safety. Only the
  delegate form `Reactive.ToRef<T>(Func<T>, Action<T>?)` exists.
- **No `unmarkRaw`** — `Reactive.MarkRaw` is permanent and cannot be reversed.
- **No custom `IEqualityComparer<T>` injection** — change detection in `Reference<T>`,
  `ShallowReference<T>`, `Computed<T>`, and generated setters is hardwired to
  `EqualityComparer<T>.Default`. The comparers accepted by `ReactiveDictionary` and `ReactiveSet`
  govern storage lookup, not the value-change cutoff.
- **No `onTrack` / `onTrigger` debug hooks** — Vue's dev-only debugger callbacks do not exist on
  `ReactiveEffect`, `Computed<T>`, or `WatchOptions`, and there is no DevTools integration.
- **No public `TargetTracking`** — Vue's `targetMap` equivalent is internal. There is no supported
  public object-plus-key tracking entry point.
- **No generator support for records, structs, or interfaces** — `[AttributeUsage]` is
  `AttributeTargets.Class` only, and fields are never made reactive.
- **No code-fix providers** for `VUER1001`–`VUER1004`. The diagnostic messages are written to be
  code-fix-friendly, but no `CodeFixProvider` ships today.
- **No thread safety** — there is no async-local or thread-static isolation of ambient state, and
  none is planned. Multi-threaded use is unsupported.

## See also

- [Reactivity API: Core](reactivity-core.md) — refs, computeds, effects, scopes, and watchers.
- [Reactive Collections](reactive-collections.md) — `ReactiveList<T>`,
  `ReactiveDictionary<TKey,TValue>`, `ReactiveSet<T>`, and their exact trigger granularity.
- [Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md) — the guide-level
  introduction to refs and `[Reactive]`.
- [Composables](../guide/reusability/composables.md) — `EffectScope`, `OnScopeDispose`, and the
  teardown contract.
- [Differences from Vue 3](../roadmap/vue-differences.md) — the full naming map and behavioral
  divergences.
- [Project Status](../roadmap/status.md) — area-by-area coverage.
