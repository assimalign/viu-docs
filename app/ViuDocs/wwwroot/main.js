import { dotnet } from './_framework/dotnet.js'

document.addEventListener('click', event => {
    if (event.defaultPrevented
        || event.button !== 0
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || !(event.target instanceof Element)) {
        return
    }

    const link = event.target.closest('.markdown-body a[href]')
    if (!(link instanceof HTMLAnchorElement) || link.target) {
        return
    }

    const hash = new URL(link.href, document.baseURI).hash
    const anchorSeparator = hash.indexOf('#', 1)
    if (!hash.startsWith('#/') || anchorSeparator < 0) {
        return
    }

    const routeHash = hash.slice(0, anchorSeparator)
    const identifier = decodeFragment(hash.slice(anchorSeparator + 1))
    if (!identifier) {
        return
    }

    event.preventDefault()
    const changesRoute = window.location.hash !== routeHash
    scrollWhenRendered(identifier, changesRoute)
    if (changesRoute) {
        window.location.hash = routeHash
    }
})

const { runMain } = await dotnet.create()

await runMain()

function decodeFragment(value) {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function scrollWhenRendered(identifier, waitForMutation) {
    const root = document.querySelector('#app')
    let mutationObserved = !waitForMutation

    const tryScroll = () => {
        if (!mutationObserved) {
            return false
        }

        const target = document.getElementById(identifier)
        if (!target) {
            return false
        }

        target.scrollIntoView({ block: 'start' })
        return true
    }

    if (tryScroll() || !root) {
        return
    }

    const observer = new MutationObserver(() => {
        mutationObserved = true
        if (tryScroll()) {
            observer.disconnect()
            clearTimeout(expiration)
        }
    })
    const expiration = setTimeout(() => observer.disconnect(), 5000)
    observer.observe(root, { childList: true, subtree: true })
}
