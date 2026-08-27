using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;

namespace ViuDocs.Server;

internal static class ServerAddressResolver
{
    private const string DefaultUrl = "http://127.0.0.1:5179";

    public static IReadOnlyList<ServerAddress> Resolve(string? configuredUrls)
    {
        string urls = string.IsNullOrWhiteSpace(configuredUrls)
            ? DefaultUrl
            : configuredUrls;

        List<ServerAddress> addresses = [];
        HashSet<string> uniqueUrls = new(StringComparer.OrdinalIgnoreCase);
        foreach (string candidate in urls.Split(
            ';',
            StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!Uri.TryCreate(candidate, UriKind.Absolute, out Uri? url))
            {
                throw new InvalidOperationException($"URL '{candidate}' is not an absolute URL.");
            }

            if (!url.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"URL '{candidate}' is not supported. The documentation host currently supports HTTP only.");
            }

            if (url.AbsolutePath != "/" || !string.IsNullOrEmpty(url.Query) || !string.IsNullOrEmpty(url.Fragment))
            {
                throw new InvalidOperationException(
                    $"URL '{candidate}' must not contain a path, query, or fragment.");
            }

            Uri normalizedUrl = new UriBuilder(url) { Path = "/" }.Uri;
            if (uniqueUrls.Add(normalizedUrl.AbsoluteUri))
            {
                addresses.Add(new ServerAddress(normalizedUrl, ResolveEndPoint(normalizedUrl)));
            }
        }

        if (addresses.Count == 0)
        {
            throw new InvalidOperationException("ASPNETCORE_URLS did not contain an HTTP URL.");
        }

        return addresses;
    }

    private static IPEndPoint ResolveEndPoint(Uri url)
    {
        IPAddress address;
        if (url.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
        {
            address = IPAddress.Loopback;
        }
        else if (url.Host is "*" or "+" or "0.0.0.0")
        {
            address = IPAddress.Any;
        }
        else if (url.Host is "[::]" or "::")
        {
            address = IPAddress.IPv6Any;
        }
        else if (!IPAddress.TryParse(url.Host, out address!))
        {
            address = Dns.GetHostAddresses(url.DnsSafeHost)
                .FirstOrDefault(candidate => candidate.AddressFamily == AddressFamily.InterNetwork)
                ?? throw new InvalidOperationException(
                    $"Host '{url.Host}' did not resolve to an IPv4 address.");
        }

        return new IPEndPoint(address, url.Port);
    }
}
