// The JS half of the Assimalign.Viu.Browser.Router history and scroll interop — the browser edge of
// the web and hash history modes (see BrowserRouterHistoryImplementation on the .NET side).
//
// Contract notes:
// - The .NET policy (BrowserRouterHistory) owns every URL and every state object; these functions
//   are dumb appliers. The one thing the DOM owns is the live window scroll saved on the leaving
//   entry during a push.
// - Reads are batched: readSnapshot() returns the whole location + state in ONE call, so .NET never
//   issues chatty per-property getters ([V01.01.08.02]).
// - State crosses as a flat, primitives-only payload: back/current/forward strings ('' encodes
//   null), a replaced flag and position counter, and an optional { left, top } scroll. No object
//   graph is marshaled.
// - popstate is delivered through the single [JSExport] dispatch, routed by subscription id so
//   teardown (unsubscribe) never leaks a listener across history instances.

let dispatchPopState = null            // the single [JSExport] popstate dispatch
const popstateListeners = new Map()    // subscription id -> popstate handler
const currentPositions = new Map()     // subscription id -> current history position
const savedPositionsBySubscription = new Map() // subscription id -> (position -> scroll offset)
let previousScrollRestoration = null

// The HTML History API defaults scrollRestoration to 'auto'. Viu owns saved-position capture and
// one-call restoration while any browser history is subscribed, so native restoration must be
// suspended or it can overwrite the leaving-entry ledger around popstate. The first subscription
// captures the embedding page's policy; only the last disposal restores it. HTML contract:
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-scroll-restoration-dev
// Scroll-coordinate contract: https://drafts.csswg.org/cssom-view/#dom-window-scrollx
function activateScrollHandling() {
    if (popstateListeners.size !== 0) {
        return
    }

    previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
}

function deactivateScrollHandling() {
    if (popstateListeners.size !== 0 || previousScrollRestoration === null) {
        return
    }

    window.history.scrollRestoration = previousScrollRestoration
    previousScrollRestoration = null
}

// The document scroll offset recorded on the leaving entry.
function computeScroll() {
    return { left: window.scrollX, top: window.scrollY }
}

// Reconstruct the flat primitives into the object the History API stores. '' decodes back to null
// so the round-tripped state matches the .NET RouterHistoryState exactly.
function buildStateObject(back, current, forward, replaced, position, scroll) {
    return {
        back: back.length ? back : null,
        current: current,
        forward: forward.length ? forward : null,
        replaced: replaced,
        position: position,
        scroll: scroll
    }
}

export async function initialize() {
    // Bind the single .NET popstate dispatch ([V01.01.08.02]): one JSExport carries the arrived
    // entry's location + state as primitives and routes by subscription id.
    const { getAssemblyExports } = await globalThis.getDotnetRuntime(0)
    const exports = await getAssemblyExports('Assimalign.Viu.Browser.Router')
    dispatchPopState =
        exports.Assimalign.Viu.Browser.Router.BrowserHistoryInteropDispatch.DispatchPopState
}

