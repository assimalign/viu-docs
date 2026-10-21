# Differences from Vue 3

Map familiar Vue concepts to Viu's explicit C# component, reactivity, and hosting contracts.

> **Status:** Implemented behavior is described here; remaining preview limits are in Project Status.

## Structural differences and their causes

Viu compiles templates and reactive properties ahead of time. There is no runtime template
compiler, JavaScript script execution, or component-instance proxy. IComponent.Setup returns a
ComponentRenderer; IComponentDefinition supplies a static registration for typed handles.

The .viu container combines template/style tags with a C# @script block. Legacy @template/@style
blocks produce migration warnings. Compatible .vue scripts require lang="csharp".

## The naming map

| Vue concept | Viu |
| --- | --- |
| ref / .value | Reactive.Reference / .Value in C#. |
| computed | Reactive.Computed. |
| reactive object | Generated partial class/properties. |
| props / emits | Parameter properties / Event partial methods, or explicit contracts. |
| setup | IComponent.Setup(ComponentContext), returning a frame-based renderer. |
| h / vnode | Explicit immutable ElementNode, ComponentNode, TextNode, etc. |
| app composition | ConfigureApplication before Build; host lifetime middleware afterward. |
| registered root | ComponentNode.For<T>(); Cohesion UseRootComponent<T>(). |
| route records | routes.Add(path, componentName, title) / routes.Add<T>(). |

## Behavioral divergences

Standalone watchers default to WatchFlushMode.Synchronous. ComponentContext.Watch requests
pre-flush scheduling and owns the watch in the component scope. Scalar model write-back obeys
declared C# target types and invariant numeric conversion; invalid conversions throw normally.
Method-group listeners retain declared C# payload and Task return types.

Reference cells are objects; there is no identity-swapping proxy. Deep traversal follows supported
reference/object/collection contracts and does not reflect over arbitrary POCO properties. Each
reactive graph remains single-event-loop, including within a request-isolated host flow.

## Registration and libraries

Generated metadata and catalogs are compile-time inputs. Browser builders populate referenced
catalogs by default; explicit factories replace that default. RegisteredName overrides the
sanitized file-derived name. Public partial companions expose reusable typed library handles.
Ordinary ProjectReference and PackageReference libraries both deliver styles and injected links.

## Deliberate omissions

There is no hierarchical component-tree provide/inject or app-global proxy property bag. Use
parameters, slots, application services, and explicit state registries. Scoped CSS is unsupported;
CSS Modules provide local class names. Generated reactive CSS v-bind() application remains deferred.

## Where to go next

- [Quick Start](../guide/quick-start.md)
- [Components](../guide/essentials/components.md)
- [Provide / Inject](../guide/components/provide-inject.md)
- [Project Status](status.md)
