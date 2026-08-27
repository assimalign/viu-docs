using System.Collections.Generic;

namespace ViuDocs;

internal sealed record DocumentationSection(
    string Title,
    IReadOnlyList<DocumentationPage> Pages);
