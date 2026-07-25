const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

if (ALLOWED_ORIGINS.length === 0) {
    throw new Error('ALLOWED_ORIGINS is not set')
}

// Applied only to POST /create (and /create/stream) per Doc 2 §3.
// Defense in depth alongside requireSiteKey — this alone doesn't stop
// non-browser callers, since Origin is spoofable outside a browser context.
export function restrictOrigin(req, res, next) {
    const origin = req.get('Origin')

    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return res.status(403).json({ error: 'origin_not_allowed' })
    }

    res.setHeader('Access-Control-Allow-Origin', origin || ALLOWED_ORIGINS[0])
    res.setHeader('Vary', 'Origin')

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Site-Key')
        return res.sendStatus(204)
    }

    next()
}