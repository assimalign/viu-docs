using System;

using ViuRouter = Assimalign.Viu.Router.Router;

namespace ViuDocs;

internal sealed class DocumentationServiceProvider : IServiceProvider
{
    private readonly ViuRouter _router;
    private readonly DocumentationContentService _content;

    internal DocumentationServiceProvider(
        ViuRouter router,
        DocumentationContentService content)
    {
        _router = router;
        _content = content;
    }

    public object? GetService(Type serviceType)
    {
        ArgumentNullException.ThrowIfNull(serviceType);
        if (serviceType == typeof(ViuRouter))
        {
            return _router;
        }

        return serviceType == typeof(DocumentationContentService)
            ? _content
            : null;
    }
}
