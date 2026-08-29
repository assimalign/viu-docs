// The JS half of the Assimalign.Viu.Browser interop bridge: the dumb applier behind the host
// operations Core's renderer needs. Policy lives in C#; this file only executes.
//
// Contract notes:
// - Handles are positive integers; 0 is the reserved "no node" sentinel.
// - Handle lifecycle is deterministic: removing a node releases the handles and DOM listeners
//   of every registered node in the removed subtree (no sweeps, no leaks). [V01.01.04.01]
// - Failures throw structured errors ("viu-dom|<operation>|<handle>|<message>") that the C#
//   side rethrows as typed BrowserDomException instances.
// - Keep every function a dumb leaf applier: decision logic (patchProp, diffing) lives on the
//   .NET side so ops stay expressible as opcodes for the command buffer ([V01.01.04.05]).

const namespaceUris = {
    svg: 'http://www.w3.org/2000/svg',
    mathml: 'http://www.w3.org/1998/Math/MathML'
}

const xlinkNamespaceUri = 'http://www.w3.org/1999/xlink'

let nextHandle = 1
const nodes = new Map()          // handle -> Node
const nodeHandles = new WeakMap() // Node -> handle
const listeners = new Map()      // handle -> Map(eventName -> listener)

let dispatchEvent = null         // the single [JSExport] dispatch entry ([V01.01.04.03])

function fail(operation, handle, message) {
    throw new Error(`viu-dom|${operation}|${handle}|${message}`)
}

// Hydration snapshot serializers ([V01.01.07.03]): ints are space-terminated decimals; strings are
// length-prefixed (`<len>:<chars> `) so arbitrary content needs no escaping. The length is a UTF-16
// code-unit count, matching .NET string.Length, so the reader takes exactly that many chars.
function writeSnapshotInt(parts, value) {
    parts.push(value + ' ')
}

function writeSnapshotString(parts, value) {
    const text = value == null ? '' : String(value)
    parts.push(text.length + ':' + text + ' ')
}

function registerNode(node) {
    const existingHandle = nodeHandles.get(node)
    if (existingHandle !== undefined) {
        return existingHandle
    }

    const handle = nextHandle++
    nodeHandles.set(node, handle)
    nodes.set(handle, node)
    return handle
}

function getNode(operation, handle) {
    const node = nodes.get(handle)
    if (!node) {
        fail(operation, handle, 'unknown DOM handle')
    }

    return node
}

function releaseNodeHandle(node, released) {
    const handle = nodeHandles.get(node)
    if (handle === undefined) {
        return
    }

    const nodeListeners = listeners.get(handle)
    if (nodeListeners) {
        for (const entry of nodeListeners.values()) {
            node.removeEventListener(entry.eventName, entry.listener, { capture: entry.capture })
        }
        listeners.delete(handle)
    }

    nodes.delete(handle)
    nodeHandles.delete(node)
    released.push(handle)
}

// Deterministic disposal: release the handle/listeners of every registered node inside the
// subtree rooted at `node`, including `node` itself. Returns the released handles so the
// .NET side can drop its listener-delegate entries for the same nodes in the same call.
function releaseSubtree(node, released) {
    releaseNodeHandle(node, released)
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return released
    }

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ALL)
    let current = walker.nextNode()
    while (current) {
        releaseNodeHandle(current, released)
        current = walker.nextNode()
    }

    return released
}

// Shared cores of setElementText/remove so the direct ops and the command-buffer applier release
// handles identically (the applier collects them into one batch-wide array). [V01.01.04.05]
function applySetElementText(nodeHandle, textContent, released) {
    const element = getNode('setElementText', nodeHandle)
    let child = element.firstChild
    while (child) {
        releaseSubtree(child, released)
        child = child.nextSibling
    }
    element.textContent = textContent
}

function applyRemove(childHandle, released) {
    const child = getNode('remove', childHandle)
    if (child.parentNode) {
        child.parentNode.removeChild(child)
    }
    releaseSubtree(child, released)
}

// --- command buffer ([V01.01.04.05]) --------------------------------------------------------------
// The batched applier: the whole frame of node-ops crosses the boundary once per scheduler flush as
// a MemoryView over WASM memory, is decoded by a static switch (no dynamic dispatch), and returns
// every handle it released so the .NET side purges its invoker delegates in the same single call.
// The frame layout and opcodes are the wire contract of DomCommandBuffer.cs; the leading magic and
// version bytes make drift fail loudly. Buffered mode is behaviorally identical to the direct ops
// (the void ops below reuse the exact same dom.* leaves).

const COMMAND_MAGIC = 0xB6
// 0x02 added the transition class / reflow-barrier opcodes ([V01.01.04.07.02]); 0x03 added the FLIP move
// opcodes (24/25) and, with the move deltas, the first float64 operands ([V01.01.04.07.03]).
const COMMAND_VERSION = 0x03
const textDecoder = new TextDecoder()

