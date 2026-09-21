using System;
using System.Net.Http;
using System.Runtime.InteropServices.JavaScript;

using Assimalign.Cohesion.DependencyInjection;
using Assimalign.Cohesion.Viu.Hosting;
using Assimalign.Cohesion.Viu.Hosting.Browser;
using Assimalign.Frontend;
using Assimalign.Viu;
using Assimalign.Viu.Browser.Router;
using Assimalign.Viu.Components;
using Assimalign.Viu.Docs;
using Assimalign.Viu.Router;

using ViuRouter = Assimalign.Viu.Router.Router;

ViuApplicationBuilder builder = ViuApplication.CreateBuilder();
ComponentFactory components = new();
GeneratedViuComponents.Register(components);
global::Assimalign.Frontend.GeneratedViuComponents.Register(components);
using HttpClient httpClient = new() { BaseAddress = ResolveBaseAddress() };

builder.ConfigureBrowser(options => options.MountTargetSelector = "#app");
builder.AddClientConfiguration(httpClient);
builder.AddMicroFrontends(registrations => registrations
    .UseComponents(components)
    .UseShell(ComponentReference.ForName("AppShell"))
    .AddLandingRoute(new RouteRecord(
        "/",
        "landing-layout",
        children:
        [
            new RouteRecord(
                string.Empty,
                "landing",
                component: new ComponentNode(ComponentReference.ForName("LandingPage"))),
        ],
        component: new ComponentNode(ComponentReference.ForName("AppShell"))))
    .Add(new ViuDocsMicroFrontend(httpClient)));
builder.ConfigureApplication(options =>
{
    options.RootComponent = new ComponentNode(RouterView.Registration.Reference);
    options.Components = components;
    options.WarnHandler = message => Console.Error.WriteLine($"Viu warning: {message}");
    options.ErrorHandler = (exception, _, source) =>
        Console.Error.WriteLine($"Viu error ({source}): {exception}");
});

await using ViuApplication application = builder.Build();
ViuRouter router = application.Context.Services.GetRequiredService<ViuRouter>();
await application.UseRouter(router).RunAsync();

static Uri ResolveBaseAddress()
{
    using JSObject document = JSHost.GlobalThis.GetPropertyAsJSObject("document")
        ?? throw new InvalidOperationException("The browser document is unavailable.");
    string? baseUri = document.GetPropertyAsString("baseURI");
    return string.IsNullOrWhiteSpace(baseUri)
        ? throw new InvalidOperationException("The browser document has no base URI.")
        : new Uri(baseUri, UriKind.Absolute);
}
