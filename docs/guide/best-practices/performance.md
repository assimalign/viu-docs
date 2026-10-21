# Performance

Use compiled render plans, stable identity, and deliberate reactive dependencies to reduce work.

> **Status:** Implemented mechanisms are described here; no universal throughput number is promised.

## The budget is the interop boundary

Browser writes are encoded into a command frame and applied through one interop call per host
commit. Reads commit pending writes first. Keeping a component's reactive reads and render output
precise reduces both managed diff work and the commands crossing that boundary.

## Nodes cross as integer handles

Browser owns opaque DOM handles; Core remains host-neutral. Immutable descriptions can be cached,
but each occurrence retains independent mounted/host state. Reusing one description does not
collapse two positions into one live node.

## Events and handler identity

Delegate-swapping invokers avoid unnecessary listener attachment. Generated handlers retain their
declared event type, including modifier/key wrappers. Avoid replacing typed delegates with dynamic
or reflective dispatch. Prevention must reach the browser during synchronous event dispatch.

## What the compiler does

Generated render plans identify dynamic text, bindings, and block descendants. Static subtrees and
handlers use mount-local caches. Slot roots collect complete dynamic boundaries; a root carrying
an event or positive patch flag still includes its model-dependent descendants. Multiple slot
siblings use stable fragment blocks.

## What you control

- Use stable data keys for component/list identity.
- Use computed values for cached derivation, watches for effects.
- Use shallow references for deliberately external interiors and explicit notification when needed.
- Batch related writes with a disposable Reactive.Batch lease.
- Keep v-memo dependencies complete; an omitted dependency can leave cached output unchanged.
- Leave hand-built nodes on RenderPlan.None unless supplying a correct compiler-equivalent plan.

## How to measure

Use Testing's operation and commit logs for deterministic renderer work, then measure the actual
Browser publish for payload, startup, and interop costs. A unit-test operation count is evidence
about that scenario, not a cross-host timing guarantee. Validate representative model/slot updates
without forcing an unrelated parent render.

## See also

- [Render Functions & VirtualNode](../../api/render-function.md)
- [Testing](../scaling-up/testing.md)
- [AOT & Trimming](aot-and-trimming.md)