// Register a node AS a handle the .NET side pre-allocated (a one-way buffered create cannot return
// the id). Never advances nextHandle past the .NET counter; the frame header carries that.
function registerNodeAs(handle, node) {
    nodes.set(handle, node)
    nodeHandles.set(node, handle)
    if (handle >= nextHandle) {
        nextHandle = handle + 1
    }
}

function createElementAs(handle, tagName, namespaceName) {
    try {
        const namespaceUri = namespaceName ? namespaceUris[namespaceName] : undefined
        const element = namespaceUri
            ? document.createElementNS(namespaceUri, tagName)
            : document.createElement(tagName)
        registerNodeAs(handle, element)
    } catch (error) {
        fail('createElement', handle, `cannot create <${tagName}>: ${error.message}`)
    }
}

function createTextAs(handle, textContent) {
    registerNodeAs(handle, document.createTextNode(textContent))
}

function createCommentAs(handle, textContent) {
    registerNodeAs(handle, document.createComment(textContent))
}

// Read the frame bytes out of the MemoryView. slice() returns a Uint8Array copy of the whole view;
// copyTo is the fallback for runtimes that expose only it. This is one batched read, not per-op.
function readCommandFrame(memoryView) {
    if (typeof memoryView.slice === 'function') {
        return memoryView.slice()
    }
    const length = memoryView.byteLength !== undefined ? memoryView.byteLength : memoryView.length
    const target = new Uint8Array(length)
    memoryView.copyTo(target)
    return target
}

function readCommandStrings(bytes, view, offset) {
    const count = view.getInt32(offset, true)
    offset += 4
    const strings = new Array(count)
    for (let index = 0; index < count; index++) {
        const byteLength = view.getInt32(offset, true)
        offset += 4
        strings[index] = textDecoder.decode(bytes.subarray(offset, offset + byteLength))
        offset += byteLength
    }
    return strings
}

// --- transition end-detection ([V01.01.04.07]) -----------------------------------------------------
// Read getComputedStyle, distinguish transition vs animation, pick the longer when both exist, and
// count transitioned properties. This runs JS-side because it is a computed-style read: doing it in
// .NET would cost one boundary crossing per property. Used by dom.whenTransitionEnds and
// dom.hasCssTransform.

const TRANSITION = 'transition'
const ANIMATION = 'animation'

function toMs(s) {
    if (s === 'auto') return 0
    return Number(s.slice(0, -1).replace(',', '.')) * 1000
}

function getTimeout(delays, durations) {
    while (delays.length < durations.length) {
        delays = delays.concat(delays)
    }
    return Math.max(...durations.map((d, i) => toMs(d) + toMs(delays[i])))
}

function getTransitionInfo(el, expectedType) {
    const styles = window.getComputedStyle(el)
    const getStyleProperties = key => (styles[key] || '').split(', ')
    const transitionDelays = getStyleProperties(TRANSITION + 'Delay')
    const transitionDurations = getStyleProperties(TRANSITION + 'Duration')
    const transitionTimeout = getTimeout(transitionDelays, transitionDurations)
    const animationDelays = getStyleProperties(ANIMATION + 'Delay')
    const animationDurations = getStyleProperties(ANIMATION + 'Duration')
    const animationTimeout = getTimeout(animationDelays, animationDurations)

    let type = null
    let timeout = 0
    let propCount = 0
    if (expectedType === TRANSITION) {
        if (transitionTimeout > 0) {
            type = TRANSITION
            timeout = transitionTimeout
            propCount = transitionDurations.length
        }
    } else if (expectedType === ANIMATION) {
        if (animationTimeout > 0) {
            type = ANIMATION
            timeout = animationTimeout
            propCount = animationDurations.length
        }
    } else {
        timeout = Math.max(transitionTimeout, animationTimeout)
        type = timeout > 0 ? (transitionTimeout > animationTimeout ? TRANSITION : ANIMATION) : null
        propCount = type ? (type === TRANSITION ? transitionDurations.length : animationDurations.length) : 0
    }
    const hasTransform =
        type === TRANSITION &&
        /\b(transform|all)(,|$)/.test(getStyleProperties(TRANSITION + 'Property').toString())
    return { type, timeout, propCount, hasTransform }
}

// Deferred hydration registrations ([V01.01.07.03.01]): Core supplies marker handles and immutable
// strategy data. Browser owns observers/listeners and releases them on activation or cancellation.
// The numeric kinds are the stable HydrationStrategyKind values emitted by managed code.
const HYDRATE_ON_IDLE = 1
const HYDRATE_ON_VISIBLE = 2
const HYDRATE_ON_MEDIA_QUERY = 3
const HYDRATE_ON_INTERACTION = 4
let nextHydrationTriggerToken = 1
const hydrationTriggers = new Map()

