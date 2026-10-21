# Assimalign.Viu.Docs design

## Boundaries

The package derives its single public module from `DocumentationMicroFrontend`. That base owns the
page component, rendering pipeline, not-found behavior, breadcrumbs, and previous/next navigation.
The package supplies only product identity and generated content. It deliberately contains no shell,
host navigation copy, custom CSS, server integration, or application-model code.

## Route and asset prefixes

The Markdown generator uses `/viu` as its route base. The generated catalog therefore contains
`/viu`, `/viu/guide`, and `/viu/guide/quick-start`, which keeps navigation links fully qualified.
`DocumentationMicroFrontend` recognizes those routes as already belonging to its `/viu` descriptor
prefix and does not add the prefix again.

The independent asset prefix is `_content/Assimalign.Viu.Docs/docs/`. The package's transitive build
assets map the packed `content/docs/**` files to that public path in each consumer.

## HTTP ownership

The module constructs its own `HttpMarkdownContentSource`; hosts never call `AddMarkdownContent`.
The parameterless constructor supports catalog and composition inspection. A running browser host
uses the `HttpClient` overload because the Phase 2 base class requires the content source during
construction and exposes no later service-provider factory. This is the smallest local adaptation
that preserves the shared package boundary without widening it.

## AOT constraints

The package targets `net10.0`, is marked AOT-compatible, and uses generated catalogs and explicit
component registration. It does not discover pages or components through runtime assembly scanning.
The informational version is read from the package assembly's statically referenced attribute.

Application-local generated components use the Viu aggregate through `AddComponents()`. Shared
frontend contributions still register explicitly: that precompiled frontend build does not publish
the new typed public definitions. Assigning an explicit component factory overrides generated
defaults, so a composing host must populate any factory it owns.

## Standalone host integration

The Web host marks the Browser client with `ViuClient="true"` on a normal ProjectReference.
Platforms queries `GetViuBrowserClientInfo`, suppresses the managed client assembly reference,
and stages `viu-client.json`; `AddViuClient()` infers that single client. This is asset hosting,
not server rendering of the browser-only shared shell.

If a host adds server-renderable components, DI-first SSR belongs in the Web builder's Services
container. Generated component/render catalogs are defaults and each render owns a fresh context
and async DI scope. No separate server ViuApplicationBuilder or provider is required.
