# Stopwatch

Build a small stopwatch with reactive text and asynchronous work owned by its component lifetime.

> **Status:** Implemented using generated SFC and lifecycle contracts.

## The bootstrap

Create a Browser app as in [Quick Start](../guide/quick-start.md), save the component below as
StopwatchApplication.viu, and import its project namespace in Program:

```csharp
using Assimalign.Viu;
using Assimalign.Viu.Browser;
using Assimalign.Viu.Components;

await new BrowserApplicationBuilder()
    .ConfigureApplication(options => options.RootComponent = ComponentNode.For<StopwatchApplication>())
    .Build()
    .RunAsync();
```

Generated catalogs provide the root registration by default. No manual instance root or infinite
delay is required.

## The root component

```viu
<template>
    <section>
        <p>Elapsed: {{ Elapsed }}</p>
        <button type="button" @click="Reset">Reset</button>
    </section>
</template>

@script {
    using System.Diagnostics;
    using System.Threading;
    using System.Threading.Tasks;

    using Assimalign.Viu.Reactivity;

    private readonly Stopwatch Clock = new();
    public Reference<string> Elapsed { get; } = Reactive.Reference("00:00.00");

    partial void OnSetup()
    {
        OnMounted(TickAsync);
    }

    private async Task TickAsync(CancellationToken cancellationToken)
    {
        Clock.Start();
        try
        {
            while (true)
            {
                await Task.Delay(50, cancellationToken);
                Elapsed.Value = Clock.Elapsed.ToString(@"mm\:ss\.ff");
            }
        }
        finally
        {
            Clock.Stop();
        }
    }

    private void Reset()
    {
        Clock.Restart();
        Elapsed.Value = "00:00.00";
    }
}
```

The mounted hook starts observed asynchronous work. Unmount cancels its token; the loop exits and
the finally block stops the clock. Display updates write a reference on the host event flow.
The render reads Elapsed.Value through template unwrapping and patches the changed text.

## The child component

To split display from timing, declare an elapsed Parameter in a child and a reset Event partial
method. The parent passes elapsed and listens for reset. See [Props](../guide/components/props.md)
and [Component Events](../guide/components/events.md); the event carries declared arguments,
not a reflected component-instance method lookup.

## The wwwroot files

Use Quick Start's index.html and main.js. Component CSS links are injected by the Browser SDK.
If timing precision matters, measure the actual browser; the display interval is not a real-time
guarantee and can be throttled in background tabs.

## Where to go next

- [Lifecycle Hooks & Template Refs](../guide/essentials/lifecycle-and-template-refs.md)
- [Testing](../guide/scaling-up/testing.md)
- [Examples](index.md)
