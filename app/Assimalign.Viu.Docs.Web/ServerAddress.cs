using System;
using System.Net;

namespace ViuDocs.Server;

internal sealed record ServerAddress(Uri Url, IPEndPoint EndPoint);
