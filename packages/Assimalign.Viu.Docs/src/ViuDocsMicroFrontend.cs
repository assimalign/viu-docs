using System;
using System.Net.Http;
using System.Reflection;

using Assimalign.Cohesion.Viu.Markdown;
using Assimalign.Frontend;

namespace Assimalign.Viu.Docs;

/// <summary>Contributes the Viu documentation catalog, routes, navigation, and renderer to a composed host.</summary>
public sealed class ViuDocsMicroFrontend : DocumentationMicroFrontend
{
    /// <summary>Creates the module with an unconfigured HTTP client for catalog-only consumers.</summary>
    /// <remarks>
    /// Browser hosts should use <see cref="ViuDocsMicroFrontend(HttpClient)"/> so relative static
    /// content paths resolve against the host document.
    /// </remarks>
    public ViuDocsMicroFrontend()
        : this(new HttpClient())
    {
    }

    /// <summary>Creates the module with a borrowed HTTP client configured for the composing host.</summary>
    /// <param name="httpClient">The client whose base address resolves package static content.</param>
    public ViuDocsMicroFrontend(HttpClient httpClient)
        : base(
            new MicroFrontendDescriptor(
                "viu",
                "Viu",
                "/viu",
                BrandAccent.Viu,
                20,
                "Viu is a C#/.NET re-implementation of Vue.js 3 that runs in the browser on WebAssembly.",
                new Uri("https://github.com/assimalign/viu"),
                InformationalVersion()),
            GeneratedMarkdownContent.Catalog,
            new HttpMarkdownContentSource(httpClient, AssetPaths()))
    {
    }

    private static string[] AssetPaths()
    {
        string[] paths = new string[GeneratedMarkdownContent.Catalog.Pages.Count];
        for (int index = 0; index < paths.Length; index++)
        {
            paths[index] = GeneratedMarkdownContent.Catalog.Pages[index].AssetPath;
        }

        return paths;
    }

    private static string InformationalVersion() =>
        typeof(ViuDocsMicroFrontend).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion ?? "1.0.0-preview.1";
}
