using System;
using System.Net.Http;
using System.Runtime.InteropServices.JavaScript;

using Assimalign.Viu;
using Assimalign.Viu.Browser;
using Assimalign.Viu.Browser.Router;
using Assimalign.Viu.Components;
using Assimalign.Viu.Router;

using ViuDocs;

using ViuRouter = Assimalign.Viu.Router.Router;

using IRouterHistory history = BrowserRouterHistory.CreateWebHash();
using ViuRouter router = new(history, DocumentationRoutes.Create());
using HttpClient httpClient = new()
{
    BaseAddress = ResolveBaseAddress(),
};

var content = new DocumentationContentService(httpClient);
var services = new DocumentationServiceProvider(router, content);
ComponentFactory components = ViuDocsComponentCatalog.CreateFactory();

await using BrowserApplication application = new BrowserApplicationBuilder()
    .ConfigureApplication(
        options =>
        {
            options.RootComponent = new ComponentNode(
                RouterView.Registration.Reference);
            options.Components = components;
            options.Services = services;
            options.WarnHandler = message => Console.Error.WriteLine($"Viu warning: {message}");
            options.ErrorHandler = (exception, _, source) =>
                Console.Error.WriteLine($"Viu error ({source}): {exception}");
        })
    .ConfigureBrowser(
        options => options.MountTargetSelector = "#app")
    .Build();

await application
    .UseRouter(router)
    .RunAsync();

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
