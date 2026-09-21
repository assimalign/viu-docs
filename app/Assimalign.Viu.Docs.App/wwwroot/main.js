import '/_content/Assimalign.Frontend.Components/js/frontend.js'
import { dotnet } from './_framework/dotnet.js'

globalThis.assimalignFrontend.initializeTheme()
const { runMain } = await dotnet.create()
await runMain()
