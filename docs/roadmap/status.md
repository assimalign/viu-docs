# Project Status

The implemented component and hosting surfaces, remaining limits, and preview package follow-up.

> **Status:** Preview. Audited against Viu #379 and viu-platforms #4 on 2026-10-21.

## How to read the status column

Implemented means the source provides the behavior; it does not mean every host or publication
mode was exercised by this documentation change. Deferred means the named gap remains outside
the implementation, rather than a workaround an application should silently depend on.

## Implemented areas

| Area | Current surface |
| --- | --- |
| Component model | Components-owned immutable nodes, IComponent, ComponentContext, explicit activation. |
| Generated definitions | Metadata, RegisteredName, IComponentDefinition, ComponentNode.For<T>(). |
| Catalogs | Compile-time referenced aggregation, Browser defaults, explicit population and opt-out. |
| Reactivity / State | Reference factories, generated properties, collections, scopes, explicit store registries. |
| Templates | Runnable SFCs, typed native/component models and listeners, static helpers, slot blocks. |
| Browser / Core | Command-buffered commits, structural built-ins, hydration, scheduler. |
| Server rendering | Host-neutral renderer and generated direct server catalogs. |
| Router | Named/typed route additions, matching/history/guards, Browser integration. |
| CSS | Ordinary styles, CSS Modules, package/project-reference delivery and automatic links. |
| Tooling | Templates, watch integration, in-memory Testing, opt-in DevTools. |
| Cohesion hosting | AddComponents(), typed roots, marked client ProjectReference, DI-first SSR. |

## Viu PR #379 fixes

Compound server interpolation preserves escaped values and separators. Slot roots collect dynamic
descendants so native v-model updates nested text/bindings and sibling fragments. Modifier/key glue
preserves event identity and synchronous prevention. Model assignment uses declared scalar/nullable
types, and component method-group listeners preserve typed payloads and observed Task completion.
Static script helpers retain their declaring-type receiver. ProjectReference library styles flow
transitively into Browser assets/links. ARIA booleans serialize and hydrate as lowercase tokens.

The reported form-plus-sibling mount failure was not reproduced upstream. The supplied variant has
regression coverage; that is not evidence of a separately confirmed mount defect or universal fix.

## Cohesion Web and server rendering

AddViuServerRendering composes in the Web provider with generated catalogs by default. The host
owns runtime lifecycle; accepted renders own fresh contexts and asynchronous DI scopes. Predicate-only
UseViuServerRenderer consumes that composition. Explicit Components and ServerRenders independently
replace defaults. Existing adaptor and borrowed-application overloads remain supported.

AddViuClient infers a marked ProjectReference from rebuilt viu-client.json and uses published
wwwroot after publication. ViuClientReference is removed. Render scopes remain separate from other
Web middleware scopes; HTTP-data injection and request-specific routing are application policy.

## Remaining limits and deliberate omissions

- Generated reactive CSS v-bind() application remains deferred; extraction/rewriting exist.
- Scoped CSS is unsupported; ordinary styles and CSS Modules are the supported choices.
- SCSS/LESS preprocessing is not installed by a lang option.
- Runtime template compilation, JavaScript script execution, Options API proxies, and hierarchical
  component-tree provide/inject are deliberate omissions.
- A reactive graph is not thread-safe; flow isolation does not clone shared values.
- This reconciliation validates builds, package contracts, and HTTP delivery. It does not claim a
  fresh NativeAOT or managed WebAssembly AOT publish, or browser end-to-end execution.

## Package line and merge follow-up

The documentation/app integration uses Viu 10.0.0-preview.0.pr.379.6 and platforms
10.0.0-preview.0.pr.4.8. Cohesion remains ci.21 and the shared frontend remains
1.0.0-preview.1.ci.1. After both upstream PRs merge, repin SDKs and package references together to
compatible merged CI builds. PR packages are temporary and may be pruned when their PR closes.

## Related pages

- [Quick Start](../guide/quick-start.md)
- [Application API](../api/application.md)
- [The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md)
- [Differences from Vue 3](vue-differences.md)
