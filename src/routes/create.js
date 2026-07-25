import express from 'express'
import crypto from 'crypto'
import { runPairingSession } from '../pairing/pairingSession.js'

const router = express.Router()

// POST /create — body: { phoneNumber }
// Responds immediately with { requestId }; pairing runs async in the
// background and pushes its progress to /create/stream via pairingBus.
router.post('/', (req, res) => {
    const { phoneNumber } = req.body || {}

    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return res.status(400).json({ error: 'phone_number_required' })
    }

    const requestId = `req_${crypto.randomBytes(6).toString('hex')}`

    res.status(202).json({ requestId })

    // fire-and-forget — runPairingSession never throws back to the caller,
    // it emits an 'error' stage on the stream instead
    runPairingSession(requestId, phoneNumber)

    return
})

export default router