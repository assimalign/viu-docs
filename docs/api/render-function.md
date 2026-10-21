# Render Functions & VirtualNode

Build immutable, host-neutral render descriptions with the Components tree vocabulary.

> **Status:** Implemented. Compiled templates add render plans; hand-built trees use full diffing.

## There is no `h()`

Viu uses explicit node constructors. A description is not a live DOM node or a mounted component.
Its types live in `Assimalign.Viu.Components`; Core owns mounted bookkeeping and host operations.

## Building nodes

```csharp
using System;

using Assimalign.Viu.Components;

VirtualNode tree = new ElementNode(
    new QualifiedName("button"),
    bindings:
    [
        ElementBinding.Attribute(new QualifiedName("type"), "button"),
        ElementBinding.Attribute(new QualifiedName("aria-expanded"), false),
        ElementBinding.Event("click", (Action)(() => Console.WriteLine("Clicked"))),
    ],
    children: [new TextNode("Open")]);
```

Element bindings distinguish attributes, properties, and events. `aria-*` boolean attributes emit
lowercase `"true"` and `"false"` on Browser and server paths. Null removes the attribute; false
keeps it. Hydration compares those same tokens. Ordinary HTML boolean attributes retain their
presence/absence policy.

## `VirtualNode`

| Node | Description |
| --- | --- |
| `ElementNode` | Qualified element name, bindings, directives, and children. |
| `TextNode` / `CommentNode` | Text or comment content. |
| `FragmentNode` | Ordered sibling descriptions. |
| `ComponentNode` | Registered component reference and immutable invocation. |
| `TeleportNode` | Content with a separate host target. |
| `KeepAliveNode` | Retained component content. |
| `SuspenseNode` | Lazy default and fallback branches. |
| `TransitionNode` | Transition invocation around content. |
| `VirtualNodeKind.Static` | Compiler-produced static markup payload. |

The public tree vocabulary is closed. Do not derive an unknown node subclass or retain mutable
host state on a description. Constructors snapshot their input collections.

## Components and typed handles

```csharp
using System.Collections.Generic;

using Assimalign.Viu.Components;

ComponentNode card = ComponentNode.For<UserCard>(new ComponentInvocation(
    arguments: new Dictionary<string, object?> { ["title"] = "Ada" }));
```

`For<T>()` requires `IComponentDefinition` and uses its static registration reference without
activation. Named requests use `new ComponentNode(ComponentReference.ForName("UserCard"))`.
Either request needs a matching registration in the application's factory.

## Render plans and patch flags

`RenderPlan.None` is the safe default for hand-built trees. Compiled templates produce plans and
`PatchFlags` describing text, class, style, selected properties, and block structure. Core can then
patch only dynamic descendants. Keys identify sibling positions independently of description
reference identity; use stable data keys for lists.

`Cached` and `Bail` are whole-value paths, not ordinary positive flag combinations. Do not attach
optimistic plans to changing hand-written trees. A full diff is correct when no compiler plan exists.

## `ComponentRenderFrame`

A `ComponentRenderer` receives its mount's frame. Generated code uses statement-form
`OpenBlock`, `Track`, and `CloseBlock` calls plus frame-owned cache slots and stable handlers.
Caches belong to one mount, including content declared for slots. Static script members are emitted
with the generated declaring type as receiver, so static template helpers remain static.

## Renderers

Core's `Renderer<TNode>` consumes the immutable tree and a host's `RendererOptions<TNode>`.
Browser supplies integer DOM handles; Testing supplies in-memory nodes. Host options include
creation, insertion/removal, binding patches, navigation, commit, static content, teleport target
resolution, and hydration readers. Optional capabilities are available only when supplied.

For application code, prefer the Browser builder or [ComponentTest](../guide/scaling-up/testing.md).
See [Application API](application.md) for startup and [Performance](../guide/best-practices/performance.md)
for how generated plans reduce work.
