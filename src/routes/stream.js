import express from 'express'
import { subscribe } from '../pairing/pairingBus.js'

const router = express.Router()

// GET /create/stream?requestId=req_xxx — SSE push channel for live pairing status.
router.get('/', (req, res) => {
    const { requestId } = req.query

    if (!requestId || typeof requestId !== 'string') {
        return res.status(400).json({ error: 'request_id_required' })
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    })

    const send = (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
        if (event.stage === 'closed' || event.stage === 'error' || event.stage === 'timeout') {
            res.end()
        }
    }

    const unsubscribe = subscribe(requestId, send)

    req.on('close', unsubscribe)

    return
})

export default router