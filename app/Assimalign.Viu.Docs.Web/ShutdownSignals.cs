using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace ViuDocs.Server;

internal sealed class ShutdownSignals : IDisposable
{
    private readonly CancellationTokenSource _cancellationTokenSource = new();
    private readonly PosixSignalRegistration? _terminationRegistration;

    public ShutdownSignals()
    {
        Console.CancelKeyPress += OnCancelKeyPress;
        try
        {
            _terminationRegistration = PosixSignalRegistration.Create(
                PosixSignal.SIGTERM,
                context =>
                {
                    context.Cancel = true;
                    _cancellationTokenSource.Cancel();
                });
        }
        catch (PlatformNotSupportedException)
        {
        }
    }

    public CancellationToken CancellationToken => _cancellationTokenSource.Token;

    public void Dispose()
    {
        Console.CancelKeyPress -= OnCancelKeyPress;
        _terminationRegistration?.Dispose();
        _cancellationTokenSource.Dispose();
    }

    private void OnCancelKeyPress(object? sender, ConsoleCancelEventArgs eventArguments)
    {
        eventArguments.Cancel = true;
        _cancellationTokenSource.Cancel();
    }
}
