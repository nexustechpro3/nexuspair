import { MongoClient } from 'mongodb'

const MONGO_URI = process.env.MONGO_URI
const DB_NAME = process.env.MONGO_DB_NAME || 'test'

if (!MONGO_URI) {
  throw new Error('MONGO_URI is not set')
}

let dbPromise = null

export function getDb() {
  if (!dbPromise) {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    })
    dbPromise = client.connect().then((connected) => connected.db(DB_NAME))
  }
  return dbPromise
}

export async function getCollection(name) {
  const db = await getDb()
  return db.collection(name)
}