function enqueueMicrotask(callback) {
    if (typeof globalThis.queueMicrotask === 'function') {
        globalThis.queueMicrotask(callback)
    } else {
        Promise.resolve().then(callback)
    }
}

function boundaryContainsTarget(start, end, target) {
    let current = start.nextSibling
    while (current && current !== end) {
        if (current === target ||
            (current.nodeType === Node.ELEMENT_NODE && current.contains(target))) {
            return true
        }
        current = current.nextSibling
    }
    return false
}

function boundaryElements(start, end) {
    const elements = []
    let current = start.nextSibling
    while (current && current !== end) {
        if (current.nodeType === Node.ELEMENT_NODE) {
            elements.push(current)
        }
        current = current.nextSibling
    }
    return elements
}

function fireHydrationTrigger(registration) {
    if (registration.fired || registration.cancelled || typeof registration.trigger !== 'function') {
        return
    }

    registration.fired = true
    registration.cleanup()
    registration.cleanup = () => {}
    const trigger = registration.trigger
    registration.trigger = null
    enqueueMicrotask(trigger)
}

function replayInteraction(interaction) {
    if (!interaction || !interaction.target.isConnected) {
        return
    }

    const source = interaction.event
    let replay
    try {
        replay = new source.constructor(source.type, source)
    } catch {
        replay = new Event(source.type, {
            bubbles: source.bubbles,
            cancelable: source.cancelable,
            composed: source.composed
        })
    }
    interaction.target.dispatchEvent(replay)
}

export async function initialize() {
    // Bind the single .NET dispatch entry point ([V01.01.04.03]): one JSExport carries the
    // whole typed payload as primitives and returns stop/prevent flags for the live event.
    const { getAssemblyExports } = await globalThis.getDotnetRuntime(0)
    const exports = await getAssemblyExports('Assimalign.Viu.Browser')
    dispatchEvent = exports.Assimalign.Viu.Browser.BrowserEventDispatch.DispatchBrowserEvent
}

