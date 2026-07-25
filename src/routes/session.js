import express from 'express'
import { redeemSession, deleteSession } from '../storage/sessionRegistry.js'

const router = express.Router()

// GET /api/session/:id — redeem a session bundle
router.get('/:id', async (req, res) => {
    const { id } = req.params

    const result = await redeemSession(id)

    if (!result) {
        return res.status(404).json({ error: 'session_not_found' })
    }

    return res.status(200).json({ files: result.files })
})

// POST /api/session/:id/confirm — personal deployment confirms it saved
// everything to disk; hard-delete the session now.
router.post('/:id/confirm', async (req, res) => {
    const { id } = req.params

    const deleted = await deleteSession(id)

    if (!deleted) {
        return res.status(404).json({ error: 'session_not_found' })
    }

    return res.status(200).json({ deleted: true })
})

// POST /api/session/:id/delete — explicit deletion, same effect as confirm,
// open to anyone holding a valid id.
router.post('/:id/delete', async (req, res) => {
    const { id } = req.params

    const deleted = await deleteSession(id)

    if (!deleted) {
        return res.status(404).json({ error: 'session_not_found' })
    }

    return res.status(200).json({ deleted: true })
})

export default router