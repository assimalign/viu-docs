using Assimalign.Cohesion.Viu.Server;
using Assimalign.Cohesion.Web;
using Assimalign.Cohesion.Web.Routing;
using Assimalign.Cohesion.Web.Hosting;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.Services.AddViuClient();
builder.Services.AddRouting();

await using WebApplication app = builder.Build();

app.UseRouting();
app.UseViuApplication();
app.MapGet("api/hello/{name}", (string name) => $"Hello, {name}!");

await app.RunAsync();
