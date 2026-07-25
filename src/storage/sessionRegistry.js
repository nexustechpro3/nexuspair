import { genSessionId } from '../util/genSessionId.js'
import { openAuthState } from './keyvAuth.js'
import { exportSessionFiles } from './mongoExport.js'
import {
    insertSessionIndex,
    findPhoneNumber,
    removeSessionIndex,
    findExpiredSessionIds,
} from './sessionIndex.js'

// Called once pairing succeeds. Generates the NEXUSBOT-<16 chars> token and
// stores token -> { phoneNumber, connectedAt } in the session_index collection.
export async function createSession(phoneNumber) {
    const sessionId = genSessionId()
    await insertSessionIndex(sessionId, phoneNumber)
    return sessionId
}

// Looks up which phone number a token maps to. Returns null if unknown.
export async function resolvePhoneNumber(sessionId) {
    return findPhoneNumber(sessionId)
}

// GET /api/session/:id logic: resolve token -> phoneNumber, then pull only
// the redeem-relevant categories via exportSessionFiles.
export async function redeemSession(sessionId) {
    const phoneNumber = await resolvePhoneNumber(sessionId)
    if (!phoneNumber) return null

    const files = await exportSessionFiles(phoneNumber)
    return { phoneNumber, files }
}

// Shared by /confirm and /delete: hard-deletes the Keyv namespace via
// clearSession(), then removes the token from session_index.
export async function deleteSession(sessionId) {
    const phoneNumber = await resolvePhoneNumber(sessionId)
    if (!phoneNumber) return false

    const { clearSession } = await openAuthState(phoneNumber)
    await clearSession()

    await removeSessionIndex(sessionId)
    return true
}

// Used by the 30-min cleanup job (§7).
export async function listExpiredSessionIds(maxAgeMs) {
    return findExpiredSessionIds(maxAgeMs)
}