using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Cohesion.DependencyInjection;
using Assimalign.Cohesion.Viu.Server;
using Assimalign.Cohesion.Web;
using Assimalign.Cohesion.Web.Hosting;

using ViuDocs.Server;

IReadOnlyList<ServerAddress> addresses = ServerAddressResolver.Resolve(
    Environment.GetEnvironmentVariable("ASPNETCORE_URLS"));
string clientOutputPath = ResolveClientOutputPath();

WebApplicationBuilder builder = WebApplication.CreateBuilder();
builder.AddViuApplication(options =>
{
    options.ContentRootPath = Path.Combine(clientOutputPath, "wwwroot");
    options.RuntimeManifestPath = Path.Combine(
        clientOutputPath,
        "ViuDocs.staticwebassets.runtime.json");
    options.EndpointsManifestPath = Path.Combine(
        clientOutputPath,
        "ViuDocs.staticwebassets.endpoints.json");
    options.EnableSpaFallback = true;
});
builder.Server.UseServer(listener =>
{
    foreach (ServerAddress address in addresses)
    {
        listener.UseHttp1(transport =>
        {
            transport.EndPoint = address.EndPoint;
            transport.NoDelay = true;
        });
    }
});

await using WebApplication application = builder.Build();
application.UseViuApplication();

// Future SSR seam: set EnableSpaFallback to false above, register the built server-side
// ViuApplication before Build with builder.AddViuServerApplication(viuApplication), then compose:
// application.UseViuServerRenderer(viuApplication, serverRenders, shouldRender);

using ShutdownSignals shutdown = new();
IWebApplicationServer server =
    application.Context.ServiceProvider.GetRequiredService<IWebApplicationServer>();

await server.StartAsync(shutdown.CancellationToken).ConfigureAwait(false);
try
{
    foreach (ServerAddress address in addresses)
    {
        await PortReadinessProbe.WaitAsync(address, shutdown.CancellationToken).ConfigureAwait(false);
        await Console.Out.WriteLineAsync($"Now listening on: {address.Url.AbsoluteUri}").ConfigureAwait(false);
        await Console.Out.WriteLineAsync($"App url: {address.Url.AbsoluteUri}").ConfigureAwait(false);
    }

    await Console.Out.FlushAsync(shutdown.CancellationToken).ConfigureAwait(false);
    await WaitForShutdownAsync(shutdown.CancellationToken).ConfigureAwait(false);
}
finally
{
    await server.StopAsync(CancellationToken.None).ConfigureAwait(false);
}

static string ResolveClientOutputPath()
{
    const string configurationKey = "ViuDocs.ClientOutputPath";
    string? configuredPath = AppContext.GetData(configurationKey) as string;
    if (string.IsNullOrWhiteSpace(configuredPath))
    {
        throw new InvalidOperationException(
            $"The runtime configuration property '{configurationKey}' is missing.");
    }

    string outputPath = Path.GetFullPath(configuredPath);
    if (!Directory.Exists(outputPath))
    {
        throw new DirectoryNotFoundException(
            $"The Viu client output directory '{outputPath}' does not exist.");
    }

    return outputPath;
}

static async Task WaitForShutdownAsync(CancellationToken cancellationToken)
{
    try
    {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).ConfigureAwait(false);
    }
    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
    {
    }
}
