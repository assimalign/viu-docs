import { dotnet } from './_framework/dotnet.js'

// Preserve bookmarks from the original hash-history application before the router initializes.
if (window.location.hash.startsWith('#/')) {
    window.history.replaceState(window.history.state, '', window.location.hash.slice(1))
}

let cancelPendingScroll = null

globalThis.viuDocs = {
    // Router scrolling runs after a render flush. Markdown may still be downloading, so wait
    // for the target heading; the browser router owns the actual scroll and stale-route guard.
    waitForHeading: (routePath, fragment) => {
        cancelPendingScroll?.()
        if (!fragment || fragment === '#') {
            return Promise.resolve(null)
        }

        let identifier
        try {
            identifier = decodeURIComponent(fragment.slice(1))
        } catch {
            identifier = fragment.slice(1)
        }

        const selector = '.markdown-body[data-markdown-route="' + CSS.escape(routePath)
            + '"] #' + CSS.escape(identifier)
        if (document.querySelector(selector)) {
            return Promise.resolve(selector)
        }

        const root = document.querySelector('#app')
        if (!root) {
            return Promise.resolve(null)
        }

        return new Promise(resolve => {
            const finish = result => {
                observer.disconnect()
                clearTimeout(expiration)
                if (cancelPendingScroll === cancel) {
                    cancelPendingScroll = null
                }
                resolve(result)
            }
            const cancel = () => finish(null)
            const observer = new MutationObserver(() => {
                if (document.querySelector(selector)) {
                    finish(selector)
                }
            })
            const expiration = setTimeout(cancel, 5000)
            cancelPendingScroll = cancel
            observer.observe(root, { childList: true, subtree: true })
        })
    },
}

const { runMain } = await dotnet.create()

await runMain()
