import crypto from 'crypto'

// Timing-safe comparison for the site key header vs process.env.SITE_API_KEY.
export function constantTimeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false

    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)

    if (bufA.length !== bufB.length) return false

    return crypto.timingSafeEqual(bufA, bufB)
}