import { MongoClient } from 'mongodb'

const MONGO_URI = process.env.MONGO_URI
const DB_NAME = process.env.MONGO_DB_NAME || 'baileys_auth'
const COLLECTION_NAME = 'session_index'

let clientPromise = null

async function getCollection() {
    if (!clientPromise) {
        const client = new MongoClient(MONGO_URI)
        clientPromise = client.connect().then((connected) => connected.db(DB_NAME).collection(COLLECTION_NAME))
    }
    return clientPromise
}

// Document shape: { _id: sessionId, phoneNumber, connectedAt }
// _id as the token itself gives a free unique index and fast lookup by token.

export async function insertSessionIndex(sessionId, phoneNumber) {
    const collection = await getCollection()
    await collection.insertOne({
        _id: sessionId,
        phoneNumber,
        connectedAt: Date.now(),
    })
}

export async function findPhoneNumber(sessionId) {
    const collection = await getCollection()
    const doc = await collection.findOne({ _id: sessionId })
    return doc?.phoneNumber ?? null
}

export async function removeSessionIndex(sessionId) {
    const collection = await getCollection()
    const result = await collection.deleteOne({ _id: sessionId })
    return result.deletedCount > 0
}

export async function findExpiredSessionIds(maxAgeMs) {
    const collection = await getCollection()
    const cutoff = Date.now() - maxAgeMs

    const docs = await collection
        .find({ connectedAt: { $lte: cutoff } }, { projection: { _id: 1 } })
        .toArray()

    return docs.map((doc) => doc._id)
}