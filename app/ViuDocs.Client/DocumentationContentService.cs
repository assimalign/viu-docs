using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

using Assimalign.Cohesion.Content.Markdown;

namespace ViuDocs;

internal sealed class DocumentationContentService
{
    private readonly HttpClient _httpClient;

    internal DocumentationContentService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    internal async Task<string> RenderAsync(
        DocumentationPage page,
        CancellationToken cancellationToken)
    {
        string markdown = await _httpClient.GetStringAsync(
            page.AssetPath,
            cancellationToken);
        MarkdownDocument document = MarkdownText.Parse(markdown);
        DocumentationMarkdownLinks.Rewrite(document, page);

        string html = MarkdownText.ToHtml(document);
        return DocumentationHeadingIdentifiers.Apply(document, html);
    }
}
