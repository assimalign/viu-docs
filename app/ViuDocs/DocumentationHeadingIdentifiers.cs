using System;
using System.Collections.Generic;
using System.Text;

using Assimalign.Cohesion.Content.Markdown;

namespace ViuDocs;

internal static class DocumentationHeadingIdentifiers
{
    internal static string Apply(MarkdownDocument document, string html)
    {
        List<MarkdownHeading> headings = [];
        CollectHeadings(document.Blocks, headings);
        if (headings.Count == 0)
        {
            return html;
        }

        var duplicateCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        int searchIndex = 0;
        foreach (MarkdownHeading heading in headings)
        {
            string marker = $"<h{heading.Level}>";
            int markerIndex = html.IndexOf(marker, searchIndex, StringComparison.Ordinal);
            if (markerIndex < 0)
            {
                break;
            }

            string identifier = CreateIdentifier(heading.Inlines, duplicateCounts);
            int insertionIndex = markerIndex + marker.Length - 1;
            string attribute = $" id=\"{identifier}\"";
            html = html.Insert(insertionIndex, attribute);
            searchIndex = insertionIndex + attribute.Length + 1;
        }

        return html;
    }

    private static void CollectHeadings(
        IList<MarkdownBlock> blocks,
        List<MarkdownHeading> headings)
    {
        foreach (MarkdownBlock block in blocks)
        {
            switch (block)
            {
                case MarkdownHeading heading:
                    headings.Add(heading);
                    break;
                case MarkdownBlockQuote quote:
                    CollectHeadings(quote.Blocks, headings);
                    break;
                case MarkdownList list:
                    foreach (MarkdownListItem item in list.Items)
                    {
                        CollectHeadings(item.Blocks, headings);
                    }

                    break;
            }
        }
    }

    private static string CreateIdentifier(
        IList<MarkdownInline> inlines,
        Dictionary<string, int> duplicateCounts)
    {
        var text = new StringBuilder();
        AppendInlineText(text, inlines);

        var identifier = new StringBuilder(text.Length);
        bool separatorPending = false;
        foreach (char character in text.ToString())
        {
            if (char.IsLetterOrDigit(character))
            {
                if (separatorPending && identifier.Length > 0)
                {
                    identifier.Append('-');
                }

                identifier.Append(char.ToLowerInvariant(character));
                separatorPending = false;
            }
            else if (char.IsWhiteSpace(character) || character == '-')
            {
                separatorPending = identifier.Length > 0;
            }
        }

        string baseIdentifier = identifier.Length == 0
            ? "section"
            : identifier.ToString();
        if (!duplicateCounts.TryGetValue(baseIdentifier, out int duplicateCount))
        {
            duplicateCounts.Add(baseIdentifier, 0);
            return baseIdentifier;
        }

        duplicateCount++;
        duplicateCounts[baseIdentifier] = duplicateCount;
        return $"{baseIdentifier}-{duplicateCount}";
    }

    private static void AppendInlineText(
        StringBuilder builder,
        IList<MarkdownInline> inlines)
    {
        foreach (MarkdownInline inline in inlines)
        {
            switch (inline)
            {
                case MarkdownLiteral literal:
                    builder.Append(literal.Text);
                    break;
                case MarkdownCodeSpan code:
                    builder.Append(code.Literal);
                    break;
                case MarkdownLineBreak:
                    builder.Append(' ');
                    break;
                case MarkdownLink link:
                    AppendInlineText(builder, link.Inlines);
                    break;
                case MarkdownImage image:
                    AppendInlineText(builder, image.Inlines);
                    break;
                case MarkdownEmphasis emphasis:
                    AppendInlineText(builder, emphasis.Inlines);
                    break;
                case MarkdownStrong strong:
                    AppendInlineText(builder, strong.Inlines);
                    break;
            }
        }
    }
}
