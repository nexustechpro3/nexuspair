import crypto from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

// Format: NEXUSBOT-<16 random alphanumeric chars>
// This is the user-facing token, NOT the Keyv namespace.
// The Keyv namespace is the phone number itself.
export function genSessionId() {
    let suffix = ''
    const randomBytes = crypto.randomBytes(16)

    for (let i = 0; i < 16; i++) {
        suffix += ALPHABET[randomBytes[i] % ALPHABET.length]
    }

    return `NEXUSBOT-${suffix}`
}