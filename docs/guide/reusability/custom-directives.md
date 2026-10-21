# Custom Directives

Attach reusable host behavior through explicit directive invocations and lifecycle hooks.

> **Status:** Implemented. Directives resolve by type token; they are separate from component catalogs.

## The IDirective interface

IDirective lives in Assimalign.Viu and exposes optional Created, BeforeMount, Mounted,
BeforeUpdate, Updated, BeforeUnmount, and Unmounted hooks. Directive bundles those delegates;
Directive.FromFunction uses one hook for mounted and updated phases.

## DirectiveHook and DirectiveBinding

A hook receives the boxed host element, DirectiveBinding, current ElementNode, and optional
previous ElementNode. Binding supplies DirectiveType, the directive instance, Context, Value,
PreviousValue, and any owning transition. The host element is host-specific: Browser uses an
integer handle, while Testing uses its in-memory tree.

## Authoring a directive

```csharp
using System;
using System.Collections.Generic;

using Assimalign.Viu;
using Assimalign.Viu.Components;

public sealed class AuditDirective : IDirective
{
    public DirectiveHook? Mounted => static (element, binding, node, previous) =>
        Console.WriteLine(binding.Value);
}

// In the composition root:
// DirectiveRegistry directives = new(new Dictionary<Type, IDirective>
// {
//     [typeof(AuditDirective)] = new AuditDirective(),
// });
```

The type token identifies an explicitly supplied instance. It is never passed to reflective
activation. The application borrows the resolver and registered directives.

## Attaching directives programmatically

```csharp
using Assimalign.Viu.Components;

ElementNode element = new(
    new QualifiedName("div"),
    children: [new TextNode("Audited")],
    directives: [new DirectiveInvocation(typeof(AuditDirective), "mounted")]);
```

Assign the explicit registry to ApplicationOptions.Directives. A supplied Browser resolver
replaces its default, so preserve required Browser directives when composing a custom resolver.

## Using a directive in a template

Template compilation resolves directive identity at build time and carries an invocation value.
Do not copy the old string-name app.Directive registration model. The compiler and runtime
contracts are type-token based; use code-first invocation for an explicitly constructed directive.

## The element handle on the browser

A managed handle is not a DOM proxy. Host-specific mutation belongs in a deliberate Browser
integration; a portable directive cannot assume JavaScript DOM methods exist on its element value.
Avoid reflective or dynamic host access in trimmed/AOT code.

## Timing and ownership

Mounted/updated work follows the runtime's post-flush phases. Keep per-element state separate
from a reusable directive instance and release it on unmount. Native form directives and v-show
are supplied by Browser; see [Built-in Directives](../../api/built-in-directives.md).

## See also

- [Application API](../../api/application.md)
- [Render Functions & VirtualNode](../../api/render-function.md)
- [Testing](../scaling-up/testing.md)
