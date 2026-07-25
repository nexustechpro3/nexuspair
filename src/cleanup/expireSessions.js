import { listExpiredSessionIds, deleteSession } from '../storage/sessionRegistry.js'

const CLEANUP_INTERVAL_MS = 60 * 1000
const SESSION_MAX_AGE_MS = 30 * 60 * 1000

export function startCleanupJob() {
  const timer = setInterval(async () => {
    let expiredIds = []

    try {
      expiredIds = await listExpiredSessionIds(SESSION_MAX_AGE_MS)
    } catch (err) {
      console.log('[cleanup] failed to list expired sessions, skipping this tick:', err.message)
      return
    }

    for (const sessionId of expiredIds) {
      try {
        await deleteSession(sessionId)
        console.log(`[cleanup] expired session removed: ${sessionId}`)
      } catch (err) {
        console.log(`[cleanup] failed to remove expired session ${sessionId}:`, err.message)
      }
    }
  }, CLEANUP_INTERVAL_MS)

  timer.unref?.()

  return timer
}