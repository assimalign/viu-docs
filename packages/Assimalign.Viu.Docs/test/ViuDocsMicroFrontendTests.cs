using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using Assimalign.Cohesion.DependencyInjection;
using Assimalign.Cohesion.Viu.Hosting;
using Assimalign.Frontend;
using Assimalign.Viu.Components;
using Assimalign.Viu.Router;

using Shouldly;
using Xunit;

using ViuRouter = Assimalign.Viu.Router.Router;

namespace Assimalign.Viu.Docs.Tests;

public sealed class ViuDocsMicroFrontendTests
{
    [Fact]
    public void Catalog_ContainsEveryRepositoryPageWithPackageAssetPaths()
    {
        string docsRoot = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "..", "..", "docs"));
        int sourcePageCount = Directory.GetFiles(docsRoot, "*.md", SearchOption.AllDirectories).Length;

        GeneratedMarkdownContent.Catalog.Pages.Count.ShouldBe(sourcePageCount);
        sourcePageCount.ShouldBe(45);
        GeneratedMarkdownContent.Catalog.Pages.ShouldAllBe(page =>
            page.AssetPath.StartsWith("_content/Assimalign.Viu.Docs/docs/", StringComparison.Ordinal));
        GeneratedMarkdownContent.Catalog.Pages.ShouldAllBe(page => page.Status != null);
    }

    [Fact]
    public void Routes_ArePrefixedExactlyOnceAndMapHomeToIndex()
    {
        ViuDocsMicroFrontend module = new();
        IReadOnlyList<RouteRecord> routes = module.CreateRoutes(new MicroFrontendRouteContext(
            ComponentReference.ForName("AppShell"),
            module.Descriptor.RoutePrefix,
            EmptyServices.Instance));

        RouteRecord layout = routes.ShouldHaveSingleItem();
        layout.Path.ShouldBe("/viu");
        layout.Children.ShouldContain(route => route.Path == string.Empty);
        layout.Children.ShouldContain(route => route.Path == "guide");
        layout.Children.ShouldContain(route => route.Path == "guide/quick-start");
        layout.Children.ShouldNotContain(route => route.Path == "/guide" || route.Path == "viu/guide");
        GeneratedMarkdownContent.Catalog.Pages.Single(page => page.SourceRelativePath == "index.md")
            .RoutePath.ShouldBe("/viu");
        GeneratedMarkdownContent.Catalog.Pages.ShouldNotContain(page => page.RoutePath == "/guide");
    }

    [Fact]
    public void AddMicroFrontends_RegistersTheModuleAndRoutesItThroughTheApplicationRouter()
    {
        ViuApplicationBuilder builder = ViuApplication.CreateBuilder();
        builder.Services.AddMicroFrontends(microFrontends => microFrontends
            .Add(new ViuDocsMicroFrontend()));
        IServiceProvider services = ((IServiceProviderBuilder)builder.Services).Build();

        services.GetRequiredService<IMicroFrontendCatalog>().Descriptors
            .ShouldHaveSingleItem().Id.ShouldBe("viu");
        ViuRouter router = services.GetRequiredService<ViuRouter>();
        router.Resolve("/viu").Name.ShouldBe("viu:/viu");
        router.Resolve("/viu/guide/quick-start").Name.ShouldBe("viu:/viu/guide/quick-start");
        router.Resolve("/viu/missing-page").Name.ShouldBe("viu:not-found");
    }

    [Fact]
    public void Navigation_FollowsIndexOrderAndProjectsQuickStartContext()
    {
        IMicroFrontendNavigation navigation = new ViuDocsMicroFrontend().CreateNavigation();
        IReadOnlySet<string> expanded = navigation.ExpandAncestors(
            new HashSet<string>(StringComparer.Ordinal),
            "/viu/guide/quick-start");
        IReadOnlyList<NavigationRow> rows = navigation.GetRows(expanded, "/viu/guide/quick-start");

        rows.Where(row => !row.IsSection).Take(3).Select(row => row.Title)
            .ShouldBe(["Viu", "Introduction", "Quick Start"]);
        navigation.GetBreadcrumbs("/viu/guide/quick-start").Select(row => row.Title)
            .ShouldBe(["Viu", "Guide", "Quick Start"]);
        navigation.GetPageLinks("/viu/guide/quick-start")
            .Select(link => (link.Direction, link.Title, link.RoutePath))
            .ShouldBe([
                ("Previous", "Introduction", "/viu/guide/introduction"),
                ("Next", "Essentials", "/viu/guide/essentials"),
            ]);
    }

    private sealed class EmptyServices : IServiceProvider
    {
        internal static EmptyServices Instance { get; } = new();

        public object? GetService(Type serviceType) => null;
    }
}
