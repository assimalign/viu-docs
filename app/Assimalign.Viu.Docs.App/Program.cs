using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Runtime.InteropServices.JavaScript;

using Assimalign.Cohesion.Viu.Hosting;
using Assimalign.Cohesion.Viu.Hosting.Browser;
using Assimalign.Cohesion.Viu.Routing;
using Assimalign.Frontend;
using Assimalign.Viu.Components;
using Assimalign.Viu.Docs;
using Assimalign.Viu.Router;

using ViuDocs;

ViuApplicationBuilder builder = ViuApplication.CreateBuilder();
using HttpClient httpClient = new() { BaseAddress = ResolveBaseAddress() };

builder.Services.AddComponents();
builder.Services.AddFrontendComponents();
builder.Services.AddRouting(routing =>
{
    List<RouteRecord> children = [];
    children.Add<LandingPage>(string.Empty, name: "landing");
    routing.Routes.Add("/", "AppShell", children: children, name: "landing-layout");
});
builder.Services.AddMicroFrontends(microFrontends => microFrontends
    .UseShell(ComponentReference.ForName("AppShell"))
    .Add(new ViuDocsMicroFrontend(httpClient)));
builder.AddClientConfiguration(httpClient);
builder.ConfigureApplication(options =>
    options.RootComponent = new ComponentNode(RouterView.Registration.Reference));
builder.ConfigureBrowser(options => options.MountTargetSelector = "#app");

await using ViuApplication application = builder.Build();
await application.UseRouter().RunAsync();

static Uri ResolveBaseAddress()
{
    using JSObject document = JSHost.GlobalThis.GetPropertyAsJSObject("document")
        ?? throw new InvalidOperationException("The browser document is unavailable.");
    string? baseUri = document.GetPropertyAsString("baseURI");
    return string.IsNullOrWhiteSpace(baseUri)
        ? throw new InvalidOperationException("The browser document has no base URI.")
        : new Uri(baseUri, UriKind.Absolute);
}
