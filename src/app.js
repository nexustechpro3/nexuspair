import express from 'express'
import { requireSiteKey } from './middleware/requireSiteKey.js'
import { restrictOrigin } from './middleware/restrictOrigin.js'
import createRouter from './routes/create.js'
import sessionRouter from './routes/session.js'
import streamRouter from './routes/stream.js'

const app = express()

app.use(express.json())

// Public, key-gated — only the /session page's own backend calls this.
app.use('/create', restrictOrigin, requireSiteKey, createRouter)

// Same auth boundary as /create, since it's opened as part of the same flow.
app.use('/create/stream', restrictOrigin, requireSiteKey, streamRouter)

// Public, open — the id itself is the credential.
app.use('/api/session', sessionRouter)

app.use((req, res) => {
    res.status(404).json({ error: 'not_found' })
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.log('[app] unhandled error:', err)
    res.status(500).json({ error: 'internal_error' })
})

export default app