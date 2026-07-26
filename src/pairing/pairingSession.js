import makeWASocket, { DisconnectReason } from '@nexustechpro/baileys'
import pino from 'pino'
import { openAuthState } from '../storage/keyvAuth.js'
import { createSession } from '../storage/sessionRegistry.js'
import { buildEvent } from './events.js'
import { publishEvent } from './pairingBus.js'

const PAIRING_TIMEOUT_MS = 3 * 60 * 1000
const POST_PAIR_DELAY_MS = 5_000

// Fancy unicode digit map (covers bold, sans-serif, fullwidth, etc.)
const UNICODE_DIGIT_MAP = Object.fromEntries([
  // fullwidth 0–9: ０–９
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0xff10 + i), String(i)]),
  // mathematical bold 𝟎–𝟗
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0x1d7ce + i), String(i)]),
  // mathematical sans-serif 𝟢–𝟫
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0x1d7e2 + i), String(i)]),
  // mathematical double-struck 𝟘–𝟡
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0x1d7d8 + i), String(i)]),
  // mathematical monospace 𝟶–𝟿
  ...[...Array(10)].map((_, i) => [String.fromCodePoint(0x1d7f6 + i), String(i)]),
  // mathematical bold italic 𝟏 range — same as bold above, already covered
])

const normalizePhone = (raw) => {
  // Normalize unicode fancy digits → ASCII
  const decoded = [...raw].map((ch) => UNICODE_DIGIT_MAP[ch] ?? ch).join('')
  // Strip everything except digits and leading +
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

  const settle = () => {
    settled = true
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
  }

  const wipeAuth = async () => {
    try { await clearSessionFn?.() } catch { }
  }

  const { state, saveCreds, clearSession } = await openAuthState(phone)
  clearSessionFn = clearSession

  await new Promise((resolve, reject) => {
    const fail = async (err, sock) => {
      if (settled) return
      settle()
      emit('error', { message: err.message })
      await wipeAuth()
      try { await sock?.end() } catch { }
      emit('closed')
      reject(err)
    }

    const connect = () => {
      const sock = makeWASocket({ auth: state, logger, printQRInTerminal: false })

      sock.ev.on('creds.update', saveCreds)

      if (!timeoutTimer) {
        timeoutTimer = setTimeout(async () => {
          if (settled) return
          settle()
          emit('timeout')
          await wipeAuth()
          try { await sock.end() } catch { }
          emit('closed')
          reject(new Error('pairing timeout'))
        }, PAIRING_TIMEOUT_MS)
        timeoutTimer.unref?.()
      }

      sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'connecting') {
          emit('connecting')
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
        sock.requestPairingCode(phone)
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