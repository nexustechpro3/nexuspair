import { constantTimeCompare } from '../util/constantTimeCompare.js'

const SITE_API_KEY = process.env.SITE_API_KEY

if (!SITE_API_KEY) {
    throw new Error('SITE_API_KEY is not set')
}

// Applied only to POST /create (and /create/stream) per Doc 2 §3.
export function requireSiteKey(req, res, next) {
    const providedKey = req.get('X-Site-Key')

    if (!providedKey || !constantTimeCompare(providedKey, SITE_API_KEY)) {
        return res.status(401).json({ error: 'invalid_site_key' })
    }

    next()
}