import { useKeyvAuthState } from '@nexustechpro/baileys'

const MONGO_URI = process.env.MONGO_URI

if (!MONGO_URI) {
    throw new Error('MONGO_URI is not set')
}

// Opens (or reopens) the Baileys auth state for a given phone number.
// phoneNumber IS the Keyv namespace/sessionId used internally by
// useKeyvAuthState — not the NEXUSBOT- token given to the user.
// Returns exactly what the real source returns: { state, saveCreds, clearSession }.
export async function openAuthState(phoneNumber) {
    const { state, saveCreds, clearSession } = await useKeyvAuthState(phoneNumber, MONGO_URI)
    return { state, saveCreds, clearSession }
}