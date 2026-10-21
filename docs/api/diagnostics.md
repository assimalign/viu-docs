# Compiler Diagnostics

Locate component, template, script, style, and reactive-generation errors in authored source.

> **Status:** Implemented. Diagnostic IDs and messages below follow the current generator source.

## Two ID families

VIU descriptors cover single-file component compilation. VUER descriptors cover reactive class
generation. Located diagnostics point into the authored file; ordinary C# semantic errors in
generated members also map back through source locations.

## The VIU catalog

| ID | Meaning |
| --- | --- |
| VIU1001 / 1002 / 1003 | Container parse error / warning / information. |
| VIU1004 | Conflicting single-file component formats. |
| VIU1005 | Conflicting generated identity or registered name. |
| VIU1101 / 1102 / 1103 | Template error / warning / information. |
| VIU1201 / 1202 / 1203 | Script parse error / warning / information. |
| VIU1204 | Reserved generated member name. |
| VIU1205 | Async void callback cannot be observed. |
| VIU1206 | Unsupported script language. |
| VIU1207 / 1208 / 1209 | Conflicting / duplicate / unsupported parameter or event declaration. |
| VIU1301 / 1302 / 1303 | Style error / warning / information. |
| VIU1401 | Unknown component parameter. |
| VIU1402 | Missing required component parameter. |
| VIU1403 | Incompatible component argument type. |
| VIU1404 | Component cannot be resolved. |
| VIU1405 | Ambiguous component name. |

Origin/severity envelopes can append the underlying parser/compiler catalog code. An enum member
in a parser catalog alone is not proof that a particular diagnostic is emitted for every input.

## Generated names and metadata

A RegisteredName override must be one nonempty string literal constant in the script. Invalid or
conflicting overrides and duplicate registered names report VIU1005 at authored locations.
Conflicting catalog entries are omitted while distinct generated types remain available. Across
different runtime catalogs, registration conflicts instead fail factory/registry population.

Generation preserves accessibility. If a typed library handle is inaccessible, add a public partial
companion in its namespace; changing the registered name does not make its type public.

## Script declarations and handlers

Context and generated setup members are reserved. Parameter/Event declarations must use supported
property/partial-method shapes. Prefer Task-returning handlers to async void; typed method groups
preserve their declared argument and return types. Static helpers remain static. C# semantic
errors such as missing imports or incompatible assignments remain ordinary CS diagnostics.

## Unsupported scoped styles

Scoped styles are unsupported. A .viu scoped option reports a container error (parser code 1018);
.vue compatibility warns (1019) and compiles ordinary global CSS. Use a CSS module for local class
names. Generated reactive application of CSS v-bind() remains deferred independently of this rule.

## Reactive generation

Use partial classes and partial get/set properties with Reactive/ShallowReactive. Unsupported
declarations and nonreactive property shapes are reported by the VUER family. Fields are not
automatically rewritten into reactive properties. See
[Reactivity Fundamentals](../guide/essentials/reactivity-fundamentals.md).

## Configuring severity

```ini
[*.cs]
dotnet_diagnostic.VUER1003.severity = suggestion
dotnet_diagnostic.VIU1102.severity = error
```

Standard Roslyn configuration applies by descriptor ID, including every diagnostic sharing an
origin/severity envelope. EnableSingleFileComponentGeneration=false disables SFC compilation;
file-exclusion controls are described in [MSBuild Reference](msbuild-reference.md).

## See also

- [Single-File Components](../guide/scaling-up/single-file-components.md)
- [SFC CSS Features](../guide/scaling-up/sfc-css-features.md)
- [Component API](component.md)
