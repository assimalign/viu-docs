using System.Runtime.InteropServices.JavaScript;
using System.Threading.Tasks;

namespace ViuDocs;

internal static partial class FragmentScrolling
{
    [JSImport("globalThis.viuDocs.waitForHeading")]
    internal static partial Task<string?> WaitForHeadingAsync(string routePath, string fragment);
}
