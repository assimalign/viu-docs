using System;
using System.Net.Http;
using System.Runtime.InteropServices.JavaScript;

using Assimalign.Cohesion.DependencyInjection;
using Assimalign.Cohesion.Viu.Hosting;
using Assimalign.Cohesion.Viu.Hosting.Browser;
using Assimalign.Viu;
using Assimalign.Viu.Browser.Router;
using Assimalign.Viu.Components;
using Assimalign.Viu.Router;

using ViuDocs;

using ViuRouter = Assimalign.Viu.Router.Router;

ViuApplicationBuilder builder = ViuApplication.CreateBuilder();

builder.ConfigureBrowser(options => options.MountTargetSelector = "#app");
builder.ConfigureApplication(options =>
{
    options.RootComponent = new ComponentNode(
        RouterView.Registration.Reference);
    options.Components = ViuDocsComponentCatalog.CreateFactory();
    options.WarnHandler = message => Console.Error.WriteLine($"Viu warning: {message}");
    options.ErrorHandler = (exception, _, source) =>
        Console.Error.WriteLine($"Viu error ({source}): {exception}");
});

builder.Services.AddSingleton<IRouterHistory>(
    _ => BrowserRouterHistory.CreateWebHash());
builder.Services.AddSingleton<ViuRouter>(services =>
    new ViuRouter(
        services.GetRequiredService<IRouterHistory>(),
        DocumentationRoutes.Create()));
builder.Services.AddSingleton<HttpClient>(_ => new HttpClient
{
    BaseAddress = ResolveBaseAddress(),
});
builder.Services.AddSingleton<DocumentationContentService>(services =>
    new DocumentationContentService(
        services.GetRequiredService<HttpClient>()));

await using ViuApplication application = builder.Build();
ViuRouter router = application.Context.Services.GetRequiredService<ViuRouter>();

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
