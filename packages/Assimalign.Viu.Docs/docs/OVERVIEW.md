# Assimalign.Viu.Docs

`Assimalign.Viu.Docs` is the build-time micro-frontend package for the Viu documentation. It owns
the generated 45-page Markdown catalog, HTTP content source, renderer, `/viu` route subtree, and
navigation projections consumed by the shared Assimalign documentation shell.

The package is host-neutral: it does not define a shell, landing page, Web server, or deployment
resource. A browser host supplies an `HttpClient` whose base address is the host document, registers
the module with `AddMicroFrontends`, and serves the package's transitive static content.

The public entry point is `ViuDocsMicroFrontend`. Its descriptor identifies the module as `viu`,
selects the Viu brand accent, and reports the package informational version.

Markdown assets are packed under `content/docs/**`. The transitive frontend build contract links
them into a consuming browser application's `wwwroot` at
`/_content/Assimalign.Viu.Docs/docs/**`.
