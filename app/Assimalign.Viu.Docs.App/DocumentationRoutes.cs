using System.Collections.Generic;

using Assimalign.Viu;
using Assimalign.Viu.Components;
using Assimalign.Viu.Router;

namespace ViuDocs;

internal static class DocumentationRoutes
{
    internal static IReadOnlyList<RouteRecord> Create()
        =>
        [
            new RouteRecord(
                "/",
                name: "documentation-shell",
                component: Component("AppShell"),
                children:
                [
                    new RouteRecord(
                        string.Empty,
                        name: "documentation-index",
                        component: Component("DocumentationView"),
                        argumentsResolver: RouteComponentArguments.FromValues(
                            ("pathMatch", string.Empty))),
                    new RouteRecord(
                        ":pathMatch(.*)*",
                        name: "documentation-page",
                        component: Component("DocumentationView"),
                        argumentsResolver: RouteComponentArguments.FromParameters()),
                ]),
        ];

    private static ComponentNode Component(string name)
        => new(ComponentReference.ForName(name));
}
