# Testing

Mount immutable trees and authored components in Viu's deterministic, DOM-free production test host.

> **Status:** Implemented. ComponentTest uses the public component, application, and renderer seams.

## Setting up a test project

Use a normal .NET test project targeting net10.0, enable preview features, and reference the same
Assimalign.Viu.Testing version as the component packages. Host-neutral components need no Browser
runtime or WebAssembly workload. The Viu library template includes a generated-catalog test project.

## Your first component test

For a generated Counter definition with a click handler:

```csharp
using System.Threading.Tasks;

using Assimalign.Viu.Components;
using Assimalign.Viu.Testing;

using Xunit;

public sealed class CounterTests
{
    [Fact]
    public async Task ClickUpdatesText()
    {
        ComponentFactory components = new();
        components.RegisterGeneratedComponents();
        using ComponentWrapper wrapper = ComponentTest.Mount(
            ComponentNode.For<Counter>(),
            new ComponentMountOptions { Components = components });

        await wrapper.Get("button").TriggerAsync("click");
        Assert.Contains("1", wrapper.Text());
    }
}
```

Reference Counter's namespace and expose its generated type when it lives in another assembly.
This test exercises reactive output rather than asserting the compiler's implementation details.

## ComponentTest.Mount

Overloads accept a VirtualNode, an exact caller-supplied IComponent instance, or an explicit
ComponentRegistration. A registration owns activation; a typed node still needs its factory.
Generated catalog aggregation is available in the executable test compilation. Metadata-only
tests can opt out with ViuAutoRegisterGeneratedCatalogs=false and use explicit catalogs.

## ComponentWrapper and ElementWrapper

Wrappers expose Html, Text, Find/Get/FindAll, typed authored-component queries, event dispatch,
model-value updates, emitted-event snapshots, and deterministic flushing. TriggerAsync dispatches
events; NextTickAsync/FlushAsync drain scheduled work. The owning root wrapper unmounts on Dispose.
Find returns null when absent; Get throws. There is no dynamically reflected component vm object.

## ComponentMountOptions

Options supply root Arguments, Slots, Listeners, RootDirectives, SlotStability, and RootContract,
plus Components, Services, State, Directives, and ConfigureApplication. Stub<TComponent> replaces
a descendant by authored type with an explicit activator or placeholder. Dependencies remain
caller-owned. ApplicationOptions.EventObserver captures declared component events per context.

## Observing state and warnings

Assert visible behavior and declared outputs. Application warning/error handlers are supplied
through ConfigureApplication; use them when diagnostics are the behavior under test. Task-returning
listeners are observed through lifecycle handling, so drain owned work when testing async failures.
Browser-only interop still requires a browser or a deliberate test stub.

## The low-level layer: TestRenderer

TestRenderer combines Core's Renderer<TestNode>, TestNodeOperations, operation/commit logs, a
hydration reader, and a deterministic synchronization context. Render/Hydrate calls enter that
context; Drain/Pump/Run make queued work explicit. TestServerMarkup parses server fragments for
hydration scenarios. These are production public seams, not privileged access to runtime internals.

## Integration validation

Compile real SFC fixtures when testing typed models, events, and slot boundaries. For hosting,
also check the actual static assets and deep links over HTTP. Browser checks remain necessary for
JavaScript interop, IME, focus, and native default-action timing; a DOM-free test cannot establish
those behaviors alone.

## See also

- [Component API](../../api/component.md)
- [AOT & Trimming](../best-practices/aot-and-trimming.md)
- [Project Status](../../roadmap/status.md)
