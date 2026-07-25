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
const PAIRING_TIMEOUT_MS = 60 * 1000

export async function runPairingSession(requestId, phoneNumber) {
    const emit = (stage, fields) => publishEvent(requestId, buildEvent(stage, fields))

    let sock = null
    let timeoutTimer = null
    let settled = false

    const clearTimeoutTimer = () => {
        if (timeoutTimer) {
            clearTimeout(timeoutTimer)
            timeoutTimer = null
        }
    }

    try {
        emit('connecting')

        const { state, saveCreds } = await openAuthState(phoneNumber)
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

        timeoutTimer = setTimeout(() => {
            if (settled) return
            settled = true
            emit('timeout')
            sock?.end(new Error('pairing timeout'))
        }, PAIRING_TIMEOUT_MS)
        timeoutTimer.unref?.()

        if (!sock.authState.creds.registered) {
            emit('pairing_code_generated', { pairingCode: await sock.requestPairingCode(phoneNumber) })
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
                        // wait 6s after connection is open, THEN generate + send the session id
                        await new Promise((r) => setTimeout(r, WAITING_BEFORE_SESSION_SECONDS * 1000))
                        emit('waiting_before_session', { seconds: WAITING_BEFORE_SESSION_SECONDS })

                        const sessionId = await createSession(phoneNumber)

                        await sock.sendMessage(sock.user.id, { text: sessionId })
                        emit('session_sent_to_whatsapp')

                        emit('session_ready', { sessionId })

                        // session id generated + delivered — close the socket now,
                        // right here, not deferred to a later cleanup step
                        settled = true
                        await sock.end()
                        emit('closed')

                        resolve()
                    } catch (err) {
                        settled = true
                        emit('error', { message: err.message })
                        try { await sock.end() } catch { }
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
                        reject(new Error('logged out during pairing'))
                    }
                }
            })
        })
    } catch (err) {
        if (!settled) {
            settled = true
            emit('error', { message: err.message })
            try { await sock?.end() } catch { }
            emit('closed')
        }
    } finally {
        clearTimeoutTimer()
    }
}