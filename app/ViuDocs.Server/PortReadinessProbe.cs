using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace ViuDocs.Server;

internal static class PortReadinessProbe
{
    public static async Task WaitAsync(
        ServerAddress address,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(address);

        using CancellationTokenSource timeout =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));

        while (true)
        {
            timeout.Token.ThrowIfCancellationRequested();

            IPAddress probeAddress = address.EndPoint.Address.Equals(IPAddress.Any)
                ? IPAddress.Loopback
                : address.EndPoint.Address.Equals(IPAddress.IPv6Any)
                    ? IPAddress.IPv6Loopback
                    : address.EndPoint.Address;
            using TcpClient client = new(probeAddress.AddressFamily);
            try
            {
                await client.ConnectAsync(
                    probeAddress,
                    address.EndPoint.Port,
                    timeout.Token).ConfigureAwait(false);
                return;
            }
            catch (SocketException) when (!timeout.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(25), timeout.Token).ConfigureAwait(false);
            }
        }
    }
}
