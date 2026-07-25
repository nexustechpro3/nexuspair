import { listExpiredSessionIds, deleteSession } from '../storage/sessionRegistry.js'

const CLEANUP_INTERVAL_MS = 60 * 1000 // walk every minute; the window itself is 30 min
const SESSION_MAX_AGE_MS = 30 * 60 * 1000 // §7 backstop

// §7's independent backstop: walks every known session older than 30 minutes
// (claimed or not) and force-deletes it via deleteSession (clearSession() +
// removal from sessions.json). Not built on Keyv's own per-key TTL.
export function startCleanupJob() {
    const timer = setInterval(async () => {
        const expiredIds = await listExpiredSessionIds(SESSION_MAX_AGE_MS)

        for (const sessionId of expiredIds) {
            try {
                await deleteSession(sessionId)
                console.log(`[cleanup] expired session removed: ${sessionId}`)
            } catch (err) {
                console.log(`[cleanup] failed to remove expired session ${sessionId}:`, err)
            }
        }
    }, CLEANUP_INTERVAL_MS)

    timer.unref?.()

    return timer
}