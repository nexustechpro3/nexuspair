import { EventEmitter } from 'events'

const emitter = new EventEmitter()
emitter.setMaxListeners(0)

const eventBuffers = new Map()
const bufferTimers = new Map()

const BUFFER_TTL_MS = 5 * 60 * 1000

const TERMINAL_STAGES = new Set(['closed', 'error', 'timeout'])

function clearBufferTimer(requestId) {
    const timer = bufferTimers.get(requestId)
    if (timer) {
        clearTimeout(timer)
        bufferTimers.delete(requestId)
    }
}

function scheduleBufferExpiry(requestId) {
    clearBufferTimer(requestId)
    const timer = setTimeout(() => {
        eventBuffers.delete(requestId)
        bufferTimers.delete(requestId)
    }, BUFFER_TTL_MS)
    timer.unref?.()
    bufferTimers.set(requestId, timer)
}

export function publishEvent(requestId, event) {
    if (!eventBuffers.has(requestId)) {
        eventBuffers.set(requestId, [])
    }
    eventBuffers.get(requestId).push(event)
    scheduleBufferExpiry(requestId)

    emitter.emit(requestId, event)

    if (TERMINAL_STAGES.has(event.stage)) {
        setImmediate(() => teardown(requestId))
    }
}

export function subscribe(requestId, listener) {
    const buffered = eventBuffers.get(requestId) || []
    for (const event of buffered) {
        listener(event)
    }

    emitter.on(requestId, listener)

    return () => emitter.off(requestId, listener)
}

function teardown(requestId) {
    emitter.removeAllListeners(requestId)
    eventBuffers.delete(requestId)
    clearBufferTimer(requestId)
}