using Assimalign.Viu.Components;
using Assimalign.Viu.Router;

namespace ViuDocs;

internal static class ViuDocsComponentCatalog
{
    internal static ComponentFactory CreateFactory()
    {
        ComponentFactory factory = new();
        GeneratedViuComponents.Register(factory);
        factory.Register(RouterLink.Registration);
        factory.Register(RegisterByName("RouterLink", RouterLink.Registration));
        factory.Register(RouterView.Registration);
        factory.Register(RegisterByName("RouterView", RouterView.Registration));
        return factory;
    }

    private static ComponentRegistration RegisterByName(
        string name,
        ComponentRegistration registration)
        => new(
            ComponentReference.ForName(name),
            registration.Contract,
            registration.Activator);
}
