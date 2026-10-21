# KeepAlive, Teleport & Suspense

Use structural built-ins for retained component state, separate host targets, and asynchronous branches.

> **Status:** Implemented in the current runtime. The historical page path is retained for links.

## What the compiler emits

These tags are structural node kinds, not inert helper markers that throw on construction.
Components owns KeepAliveNode, TeleportNode, and SuspenseNode descriptions; Core executes them,
and Browser supplies the required host operations. Slots keep branch content lazy at description time.

## Teleport

Teleport renders content into a host-resolved target while preserving its logical component
relationship. Use an existing target and consider the separate target in server rendering and
hydration policy. Moving content does not create a new application service hierarchy.

## KeepAlive

KeepAlive retains eligible component state while inactive and uses activated/deactivated lifecycle
hooks. Identity and cache policy determine which mounted component is retained. It is not a
general cache for arbitrary DOM fragments or a replacement for explicit state ownership.

## Suspense

Suspense coordinates lazy default/fallback branches and asynchronous dependencies. Core owns the
pending branch, dependency accounting, reveal, and teardown. Server serialization awaits default
content. Browser hydration and later asynchronous replacement follow the runtime's structural
boundary policy; do not treat a loading component as a new top-level host.

## Transitions and ownership

Structural built-ins preserve component lifetimes and error routing. Transition adds enter/leave
behavior around a child; see [Transition & TransitionGroup](transition.md). Use component lifecycle
cancellation for work owned by the child and application-owned services for broader resources.

## See also

- [Component API](../../api/component.md)
- [Render Functions & VirtualNode](../../api/render-function.md)
- [Project Status](../../roadmap/status.md)
