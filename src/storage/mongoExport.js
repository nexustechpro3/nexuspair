import { MongoClient } from 'mongodb'

const MONGO_URI = process.env.MONGO_URI
const DB_NAME = process.env.MONGO_DB_NAME || 'baileys_auth'
const COLLECTION_NAME = 'nexus'

let clientPromise = null

async function getCollection() {
    if (!clientPromise) {
        const client = new MongoClient(MONGO_URI)
        clientPromise = client.connect().then((connected) => connected.db(DB_NAME).collection(COLLECTION_NAME))
    }
    return clientPromise
}

// Only these categories are needed to boot a socket on redeem.
// Everything else is left behind — deletion is handled entirely by
// clearSession() (from useKeyvAuthState) on confirm/delete/cleanup, not here.
const REDEEM_CATEGORY_PATTERNS = [
    /^creds$/,
    /^pre-key-/,
    /^identity-key-/,
    /^app-state-sync-key-/,
]

function isRedeemCategory(category) {
    return REDEEM_CATEGORY_PATTERNS.some((pattern) => pattern.test(category))
}

// session-<address> -> session-<address>.json
// sender-key-<group>::<address> -> sender-key-<group>--<address>.json
function fixFileName(category) {
    return category.replace(/\//g, '__').replace(/:/g, '-') + '.json'
}

function parseStoredValue(rawValue) {
    if (typeof rawValue === 'string') {
        try {
            return JSON.parse(rawValue)
        } catch {
            return rawValue
        }
    }
    return rawValue
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Read-only, filtered export — used by GET /api/session/:id.
// Only pulls creds/pre-key/session/app-state-sync-key documents.
// Deletion is NOT this file's job — see clearSession() in keyvAuth.js.
export async function exportSessionFiles(phoneNumber) {
    const collection = await getCollection()
    const prefix = `${phoneNumber}:`

    const docs = await collection
        .find({
            key: {
                $regex: `^${escapeRegex(prefix)}(creds|pre-key-|session-|app-state-sync-key-)`,
            },
        })
        .toArray()

    const files = {}

    for (const doc of docs) {
        const category = doc.key.slice(prefix.length)
        if (!isRedeemCategory(category)) continue

        const filename = category === 'creds' ? 'creds.json' : fixFileName(category)
        files[filename] = parseStoredValue(doc.value)
    }

    return files
}