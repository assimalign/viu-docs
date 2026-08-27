using System;
using System.Collections.Generic;

using Assimalign.Cohesion.Content.Markdown;

namespace ViuDocs;

internal static class DocumentationMarkdownLinks
{
    internal static void Rewrite(
        MarkdownDocument document,
        DocumentationPage currentPage)
    {
        foreach (MarkdownBlock block in document.Blocks)
        {
            RewriteBlock(block, currentPage);
        }
    }

    private static void RewriteBlock(
        MarkdownBlock block,
        DocumentationPage currentPage)
    {
        switch (block)
        {
            case MarkdownParagraph paragraph:
                RewriteInlines(paragraph.Inlines, currentPage);
                break;
            case MarkdownHeading heading:
                RewriteInlines(heading.Inlines, currentPage);
                break;
            case MarkdownBlockQuote quote:
                foreach (MarkdownBlock child in quote.Blocks)
                {
                    RewriteBlock(child, currentPage);
                }

                break;
            case MarkdownList list:
                foreach (MarkdownListItem item in list.Items)
                {
                    foreach (MarkdownBlock child in item.Blocks)
                    {
                        RewriteBlock(child, currentPage);
                    }
                }

                break;
        }
    }

    private static void RewriteInlines(
        IList<MarkdownInline> inlines,
        DocumentationPage currentPage)
    {
        foreach (MarkdownInline inline in inlines)
        {
            switch (inline)
            {
                case MarkdownLink link:
                    link.Destination = RewriteDestination(
                        link.Destination,
                        currentPage);
                    RewriteInlines(link.Inlines, currentPage);
                    break;
                case MarkdownImage image:
                    RewriteInlines(image.Inlines, currentPage);
                    break;
                case MarkdownEmphasis emphasis:
                    RewriteInlines(emphasis.Inlines, currentPage);
                    break;
                case MarkdownStrong strong:
                    RewriteInlines(strong.Inlines, currentPage);
                    break;
            }
        }
    }

    private static string RewriteDestination(
        string destination,
        DocumentationPage currentPage)
    {
        if (destination.StartsWith('#'))
        {
            return "#" + currentPage.Route + destination;
        }

        int fragmentIndex = destination.IndexOf('#', StringComparison.Ordinal);
        string fragment = fragmentIndex >= 0
            ? destination[fragmentIndex..]
            : string.Empty;
        string withoutFragment = fragmentIndex >= 0
            ? destination[..fragmentIndex]
            : destination;

        int queryIndex = withoutFragment.IndexOf('?', StringComparison.Ordinal);
        string path = queryIndex >= 0
            ? withoutFragment[..queryIndex]
            : withoutFragment;

        if (!path.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
        {
            return destination;
        }

        string assetPath = ResolveAssetPath(currentPage.AssetPath, path);
        DocumentationPage? targetPage = DocumentationCatalog.FindByAssetPath(assetPath);
        return targetPage is null
            ? destination
            : "#" + targetPage.Route + fragment;
    }

    private static string ResolveAssetPath(
        string currentAssetPath,
        string destinationPath)
    {
        List<string> segments = [];
        if (!destinationPath.StartsWith('/'))
        {
            int separatorIndex = currentAssetPath.LastIndexOf('/');
            if (separatorIndex >= 0)
            {
                AddSegments(segments, currentAssetPath[..separatorIndex]);
            }
        }

        AddSegments(segments, destinationPath.TrimStart('/'));
        return string.Join('/', segments);
    }

    private static void AddSegments(List<string> segments, string path)
    {
        foreach (string segment in path.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (segment == ".")
            {
                continue;
            }

            if (segment == "..")
            {
                if (segments.Count > 0)
                {
                    segments.RemoveAt(segments.Count - 1);
                }

                continue;
            }

            segments.Add(segment);
        }
    }
}
