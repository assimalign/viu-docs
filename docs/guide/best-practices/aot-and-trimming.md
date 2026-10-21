# AOT & Trimming

Keep activation, generated catalogs, handlers, and application dependencies statically reachable.

> **Status:** Implemented. An application still needs its own trimmed/AOT publish validation.

## The constraint

Browser WebAssembly and NativeAOT cannot rely on runtime code generation or unbounded reflection.
Viu compiles templates and reactive properties at build time. Component activation uses explicit
delegates; generated catalogs publish direct references instead of scanning loaded assemblies.

## What the constraint explains

ComponentNode.For<T> reads IComponentDefinition.Registration without activating T. RegisteredName
and ComponentMetadataAttribute are compiler/tooling inputs, not a runtime attribute-discovery
scheme. Referenced catalogs aggregate at compile time and populate explicit factories/registries.

Typed model conversion uses the target's declared scalar type. Typed event method groups retain
their delegate shape and static helpers keep a type receiver. These paths need no reflective
assignment or late-bound invocation. Give application service factories explicit construction
delegates too.

## Practical rules for application authors

- Enable IsAotCompatible on host-neutral libraries and resolve meaningful trim/AOT diagnostics.
- Keep Viu SDK, runtime, and hosting packages on a compatible build train.
- Expose a library component with a public partial companion when another assembly needs its typed handle.
- Populate an explicit component factory; assigning one replaces Browser generated defaults.
- Use source-generated serialization for application payloads and explicit service activation.
- Prefer Task-returning handlers over async void so completion and failure remain observable.

## Publishing

Trimming and managed WebAssembly AOT are application publish choices. Inspect the Browser SDK's
publish controls and validate the resulting assets with the actual host. A successful ordinary
build does not prove an AOT publish works. This documentation reconciliation does not claim a
new AOT or NativeAOT publication run.

## See also

- [MSBuild Reference](../../api/msbuild-reference.md)
- [The Viu SDK & Build](../scaling-up/sdk-and-build.md)
- [Performance](performance.md)
