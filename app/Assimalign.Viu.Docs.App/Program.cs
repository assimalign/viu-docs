using System;
using System.Net.Http;
using System.Runtime.InteropServices.JavaScript;
using System.Threading.Tasks;

using Assimalign.Cohesion.DependencyInjection;
using Assimalign.Cohesion.Viu.Hosting;
using Assimalign.Cohesion.Viu.Hosting.Browser;
using Assimalign.Cohesion.Viu.Markdown;
using Assimalign.Viu;
using Assimalign.Viu.Browser.Router;
using Assimalign.Viu.Components;
using Assimalign.Viu.Router;

using ViuDocs;

using ViuRouter = Assimalign.Viu.Router.Router;

ViuApplicationBuilder builder = ViuApplication.CreateBuilder();
ComponentFactory components = ViuDocsComponentCatalog.CreateFactory();
using HttpClient httpClient = new() { BaseAddress = ResolveBaseAddress() };

builder.ConfigureBrowser(options => options.MountTargetSelector = "#app");
builder.ConfigureApplication(options =>
{
    options.RootComponent = new ComponentNode(
        RouterView.Registration.Reference);
    options.Components = components;
    options.WarnHandler = message => Console.Error.WriteLine($"Viu warning: {message}");
    options.ErrorHandler = (exception, _, source) =>
        Console.Error.WriteLine($"Viu error ({source}): {exception}");
});

builder.Services.AddSingleton<IRouterHistory>(
    _ => BrowserRouterHistory.CreateWeb());
builder.Services.AddSingleton<ViuRouter>(services =>
    new ViuRouter(
        services.GetRequiredService<IRouterHistory>(),
        MarkdownRoutes.Create(GeneratedMarkdownContent.Catalog, new MarkdownRouteOptions
        {
            LayoutComponent = ComponentReference.ForName("AppShell"),
        }))
    {
        ScrollBehavior = ScrollAsync,
    });
builder.AddMarkdownContent(options =>
{
    options.Catalog = GeneratedMarkdownContent.Catalog;
    options.Source = new HttpMarkdownContentSource(httpClient);
    options.Components = components;
    options.RenderOptions = new MarkdownRenderOptions
    {
        ArticleClass = "markdown-body",
        // A root base element keeps WASM assets stable; qualify native fragments with their page.
        LinkResolver = static (page, destination) => destination.StartsWith('#')
            ? new MarkdownLinkResolution(page.RoutePath + destination, false)
            : null,
    };
});

await using ViuApplication application = builder.Build();
ViuRouter router = application.Context.Services.GetRequiredService<ViuRouter>();

await application
    .UseRouter(router)
    .RunAsync();

static async Task<ScrollTarget?> ScrollAsync(
    RouteLocation destination,
    RouteLocation previous,
    ScrollPosition? savedPosition)
{
    int fragmentIndex = destination.Path.IndexOf('#', StringComparison.Ordinal);
    string fragment = fragmentIndex < 0 ? string.Empty : destination.Path[fragmentIndex..];
    int suffixIndex = destination.Path.IndexOfAny(['?', '#']);
    string routePath = MarkdownContentCatalog.NormalizeRoute(
        suffixIndex < 0 ? destination.Path : destination.Path[..suffixIndex]);
    string? selector = await FragmentScrolling.WaitForHeadingAsync(routePath, fragment);
    return savedPosition.HasValue
        ? new ScrollTarget(savedPosition.Value)
        : selector is null ? null : new ScrollTarget(selector);
}

static Uri ResolveBaseAddress()
{
    JSObject? document = JSHost.GlobalThis.GetPropertyAsJSObject("document");
    if (document is null)
    {
        throw new InvalidOperationException("The browser document is unavailable.");
    }

    try
    {
        string? baseUri = document.GetPropertyAsString("baseURI");
        if (string.IsNullOrWhiteSpace(baseUri))
        {
            throw new InvalidOperationException("The browser document has no base URI.");
        }

        return new Uri(baseUri, UriKind.Absolute);
    }
    finally
    {
        document.Dispose();
    }
}
