import makeWASocket, {
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
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
  let clearSessionFn = null // captured once openAuthState resolves, used on every failure path

  const clearTimeoutTimer = () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
  }

  // Shared cleanup for every failure path (timeout, logout, thrown error):
  // wipes the partial/incomplete Mongo namespace for this phone number,
  // since no session token exists yet to let the 30-min sweep find it.
  const wipeAuthState = async () => {
    try {
      if (clearSessionFn) await clearSessionFn()
    } catch (err) {
      console.log(`[pairing] clearSession failed for ${phoneNumber}:`, err.message)
    }
  }

  try {
    emit('connecting')

    const { state, saveCreds, clearSession } = await openAuthState(phoneNumber)
    clearSessionFn = clearSession
    const logger = pino({ level: 'silent' })

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: Browsers.ubuntu('Chrome'),
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
      emit('pairing_code_generated', { pairingCode: await sock.requestPairingCode(phoneNumber, 'NEXUSBOT') })
      emit('awaiting_pairing')
    }

    await new Promise((resolve, reject) => {
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

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

            // success path — session token now exists and owns cleanup via
            // /confirm, /delete, or the 30-min sweep. Do NOT clearSession here.
            settled = true
            await sock.end()
            emit('closed')

            resolve()
          } catch (err) {
            settled = true
            emit('error', { message: err.message })
            await wipeAuthState() // failed after paired, before a token exists — wipe it
            try { await sock.end() } catch {}
            emit('closed')
            reject(err)
          }
        }

        if (connection === 'close') {
          if (settled) return

          const statusCode = lastDisconnect?.error?.output?.statusCode
          if (statusCode === DisconnectReason.loggedOut) {
            settled = true
            emit('error', { message: 'logged out during pairing' })
            await wipeAuthState()
            reject(new Error('logged out during pairing'))
          }
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