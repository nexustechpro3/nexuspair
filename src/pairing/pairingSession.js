import makeWASocket, { DisconnectReason } from '@nexustechpro/baileys'
import pino from 'pino'
import { openAuthState } from '../storage/keyvAuth.js'
import { createSession } from '../storage/sessionRegistry.js'
import { buildEvent } from './events.js'
import { publishEvent } from './pairingBus.js'

const PAIRING_TIMEOUT_MS = 3 * 60 * 1000
const POST_PAIR_DELAY_MS = 6_000

const UNICODE_DIGIT_MAP = Object.fromEntries([
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0xff10 + i), String(i)]),
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0x1d7ce + i), String(i)]),
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0x1d7e2 + i), String(i)]),
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0x1d7d8 + i), String(i)]),
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0x1d7f6 + i), String(i)]),
])

const normalizePhone = (raw) => {
  const decoded = [...raw].map((ch) => UNICODE_DIGIT_MAP[ch] ?? ch).join('')
  return decoded.replace(/[^\d+]/g, '').replace(/^\+/, '')
}

const logger = pino({ level: 'silent' })

export async function runPairingSession(requestId, phoneNumber) {
  const phone = normalizePhone(phoneNumber)

  const emit = (stage, fields) =>
    publishEvent(requestId, buildEvent(stage, { phone, ...fields }))

  let settled = false
  let timeoutTimer = null
  let clearSessionFn = null
  let pairingCodeSent = false
  let attempt = 0 // track reconnect attempts — only emit 'connecting' on first

  const settle = () => {
    settled = true
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
  }

  const wipeAuth = async () => {
    try { await clearSessionFn?.() } catch {}
  }

  const { state, saveCreds, clearSession } = await openAuthState(phone)
  clearSessionFn = clearSession

  await new Promise((resolve, reject) => {
    const fail = async (err, sock) => {
      if (settled) return
      settle()
      emit('error', { message: err.message })
      await wipeAuth()
      try { await sock?.end() } catch {}
      emit('closed')
      reject(err)
    }

    const connect = () => {
      attempt += 1
      const isFirstAttempt = attempt === 1

      const sock = makeWASocket({
        auth: state,
        logger,
        printQRInTerminal: false,
        generateHighQualityLinkPreview: true,
      })

      sock.ev.on('creds.update', saveCreds)

      if (!timeoutTimer) {
        timeoutTimer = setTimeout(async () => {
          if (settled) return
          settle()
          emit('timeout')
          await wipeAuth()
          try { await sock.end() } catch {}
          emit('closed')
          reject(new Error('pairing timeout'))
        }, PAIRING_TIMEOUT_MS)
        timeoutTimer.unref?.()
      }

      sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'connecting') {
          // only emit 'connecting' on the first attempt — subsequent connects
          // are internal 515 reconnects, invisible to the user
          if (isFirstAttempt) emit('connecting')
          return
        }

        if (connection === 'open') {
          if (settled) return
          emit('paired')

          try {
            emit('waiting_before_session', { ms: POST_PAIR_DELAY_MS })
            await new Promise((r) => setTimeout(r, POST_PAIR_DELAY_MS))
            const sessionId = await createSession(phone)
            await sock.sendMessage(sock.user.id, { text: sessionId })
            emit('session_sent_to_whatsapp')
            emit('session_ready', { sessionId })
            settle()
            await sock.end()
            emit('closed')
            resolve()
          } catch (err) {
            await fail(err, sock)
          }
          return
        }

        if (connection === 'close') {
          if (settled) return
          const code = lastDisconnect?.error?.output?.statusCode
          if (code === DisconnectReason.loggedOut) {
            await fail(new Error('logged out during pairing'), sock)
            return
          }
          connect()
        }
      })

      if (!pairingCodeSent && !sock.authState.creds.registered) {
        pairingCodeSent = true
        sock.requestPairingCode(phone, 'NEXUSBOT')
          .then((pairingCode) => {
            emit('pairing_code_generated', { pairingCode })
            emit('awaiting_pairing')
          })
          .catch((err) => fail(err, sock))
      }
    }

    connect()
  })
}