export const dom = {
    querySelector: selector => {
        const node = document.querySelector(selector)
        if (!node) {
            fail('querySelector', 0, `no DOM node matches selector '${selector}'`)
        }

        return registerNode(node)
    },

    consumeTextContent: selector => {
        const node = document.querySelector(selector)
        if (!node) {
            return ''
        }

        const textContent = node.textContent ?? ''
        node.remove()
        return textContent
    },

    scheduleHydrationTrigger: (
        startHandle,
        endHandle,
        strategyKind,
        timeoutMilliseconds,
        condition,
        eventNames,
        trigger) => {
        const start = getNode('scheduleHydrationTrigger', startHandle)
        const end = getNode('scheduleHydrationTrigger', endHandle)
        if (!start.parentNode || start.parentNode !== end.parentNode) {
            fail('scheduleHydrationTrigger', startHandle, 'boundary markers do not share a parent')
        }

        const token = nextHydrationTriggerToken++
        const registration = {
            cancelled: false,
            cleanup: () => {},
            fired: false,
            pendingInteraction: null,
            trigger
        }
        hydrationTriggers.set(token, registration)

        try {
            if (strategyKind === HYDRATE_ON_IDLE) {
                if (typeof globalThis.requestIdleCallback === 'function') {
                    const options = timeoutMilliseconds >= 0
                        ? { timeout: timeoutMilliseconds }
                        : undefined
                    const idleToken = globalThis.requestIdleCallback(
                        () => fireHydrationTrigger(registration),
                        options)
                    registration.cleanup = () => globalThis.cancelIdleCallback?.(idleToken)
                } else {
                    const delay = timeoutMilliseconds >= 0 ? timeoutMilliseconds : 1
                    const timeoutToken = globalThis.setTimeout(
                        () => fireHydrationTrigger(registration),
                        delay)
                    registration.cleanup = () => globalThis.clearTimeout(timeoutToken)
                }
            } else if (strategyKind === HYDRATE_ON_VISIBLE) {
                const elements = boundaryElements(start, end)
                if (elements.length === 0 || typeof globalThis.IntersectionObserver !== 'function') {
                    enqueueMicrotask(() => fireHydrationTrigger(registration))
                } else {
                    const observer = new globalThis.IntersectionObserver(entries => {
                        if (entries.some(entry => entry.isIntersecting)) {
                            fireHydrationTrigger(registration)
                        }
                    }, { rootMargin: condition || '0px' })
                    for (const element of elements) {
                        observer.observe(element)
                    }
                    registration.cleanup = () => observer.disconnect()
                }
            } else if (strategyKind === HYDRATE_ON_MEDIA_QUERY) {
                const media = globalThis.matchMedia(condition)
                const onChange = event => {
                    if (event.matches) {
                        fireHydrationTrigger(registration)
                    }
                }
                if (typeof media.addEventListener === 'function') {
                    media.addEventListener('change', onChange)
                    registration.cleanup = () => media.removeEventListener('change', onChange)
                } else {
                    media.addListener(onChange)
                    registration.cleanup = () => media.removeListener(onChange)
                }
                if (media.matches) {
                    enqueueMicrotask(() => fireHydrationTrigger(registration))
                }
            } else if (strategyKind === HYDRATE_ON_INTERACTION) {
                const parent = start.parentNode
                const onInteraction = event => {
                    if (!boundaryContainsTarget(start, end, event.target)) {
                        return
                    }

                    if (event.cancelable) {
                        event.preventDefault()
                    }
                    event.stopImmediatePropagation()
                    registration.pendingInteraction = { event, target: event.target }
                    fireHydrationTrigger(registration)
                }
                for (const eventName of eventNames) {
                    parent.addEventListener(eventName, onInteraction, true)
                }
                registration.cleanup = () => {
                    for (const eventName of eventNames) {
                        parent.removeEventListener(eventName, onInteraction, true)
                    }
                }
            } else {
                fail('scheduleHydrationTrigger', startHandle, `unknown strategy kind ${strategyKind}`)
            }
        } catch (error) {
            registration.cleanup()
            hydrationTriggers.delete(token)
            if (String(error.message).startsWith('viu-dom|')) {
                throw error
            }
            fail('scheduleHydrationTrigger', startHandle, error.message)
        }

        return token
    },

    completeHydrationTrigger: token => {
        const registration = hydrationTriggers.get(token)
        if (!registration) {
            return
        }

        registration.cleanup()
        hydrationTriggers.delete(token)
        const interaction = registration.pendingInteraction
        registration.pendingInteraction = null
        enqueueMicrotask(() => replayInteraction(interaction))
    },

    cancelHydrationTrigger: token => {
        const registration = hydrationTriggers.get(token)
        if (!registration) {
            return
        }

        registration.cleanup()
        registration.cancelled = true
        registration.pendingInteraction = null
        registration.trigger = null
        hydrationTriggers.delete(token)
    },

    createElement: (tagName, namespaceName) => {
        try {
            const namespaceUri = namespaceName ? namespaceUris[namespaceName] : undefined
            const element = namespaceUri
                ? document.createElementNS(namespaceUri, tagName)
                : document.createElement(tagName)
            return registerNode(element)
        } catch (error) {
            fail('createElement', 0, `cannot create <${tagName}>: ${error.message}`)
        }
    },

    createText: textContent => registerNode(document.createTextNode(textContent)),

    createComment: textContent => registerNode(document.createComment(textContent)),

    setText: (nodeHandle, textContent) => {
        getNode('setText', nodeHandle).textContent = textContent
    },

    setElementText: (nodeHandle, textContent) => {
        // Replacing content drops any registered child handles deterministically first.
        const released = []
        applySetElementText(nodeHandle, textContent, released)
        return released
    },

    insert: (parentHandle, childHandle, anchorHandle) => {
        const parent = getNode('insert', parentHandle)
        const child = getNode('insert', childHandle)
        if (anchorHandle === 0) {
            parent.appendChild(child)
            return
        }

        const anchor = getNode('insert', anchorHandle)
        if (anchor.parentNode !== parent) {
            fail('insert', anchorHandle, 'anchor is not a child of the target parent')
        }

        parent.insertBefore(child, anchor)
    },

    remove: childHandle => {
        const released = []
        applyRemove(childHandle, released)
        return released
    },

    parentNode: nodeHandle => {
        const parent = getNode('parentNode', nodeHandle).parentNode
        return parent ? registerNode(parent) : 0
    },

    nextSibling: nodeHandle => {
        const sibling = getNode('nextSibling', nodeHandle).nextSibling
        return sibling ? registerNode(sibling) : 0
    },

    // Hydration snapshot ([V01.01.07.03]): ONE batched interop crossing walks the whole subtree rooted at
    // the container, registers a handle for every node, and returns a compact serialization the .NET
    // BrowserHydrationReader answers all subsequent structure/kind/data/attribute reads from — so the
    // client-side hydration walk crosses the boundary once per root (and once per teleport target) instead
    // of a marshaled call per firstChild/nextSibling/getAttribute. Per node the wire format is
    //   handle parent firstChild nextSibling kind  (five space-terminated ints; kind 0/1/2/3)
    // then, for an element, `tag attrCount [name value]*`, else `data` — every string written length-
    // prefixed as `<len>:<chars> ` so arbitrary text/attribute content needs no escaping. Reads are
    // idempotent (registerNode dedups), so re-snapshotting a target that overlaps the root is harmless.
    snapshotHydration: containerHandle => {
        const container = getNode('snapshotHydration', containerHandle)
        const nodes = [container]
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_ALL)
        let current = walker.nextNode()
        while (current) {
            nodes.push(current)
            current = walker.nextNode()
        }
        const parts = []
        writeSnapshotInt(parts, nodes.length)
        for (let index = 0; index < nodes.length; index++) {
            const node = nodes[index]
            const isRoot = node === container
            writeSnapshotInt(parts, registerNode(node))
            writeSnapshotInt(parts, isRoot || !node.parentNode ? 0 : registerNode(node.parentNode))
            writeSnapshotInt(parts, node.firstChild ? registerNode(node.firstChild) : 0)
            writeSnapshotInt(parts, isRoot || !node.nextSibling ? 0 : registerNode(node.nextSibling))
            if (node.nodeType === Node.ELEMENT_NODE) {
                writeSnapshotInt(parts, 0)
                writeSnapshotString(parts, node.tagName)
                const attributes = node.attributes
                writeSnapshotInt(parts, attributes.length)
                for (let a = 0; a < attributes.length; a++) {
                    writeSnapshotString(parts, attributes[a].name)
                    writeSnapshotString(parts, attributes[a].value)
                }
            } else if (node.nodeType === Node.TEXT_NODE) {
                writeSnapshotInt(parts, 1)
                writeSnapshotString(parts, node.data)
            } else if (node.nodeType === Node.COMMENT_NODE) {
                writeSnapshotInt(parts, 2)
                writeSnapshotString(parts, node.data)
            } else {
                writeSnapshotInt(parts, 3)
                writeSnapshotString(parts, node.data || '')
            }
        }
        return parts.join('')
    },

    // Inserts a multi-node static HTML chunk in ONE interop call via a detached <template>,
    // returning [firstHandle, lastHandle] as anchors for later patches.
    insertStaticContent: (content, parentHandle, anchorHandle, namespaceName) => {
        const parent = getNode('insertStaticContent', parentHandle)
        const anchor = anchorHandle === 0 ? null : getNode('insertStaticContent', anchorHandle)
        const template = document.createElement('template')
        if (namespaceName === 'svg' || namespaceName === 'mathml') {
            // Parse inside the foreign-content root, then unwrap: SVG and MathML markup only parses
            // correctly under its own root element.
            template.innerHTML = namespaceName === 'svg' ? `<svg>${content}</svg>` : `<math>${content}</math>`
            const wrapper = template.content.firstChild
            const fragment = document.createDocumentFragment()
            while (wrapper.firstChild) {
                fragment.appendChild(wrapper.firstChild)
            }
            template.content.replaceChildren(fragment)
        } else {
            template.innerHTML = content
        }

        const first = template.content.firstChild
        const last = template.content.lastChild
        if (!first) {
            fail('insertStaticContent', parentHandle, 'static content produced no nodes')
        }

        parent.insertBefore(template.content, anchor)
        return [registerNode(first), registerNode(last)]
    },

    // --- element property/attribute leaves (driven by the .NET patchProp engine) -----------

    setAttribute: (nodeHandle, name, value) => {
        try {
            getNode('setAttribute', nodeHandle).setAttribute(name, value)
        } catch (error) {
            fail('setAttribute', nodeHandle, `cannot set '${name}': ${error.message}`)
        }
    },

    removeAttribute: (nodeHandle, name) => {
        getNode('removeAttribute', nodeHandle).removeAttribute(name)
    },

    setXlinkAttribute: (nodeHandle, name, value) => {
        getNode('setXlinkAttribute', nodeHandle).setAttributeNS(xlinkNamespaceUri, name, value)
    },

    removeXlinkAttribute: (nodeHandle, name) => {
        getNode('removeXlinkAttribute', nodeHandle)
            .removeAttributeNS(xlinkNamespaceUri, name.slice('xlink:'.length))
    },

    setClassName: (nodeHandle, value) => {
        getNode('setClassName', nodeHandle).className = value
    },

    setStringProperty: (nodeHandle, name, value) => {
        getNode('setStringProperty', nodeHandle)[name] = value
    },

    setBooleanProperty: (nodeHandle, name, value) => {
        getNode('setBooleanProperty', nodeHandle)[name] = value
    },

    // Compare-and-set in one interop call so an unchanged value never touches the DOM —
    // protects caret position and in-progress IME composition.
    setValueGuarded: (nodeHandle, value) => {
        const element = getNode('setValueGuarded', nodeHandle)
        if (element.value !== value) {
            element.value = value
        }
    },

    setStyleText: (nodeHandle, cssText) => {
        getNode('setStyleText', nodeHandle).style.cssText = cssText
    },

    setStyleProperty: (nodeHandle, name, value, important) => {
        getNode('setStyleProperty', nodeHandle).style
            .setProperty(name, value, important ? 'important' : '')
    },

    removeStyleProperty: (nodeHandle, name) => {
        getNode('removeStyleProperty', nodeHandle).style.removeProperty(name)
    },

    // Batches the v-bind() CSS custom properties for one root element into a single crossing
    // ([V01.01.06.06]): the .NET UseCssVariables runtime passes index-aligned name/value arrays (names include
    // the leading '--') and this loops style.setProperty.
    setCssVars: (nodeHandle, names, values) => {
        const style = getNode('setCssVars', nodeHandle).style
        for (let index = 0; index < names.length; index++) {
            style.setProperty(names[index], values[index])
        }
    },

    // --- events (invoker pattern: one listener per (element, event, capture); handler
    // changes are .NET-side delegate swaps with no listener churn; the attach-timestamp guard
    // ignores events that fired before their listener was attached, by comparing e.timeStamp
    // against the attach time) ----------------------------------------------------------------

    addEventListener: (nodeHandle, eventName, once, capture, passive) => {
        const node = getNode('addEventListener', nodeHandle)
        let nodeListeners = listeners.get(nodeHandle)
        if (!nodeListeners) {
            nodeListeners = new Map()
            listeners.set(nodeHandle, nodeListeners)
        }

        const listenerKey = capture ? eventName + '|capture' : eventName
        if (nodeListeners.has(listenerKey)) {
            return
        }

        const attached = performance.now()
        const listener = event => {
            // An event that fired before this listener attached (e.g. one bubbling into a parent
            // whose handler landed in the same patch) is ignored: it predates the handler.
            if (event.timeStamp < attached) {
                return
            }
            if (!dispatchEvent) {
                return
            }

            const target = event.target
            const hasValue = target && typeof target.value !== 'undefined'
            // <select multiple> v-model reads the selected option values here rather than issuing
            // a follow-up interop read per change ([V01.01.04.06]); null for every other target.
            const selectedValues = (target && target.multiple && target.options)
                ? Array.prototype.filter.call(target.options, option => option.selected).map(option => option.value)
                : null
            const flags = dispatchEvent(
                nodeHandle,
                eventName,
                capture,
                event.timeStamp,
                event.key ?? '',
                event.code ?? '',
                (event.ctrlKey ? 1 : 0) | (event.shiftKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0),
                typeof event.button === 'number' ? event.button : -1,
                event.buttons ?? 0,
                event.clientX ?? 0,
                event.clientY ?? 0,
                event.detail ?? 0,
                target === event.currentTarget,
                hasValue ? String(target.value) : null,
                !!(target && target.checked),
                // The live event's arrival-time preventDefault, so a host bridge can honor a router
                // link's already-prevented bail ([V01.01.08.03.01]).
                event.defaultPrevented,
                selectedValues)
            if (flags & 1) {
                event.stopPropagation()
            }
            if (flags & 2) {
                event.preventDefault()
            }
        }

        node.addEventListener(eventName, listener, { once: !!once, capture: !!capture, passive: !!passive })
        nodeListeners.set(listenerKey, { eventName, listener, capture: !!capture })
    },

    removeEventListener: (nodeHandle, eventName, capture) => {
        const node = nodes.get(nodeHandle)
        if (!node) {
            return
        }

        const nodeListeners = listeners.get(nodeHandle)
        const listenerKey = capture ? eventName + '|capture' : eventName
        const entry = nodeListeners?.get(listenerKey)
        if (!entry) {
            return
        }

        node.removeEventListener(eventName, entry.listener, { capture: entry.capture })
        nodeListeners.delete(listenerKey)
        if (nodeListeners.size === 0) {
            listeners.delete(nodeHandle)
        }
    },

    // --- diagnostics ------------------------------------------------------------------------

    // Registry sizes for leak assertions (the [V01.01.04.01] stress criterion): [nodes, listener maps].
    getRegistrySizes: () => [nodes.size, listeners.size],

    // --- transitions ([V01.01.04.07]) -------------------------------------------------------
    // The DOM-side contract of DomTransitionOperations: classList add/remove tracked in el.__vtc,
    // the double-rAF next frame, the forced reflow, transitionend/animationend end-detection, and
    // the FLIP getBoundingClientRect/transform ops. In direct mode these are called one op per crossing;
    // in buffered mode addTransitionClass/removeTransitionClass/forceReflow ([V01.01.04.07.02], opcodes
    // 21/22/23) and setMoveTransform/clearMoveStyles ([V01.01.04.07.03], opcodes 24/25) are reached
    // through the command buffer so the class + FLIP-transform sequence stays ordered with the node ops
    // and the reflow barrier lands between them. The batched FLIP read (measurePositions) and the rAF/
    // listener ops (nextFrame, whenTransitionEnds, whenMoveEnds, hasCssTransform) stay direct — the
    // buffered adaptor forces a flush before each so they observe committed classes/layout, and
    // measurePositions reads every child's rect in one crossing rather than one per child.

    addTransitionClass: (nodeHandle, cssClass) => {
        const el = getNode('addTransitionClass', nodeHandle)
        cssClass.split(/\s+/).forEach(c => c && el.classList.add(c))
        ;(el.__vtc || (el.__vtc = new Set())).add(cssClass)
    },

    removeTransitionClass: (nodeHandle, cssClass) => {
        const el = getNode('removeTransitionClass', nodeHandle)
        cssClass.split(/\s+/).forEach(c => c && el.classList.remove(c))
        if (el.__vtc) {
            el.__vtc.delete(cssClass)
            if (!el.__vtc.size) el.__vtc = undefined
        }
    },

    // Wait for two animation frames so the from-class has painted before the to-class is applied
    // the browser coalesces a same-frame class add+remove otherwise, and nothing animates.
    nextFrame: callback => {
        requestAnimationFrame(() => requestAnimationFrame(() => callback()))
    },

    forceReflow: () => document.body.offsetHeight,

    // Resolve when the element's transition/animation ends, or after a fallback timeout.
    // A stale-guard (el.__endId) ignores a resolve superseded by a newer call.
    whenTransitionEnds: (nodeHandle, expectedType, explicitTimeout, resolve) => {
        const el = getNode('whenTransitionEnds', nodeHandle)
        const id = (el.__endId = (el.__endId || 0) + 1)
        const resolveIfNotStale = () => { if (id === el.__endId) resolve() }
        if (explicitTimeout >= 0) {
            setTimeout(resolveIfNotStale, explicitTimeout)
            return
        }
        const info = getTransitionInfo(el, expectedType || undefined)
        if (!info.type) { resolve(); return }
        const endEvent = info.type + 'end'
        let ended = 0
        const end = () => { el.removeEventListener(endEvent, onEnd); resolveIfNotStale() }
        const onEnd = e => { if (e.target === el && ++ended >= info.propCount) end() }
        setTimeout(() => { if (ended < info.propCount) end() }, info.timeout + 1)
        el.addEventListener(endEvent, onEnd)
    },

    // Batched FLIP snapshot read ([V01.01.04.07.03]): N element handles cross the boundary once and the
    // flat [left0, top0, scaleX0, scaleY0, ...] result returns once, so reordering N children costs a
    // single interop crossing per pass rather than one per child. The scale terms keep the measured
    // move distance correct under transformed ancestors, where a raw rect delta would be scaled.
    // Decision logic (deltas, who moved) stays .NET-side.
    measurePositions: handles => {
        const result = new Array(handles.length * 4)
        for (let index = 0; index < handles.length; index++) {
            const element = getNode('measurePositions', handles[index])
            const rect = element.getBoundingClientRect()
            let horizontalScale = element.offsetWidth ? rect.width / element.offsetWidth : 1
            let verticalScale = element.offsetHeight ? rect.height / element.offsetHeight : 1
            if (!Number.isFinite(horizontalScale) || horizontalScale === 0) horizontalScale = 1
            if (!Number.isFinite(verticalScale) || verticalScale === 0) verticalScale = 1
            if (Math.abs(horizontalScale - 1) < 0.01) horizontalScale = 1
            if (Math.abs(verticalScale - 1) < 0.01) verticalScale = 1
            result[index * 4] = rect.left
            result[index * 4 + 1] = rect.top
            result[index * 4 + 2] = horizontalScale
            result[index * 4 + 3] = verticalScale
        }
        return result
    },

    setMoveTransform: (nodeHandle, deltaX, deltaY) => {
        const style = getNode('setMoveTransform', nodeHandle).style
        style.transform = style.webkitTransform = `translate(${deltaX}px,${deltaY}px)`
        style.transitionDuration = '0s'
    },

    clearMoveStyles: nodeHandle => {
        const style = getNode('clearMoveStyles', nodeHandle).style
        style.transform = style.webkitTransform = style.transitionDuration = ''
    },

    // Clone the element (minus its live transition classes), add the move class, and read whether it
    // gains a transform transition — skips the FLIP when nothing would animate. Probing a clone
    // keeps the live element's in-flight transition undisturbed.
    hasCssTransform: (nodeHandle, rootHandle, moveClass) => {
        const el = getNode('hasCssTransform', nodeHandle)
        const clone = el.cloneNode()
        if (el.__vtc) {
            el.__vtc.forEach(cls => cls.split(/\s+/).forEach(c => c && clone.classList.remove(c)))
        }
        moveClass.split(/\s+/).forEach(c => c && clone.classList.add(c))
        clone.style.display = 'none'
        const root = getNode('hasCssTransform', rootHandle)
        const container = root.nodeType === 1 ? root : root.parentNode
        container.appendChild(clone)
        const { hasTransform } = getTransitionInfo(clone)
        container.removeChild(clone)
        return hasTransform
    },

    // Resolve when the FLIP transform transition ends: only a transform property
    // (or a forced no-event finish) counts, so unrelated transitionend events are ignored.
    whenMoveEnds: (nodeHandle, resolve) => {
        const el = getNode('whenMoveEnds', nodeHandle)
        const cb = e => {
            if (e && e.target !== el) return
            if (!e || /transform$/.test(e.propertyName)) {
                el.removeEventListener('transitionend', cb)
                resolve()
            }
        }
        el.addEventListener('transitionend', cb)
    },

    // Applies one batched command frame ([V01.01.04.05]) and returns the handles it released across
    // the whole batch (the batched analogue of remove/setElementText's per-op return). The void
    // leaves reuse the exact dom.* functions, so buffered output is identical to direct output.
    applyCommandBuffer: memoryView => {
        const bytes = readCommandFrame(memoryView)
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        if (bytes[0] !== COMMAND_MAGIC || bytes[1] !== COMMAND_VERSION) {
            fail('applyCommandBuffer', 0,
                `command buffer version ${bytes[0]}/${bytes[1]} does not match ${COMMAND_MAGIC}/${COMMAND_VERSION}`)
        }
        const operationCount = view.getInt32(2, true)
        const headerNextHandle = view.getInt32(6, true)
        const stringTableOffset = view.getInt32(10, true)
        const strings = readCommandStrings(bytes, view, stringTableOffset)
        const released = []
        let cursor = 14
        // Operand readers advance the cursor; ECMAScript evaluates call arguments left-to-right, so
        // inline reads consume operands in the exact order DomCommandBuffer encoded them.
        const int = () => {
            const value = view.getInt32(cursor, true)
            cursor += 4
            return value
        }
        const flag = () => bytes[cursor++] !== 0
        const num = () => {
            const value = view.getFloat64(cursor, true)
            cursor += 8
            return value
        }
        const str = () => {
            const index = int()
            return index < 0 ? null : strings[index]
        }
        for (let operation = 0; operation < operationCount; operation++) {
            const opcode = bytes[cursor++]
            switch (opcode) {
                case 1: createElementAs(int(), str(), str()); break
                case 2: createTextAs(int(), str()); break
                case 3: createCommentAs(int(), str()); break
                case 4: dom.setText(int(), str()); break
                case 5: applySetElementText(int(), str(), released); break
                case 6: dom.insert(int(), int(), int()); break
                case 7: applyRemove(int(), released); break
                case 8: dom.setAttribute(int(), str(), str()); break
                case 9: dom.removeAttribute(int(), str()); break
                case 10: dom.setXlinkAttribute(int(), str(), str()); break
                case 11: dom.removeXlinkAttribute(int(), str()); break
                case 12: dom.setClassName(int(), str()); break
                case 13: dom.setStringProperty(int(), str(), str()); break
                case 14: dom.setBooleanProperty(int(), str(), flag()); break
                case 15: dom.setValueGuarded(int(), str()); break
                case 16: dom.setStyleText(int(), str()); break
                case 17: dom.setStyleProperty(int(), str(), str(), flag()); break
                case 18: dom.removeStyleProperty(int(), str()); break
                case 19: dom.addEventListener(int(), str(), flag(), flag(), flag()); break
                case 20: dom.removeEventListener(int(), str(), flag()); break
                // Transition class choreography ([V01.01.04.07.02]): class writes are ordered with the
                // node ops, and the reflow barrier (23, no operands) does a real synchronous reflow mid-drain
                // so a leave's *-leave-from commits before *-leave-active in the same single-crossing frame.
                case 21: dom.addTransitionClass(int(), str()); break
                case 22: dom.removeTransitionClass(int(), str()); break
                case 23: dom.forceReflow(); break
                // FLIP move write pass ([V01.01.04.07.03]): every reordered child's inverting transform,
                // then the reflow barrier (23), then the move class (21) + transform clear (25) ride one
                // frame in that order, so N moved children commit in a single interop crossing.
                case 24: dom.setMoveTransform(int(), num(), num()); break
                case 25: dom.clearMoveStyles(int()); break
                default: fail('applyCommandBuffer', 0, `unknown opcode ${opcode}`)
            }
        }
        if (headerNextHandle > nextHandle) {
            nextHandle = headerNextHandle
        }
        return released
    }
}
