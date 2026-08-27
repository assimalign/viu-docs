using System;
using System.Collections.Generic;

namespace ViuDocs;

internal static class DocumentationCatalog
{
    private static readonly IReadOnlyList<DocumentationSection> CatalogSections =
    [
        new(
            "Start",
            [
                new("Home", "/", "docs/index.md"),
                new("Guide", "/guide", "docs/guide/index.md"),
                new("Introduction", "/guide/introduction", "docs/guide/introduction.md"),
                new("Quick Start", "/guide/quick-start", "docs/guide/quick-start.md"),
            ]),
        new(
            "Essentials",
            [
                new("Essentials", "/guide/essentials", "docs/guide/essentials/index.md"),
                new("Components", "/guide/essentials/components", "docs/guide/essentials/components.md"),
                new("Reactivity Fundamentals", "/guide/essentials/reactivity-fundamentals", "docs/guide/essentials/reactivity-fundamentals.md"),
                new("Computed Properties", "/guide/essentials/computed", "docs/guide/essentials/computed.md"),
                new("Template Syntax", "/guide/essentials/template-syntax", "docs/guide/essentials/template-syntax.md"),
                new("Conditional & List Rendering", "/guide/essentials/conditional-and-list", "docs/guide/essentials/conditional-and-list.md"),
                new("Event Handling", "/guide/essentials/event-handling", "docs/guide/essentials/event-handling.md"),
                new("Form Input Bindings", "/guide/essentials/form-bindings", "docs/guide/essentials/form-bindings.md"),
                new("Watchers", "/guide/essentials/watchers", "docs/guide/essentials/watchers.md"),
                new("Lifecycle & Template Refs", "/guide/essentials/lifecycle-and-template-refs", "docs/guide/essentials/lifecycle-and-template-refs.md"),
            ]),
        new(
            "Components",
            [
                new("Components In-Depth", "/guide/components", "docs/guide/components/index.md"),
                new("Props & Fallthrough", "/guide/components/props", "docs/guide/components/props.md"),
                new("Component Events", "/guide/components/events", "docs/guide/components/events.md"),
                new("Component v-model", "/guide/components/v-model", "docs/guide/components/v-model.md"),
                new("Slots", "/guide/components/slots", "docs/guide/components/slots.md"),
                new("Provide / Inject", "/guide/components/provide-inject", "docs/guide/components/provide-inject.md"),
                new("Dynamic Components", "/guide/components/dynamic-components", "docs/guide/components/dynamic-components.md"),
            ]),
        new(
            "Reusability & Built-ins",
            [
                new("Composables", "/guide/reusability/composables", "docs/guide/reusability/composables.md"),
                new("Custom Directives", "/guide/reusability/custom-directives", "docs/guide/reusability/custom-directives.md"),
                new("Transition", "/guide/built-ins/transition", "docs/guide/built-ins/transition.md"),
                new("Deferred Built-ins", "/guide/built-ins/deferred-built-ins", "docs/guide/built-ins/deferred-built-ins.md"),
            ]),
        new(
            "Scaling & Practices",
            [
                new("Single-File Components", "/guide/scaling-up/single-file-components", "docs/guide/scaling-up/single-file-components.md"),
                new("SFC CSS Features", "/guide/scaling-up/sfc-css-features", "docs/guide/scaling-up/sfc-css-features.md"),
                new("SDK & Build", "/guide/scaling-up/sdk-and-build", "docs/guide/scaling-up/sdk-and-build.md"),
                new("Testing", "/guide/scaling-up/testing", "docs/guide/scaling-up/testing.md"),
                new("AOT & Trimming", "/guide/best-practices/aot-and-trimming", "docs/guide/best-practices/aot-and-trimming.md"),
                new("Performance", "/guide/best-practices/performance", "docs/guide/best-practices/performance.md"),
            ]),
        new(
            "API Reference",
            [
                new("API Reference", "/api", "docs/api/index.md"),
                new("Reactivity Core", "/api/reactivity-core", "docs/api/reactivity-core.md"),
                new("Reactivity Utilities", "/api/reactivity-utilities", "docs/api/reactivity-utilities.md"),
                new("Reactive Collections", "/api/reactive-collections", "docs/api/reactive-collections.md"),
                new("Component API", "/api/component", "docs/api/component.md"),
                new("Application API", "/api/application", "docs/api/application.md"),
                new("Render Functions", "/api/render-function", "docs/api/render-function.md"),
                new("Built-in Directives", "/api/built-in-directives", "docs/api/built-in-directives.md"),
                new("MSBuild Reference", "/api/msbuild-reference", "docs/api/msbuild-reference.md"),
                new("Compiler Diagnostics", "/api/diagnostics", "docs/api/diagnostics.md"),
            ]),
        new(
            "Examples & Roadmap",
            [
                new("Examples", "/examples", "docs/examples/index.md"),
                new("Stopwatch", "/examples/stopwatch", "docs/examples/stopwatch.md"),
                new("Project Status", "/roadmap/status", "docs/roadmap/status.md"),
                new("Differences from Vue 3", "/roadmap/vue-differences", "docs/roadmap/vue-differences.md"),
            ]),
    ];

    private static readonly Dictionary<string, DocumentationPage> PagesByRoute =
        new(StringComparer.Ordinal);

    private static readonly Dictionary<string, DocumentationPage> PagesByAssetPath =
        new(StringComparer.Ordinal);

    static DocumentationCatalog()
    {
        int pageCount = 0;
        foreach (DocumentationSection section in CatalogSections)
        {
            foreach (DocumentationPage page in section.Pages)
            {
                PagesByRoute.Add(NormalizeRoute(page.Route), page);
                PagesByAssetPath.Add(NormalizeAssetPath(page.AssetPath), page);
                pageCount++;
            }
        }

        if (pageCount != 45)
        {
            throw new InvalidOperationException(
                $"The documentation catalog contains {pageCount} pages instead of 45.");
        }
    }

    internal static IReadOnlyList<DocumentationSection> Sections => CatalogSections;

    internal static DocumentationPage? FindByRoute(string route)
        => PagesByRoute.TryGetValue(NormalizeRoute(route), out DocumentationPage? page)
            ? page
            : null;

    internal static DocumentationPage? FindByAssetPath(string assetPath)
        => PagesByAssetPath.TryGetValue(
            NormalizeAssetPath(assetPath),
            out DocumentationPage? page)
                ? page
                : null;

    internal static string RouteFromCatchAll(string path)
    {
        string normalized = path.Replace('\\', '/').Trim('/');
        return normalized.Length == 0 ? "/" : "/" + normalized;
    }

    private static string NormalizeRoute(string route)
    {
        string normalized = route.Replace('\\', '/').Trim();
        if (normalized.Length == 0 || normalized == "/")
        {
            return "/";
        }

        return "/" + normalized.Trim('/');
    }

    private static string NormalizeAssetPath(string assetPath)
        => assetPath.Replace('\\', '/').TrimStart('/');
}
