using Assimalign.Cohesion.Viu.Markdown;
using Assimalign.Viu.Components;

namespace ViuDocs;

internal static class ViuDocsComponentCatalog
{
    internal static ComponentFactory CreateFactory()
    {
        ComponentFactory factory = new();
        GeneratedViuComponents.Register(factory);
        MarkdownComponents.Register(factory);
        return factory;
    }
}
