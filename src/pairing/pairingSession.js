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
  const emit = (stage, fields) => {
    console.log(`[pairing:${phoneNumber}] stage=${stage}`, fields ?? '')
    publishEvent(requestId, buildEvent(stage, fields))
  }

  let timeoutTimer = null
  let settled = false
  let clearSessionFn = null
  let pairingCodeSent = false
  let attempt = 0

  const clearTimeoutTimer = () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
  }

  const wipeAuthState = async () => {
    try {
      if (clearSessionFn) await clearSessionFn()
      console.log(`[pairing:${phoneNumber}] clearSession succeeded`)
    } catch (err) {
      console.log(`[pairing:${phoneNumber}] clearSession failed:`, err.message)
    }
  }

  console.log(`[pairing:${phoneNumber}] runPairingSession starting, requestId=${requestId}`)

  const { state, saveCreds, clearSession } = await openAuthState(phoneNumber)
  clearSessionFn = clearSession
  console.log(`[pairing:${phoneNumber}] auth state opened, registered=${state.creds?.registered}`)

  await new Promise((resolve, reject) => {
    const connect = () => {
      attempt += 1
      console.log(`[pairing:${phoneNumber}] connect() attempt #${attempt}`)

      const logger = pino({ level: 'debug' })

      const sock = makeWASocket({
        auth: state,
        logger,
        printQRInTerminal: false,
      })

      console.log(`[pairing:${phoneNumber}] socket created, attaching listeners`)

      sock.ev.on('creds.update', saveCreds)

      if (!timeoutTimer) {
        timeoutTimer = setTimeout(async () => {
          if (settled) return
          settled = true
          console.log(`[pairing:${phoneNumber}] TIMEOUT after ${PAIRING_TIMEOUT_MS}ms`)
          emit('timeout')
          await wipeAuthState()
          try { await sock.end() } catch {}
          emit('closed')
          reject(new Error('pairing timeout'))
        }, PAIRING_TIMEOUT_MS)
        timeoutTimer.unref?.()
        console.log(`[pairing:${phoneNumber}] timeout timer armed`)
      }

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update

        console.log(`[pairing:${phoneNumber}] connection.update:`, {
          connection,
          hasQr: !!qr,
          isNewLogin,
          statusCode: lastDisconnect?.error?.output?.statusCode,
        })

        if (connection === 'connecting') {
          emit('connecting')
        }

        if (connection === 'open') {
          console.log(`[pairing:${phoneNumber}] CONNECTION OPEN, user=`, sock.user)
          if (settled) {
            console.log(`[pairing:${phoneNumber}] already settled, ignoring open event`)
            return
          }
          clearTimeoutTimer()
          emit('paired')

          try {
            console.log(`[pairing:${phoneNumber}] waiting ${WAITING_BEFORE_SESSION_SECONDS}s before generating session id`)
            await new Promise((r) => setTimeout(r, WAITING_BEFORE_SESSION_SECONDS * 1000))
            emit('waiting_before_session', { seconds: WAITING_BEFORE_SESSION_SECONDS })

            const sessionId = await createSession(phoneNumber)
            console.log(`[pairing:${phoneNumber}] session created: ${sessionId}`)

            await sock.sendMessage(sock.user.id, { text: sessionId })
            console.log(`[pairing:${phoneNumber}] sessionId sent to own WhatsApp`)
            emit('session_sent_to_whatsapp')

            emit('session_ready', { sessionId })

            settled = true
            console.log(`[pairing:${phoneNumber}] calling sock.end() after successful session_ready`)
            await sock.end()
            emit('closed')

            resolve()
          } catch (err) {
            settled = true
            console.log(`[pairing:${phoneNumber}] ERROR after open:`, err.message)
            emit('error', { message: err.message })
            await wipeAuthState()
            try { await sock.end() } catch {}
            emit('closed')
            reject(err)
          }
        }

        if (connection === 'close') {
          if (settled) {
            console.log(`[pairing:${phoneNumber}] close event but already settled, ignoring`)
            return
          }

          const statusCode = lastDisconnect?.error?.output?.statusCode
          console.log(`[pairing:${phoneNumber}] CLOSE, statusCode=${statusCode}`, lastDisconnect?.error?.message)

          if (statusCode === DisconnectReason.loggedOut) {
            settled = true
            console.log(`[pairing:${phoneNumber}] logged out, not reconnecting`)
            emit('error', { message: 'logged out during pairing' })
            await wipeAuthState()
            reject(new Error('logged out during pairing'))
            return
          }

          console.log(`[pairing:${phoneNumber}] non-fatal close (code ${statusCode}), reconnecting...`)
          connect()
        }
      })

      if (!pairingCodeSent && !sock.authState.creds.registered) {
        pairingCodeSent = true
        console.log(`[pairing:${phoneNumber}] requesting pairing code...`)
        sock.requestPairingCode(phoneNumber)
          .then((pairingCode) => {
            console.log(`[pairing:${phoneNumber}] pairing code received: ${pairingCode}`)
            emit('pairing_code_generated', { pairingCode })
            emit('awaiting_pairing')
          })
          .catch(async (err) => {
            console.log(`[pairing:${phoneNumber}] requestPairingCode FAILED:`, err.message)
            if (settled) return
            settled = true
            emit('error', { message: err.message })
            await wipeAuthState()
            try { await sock.end() } catch {}
            emit('closed')
            reject(err)
          })
      } else {
        console.log(`[pairing:${phoneNumber}] skipping pairing code request (already sent=${pairingCodeSent}, registered=${sock.authState.creds.registered})`)
      }
    }

    connect()
  })

  clearTimeoutTimer()
  console.log(`[pairing:${phoneNumber}] runPairingSession finished`)
}