export const history = {
    // Batched read: raw location components + the current entry's state in a single crossing.
    readSnapshot: () => {
        const state = window.history.state
        const hasState = !!(state && typeof state.position === 'number')
        const scroll = hasState && state.scroll ? state.scroll : null
        return [
            window.location.pathname,
            window.location.search,
            window.location.hash,
            window.location.host,
            String(window.history.length),
            hasState ? '1' : '0',
            hasState && state.back ? state.back : '',
            hasState && state.current ? state.current : '',
            hasState && state.forward ? state.forward : '',
            hasState && state.replaced ? '1' : '0',
            hasState ? String(state.position | 0) : '0',
            scroll ? '1' : '0',
            scroll ? String(scroll.left) : '0',
            scroll ? String(scroll.top) : '0'
        ]
    },

    // The document <base> href, or null — the web-mode default when no base is configured.
    readBaseHref: () => {
        const element = document.querySelector('base')
        return element ? element.getAttribute('href') : null
    },

    // Push: rewrite the leaving entry (recording its live scroll) then push the new one — the two
    // changeLocation calls of useHistoryStateNavigation.push, collapsed into one interop crossing.
    push: (subscriptionIdentifier,
           currentUrl, amendedBack, amendedCurrent, amendedForward, amendedReplaced, amendedPosition,
           toUrl, newBack, newCurrent, newForward, newReplaced, newPosition,
           newHasScroll, newScrollLeft, newScrollTop) => {
        const leavingScroll = computeScroll()
        const positions = savedPositionsBySubscription.get(subscriptionIdentifier)
        if (positions) {
            positions.set(amendedPosition, leavingScroll)
        }
        const amended = buildStateObject(
            amendedBack, amendedCurrent, amendedForward, amendedReplaced, amendedPosition, leavingScroll)
        window.history.replaceState(amended, '', currentUrl)
        const created = buildStateObject(
            newBack, newCurrent, newForward, newReplaced, newPosition,
            newHasScroll ? { left: newScrollLeft, top: newScrollTop } : null)
        window.history.pushState(created, '', toUrl)
        if (currentPositions.has(subscriptionIdentifier)) {
            currentPositions.set(subscriptionIdentifier, newPosition)
        }
    },

    // Replace: a single replaceState — the one changeLocation of useHistoryStateNavigation.replace.
    replace: (subscriptionIdentifier,
              url, back, current, forward, replaced, position, hasScroll, scrollLeft, scrollTop) => {
        const state = buildStateObject(
            back, current, forward, replaced, position,
            hasScroll ? { left: scrollLeft, top: scrollTop } : null)
        window.history.replaceState(state, '', url)
        if (currentPositions.has(subscriptionIdentifier)) {
            currentPositions.set(subscriptionIdentifier, position)
        }
    },

    go: (delta) => window.history.go(delta),

    // Resolve a selector only after .NET's post-render wait, then apply coordinates and motion in
    // one call. Offsets are subtracted so a fixed header can reserve its document-space extent.
    scroll: (selector, hasPosition, left, top, offsetLeft, offsetTop, smooth) => {
        if (hasPosition) {
            window.scrollTo({ left: left, top: top, behavior: smooth ? 'smooth' : 'instant' })
            return
        }

        const element = document.querySelector(selector)
        if (!element) {
            return
        }

        const bounds = element.getBoundingClientRect()
        window.scrollTo({
            left: bounds.left + window.scrollX - offsetLeft,
            top: bounds.top + window.scrollY - offsetTop,
            behavior: smooth ? 'smooth' : 'instant'
        })
    },

    // Attach exactly one popstate listener for this history instance. The listener forwards the
    // arrived entry's location + state to the .NET dispatch as primitives, then .NET computes the
    // signed delta/direction against its cached state.
    subscribe: (subscriptionIdentifier) => {
        activateScrollHandling()
        const savedPositions = new Map()
        savedPositionsBySubscription.set(subscriptionIdentifier, savedPositions)
        const initialState = window.history.state
        currentPositions.set(
            subscriptionIdentifier,
            initialState && typeof initialState.position === 'number'
                ? (initialState.position | 0)
                : 0)
        const handler = (event) => {
            if (!dispatchPopState) {
                return
            }
            const state = event.state
            const hasState = !!(state && typeof state.position === 'number')
            const leavingPosition = currentPositions.get(subscriptionIdentifier)
            if (typeof leavingPosition === 'number') {
                savedPositions.set(leavingPosition, computeScroll())
            }
            const arrivedPosition = hasState ? (state.position | 0) : 0
            currentPositions.set(subscriptionIdentifier, arrivedPosition)
            const scroll = hasState
                ? (savedPositions.get(arrivedPosition) ?? state.scroll ?? null)
                : null
            dispatchPopState(
                subscriptionIdentifier,
                window.location.pathname,
                window.location.search,
                window.location.hash,
                window.location.host,
                window.history.length,
                hasState,
                hasState ? (state.back ?? null) : null,
                hasState ? (state.current ?? '') : '',
                hasState ? (state.forward ?? null) : null,
                hasState ? !!state.replaced : false,
                hasState ? (state.position | 0) : 0,
                scroll ? true : false,
                scroll ? scroll.left : 0,
                scroll ? scroll.top : 0)
        }
        popstateListeners.set(subscriptionIdentifier, handler)
        window.addEventListener('popstate', handler)
    },

    // Deterministic teardown: remove this instance's popstate listener so nothing leaks.
    unsubscribe: (subscriptionIdentifier) => {
        const handler = popstateListeners.get(subscriptionIdentifier)
        if (handler) {
            window.removeEventListener('popstate', handler)
            popstateListeners.delete(subscriptionIdentifier)
            currentPositions.delete(subscriptionIdentifier)
            savedPositionsBySubscription.delete(subscriptionIdentifier)
            deactivateScrollHandling()
        }
    }
}
