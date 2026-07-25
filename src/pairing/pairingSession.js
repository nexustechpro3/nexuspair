import makeWASocket, {
  DisconnectReason,
} from '@nexustechpro/baileys'
import pino from 'pino'
import { openAuthState } from '../storage/keyvAuth.js'
import { createSession } from '../storage/sessionRegistry.js'
import { buildEvent } from './events.js'
import { publishEvent } from './pairingBus.js'

const WAITING_BEFORE_SESSION_SECONDS = 6
const PAIRING_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes

export async function runPairingSession(requestId, phoneNumber) {
  const emit = (stage, fields) => publishEvent(requestId, buildEvent(stage, fields))

  let sock = null
  let timeoutTimer = null
  let settled = false
  let clearSessionFn = null

  const clearTimeoutTimer = () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
  }

  const wipeAuthState = async () => {
    try {
      if (clearSessionFn) await clearSessionFn()
    } catch (err) {
      console.log(`[pairing] clearSession failed for ${phoneNumber}:`, err.message)
    }
  }

  try {
    emit('connecting')

    // auth: state — passed directly, untouched. No manual { creds, keys }
    // destructuring, no makeCacheableSignalKeyStore wrapping. This matches
    // the confirmed-working connection pattern exactly.
    const { state, saveCreds, clearSession } = await openAuthState(phoneNumber)
    clearSessionFn = clearSession
    const logger = pino({ level: 'debug' })

    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
    })

    sock.ev.on('creds.update', saveCreds)

    timeoutTimer = setTimeout(async () => {
      if (settled) return
      settled = true
      emit('timeout')
      await wipeAuthState()
      try { await sock?.end() } catch {}
      emit('closed')
    }, PAIRING_TIMEOUT_MS)
    timeoutTimer.unref?.()

    if (!sock.authState.creds.registered) {
      emit('pairing_code_generated', { pairingCode: await sock.requestPairingCode(phoneNumber) })
      emit('awaiting_pairing')
    }

    await new Promise((resolve, reject) => {
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'connecting') {
          console.log('[pairing] connecting...')
        }

        if (connection === 'open') {
          if (settled) return
          clearTimeoutTimer()
          emit('paired')

          try {
            await new Promise((r) => setTimeout(r, WAITING_BEFORE_SESSION_SECONDS * 1000))
            emit('waiting_before_session', { seconds: WAITING_BEFORE_SESSION_SECONDS })

            const sessionId = await createSession(phoneNumber)

            await sock.sendMessage(sock.user.id, { text: sessionId })
            emit('session_sent_to_whatsapp')

            emit('session_ready', { sessionId })

            settled = true
            await sock.end()
            emit('closed')

            resolve()
          } catch (err) {
            settled = true
            emit('error', { message: err.message })
            await wipeAuthState()
            try { await sock.end() } catch {}
            emit('closed')
            reject(err)
          }
        }

        if (connection === 'close') {
          if (settled) return

          const statusCode = lastDisconnect?.error?.output?.statusCode
          console.log('[pairing] disconnected, code:', statusCode)

          if (statusCode === DisconnectReason.loggedOut) {
            settled = true
            emit('error', { message: 'logged out during pairing' })
            await wipeAuthState()
            reject(new Error('logged out during pairing'))
          }
          // any other close before 'open' is left alone — Baileys may
          // reconnect internally during the handshake, same as your
          // working file's run() reconnect pattern, just scoped to
          // "don't treat it as fatal yet" here since this is a one-shot
          // pairing flow, not a long-lived bot process
        }
      })
    })
  } catch (err) {
    if (!settled) {
      settled = true
      emit('error', { message: err.message })
      await wipeAuthState()
      try { await sock?.end() } catch {}
      emit('closed')
    }
  } finally {
    clearTimeoutTimer()
  }
}