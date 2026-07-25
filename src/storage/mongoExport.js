import { getCollection } from './mongoClient.js'

const COLLECTION_NAME = 'keyv'

const REDEEM_CATEGORY_PATTERNS = [
  /^creds$/,
  /^pre-key-/,
  /^session-/,
  /^app-state-sync-key-/,
]

function isRedeemCategory(category) {
  return REDEEM_CATEGORY_PATTERNS.some((pattern) => pattern.test(category))
}

function fixFileName(category) {
  return category.replace(/\//g, '__').replace(/:/g, '-') + '.json'
}

// Stored value is a JSON string wrapping { value: <actual data> } —
// e.g. "{\"value\":{\"noiseKey\":{...}}}" — confirmed from real data.
// Parse once, then unwrap that outer { value } layer.
function parseStoredValue(rawValue) {
  if (typeof rawValue !== 'string') return rawValue

  try {
    const parsed = JSON.parse(rawValue)
    return parsed && typeof parsed === 'object' && 'value' in parsed ? parsed.value : parsed
  } catch {
    return rawValue
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function exportSessionFiles(phoneNumber) {
  const col = await getCollection(COLLECTION_NAME)
  const prefix = `${phoneNumber}:`

  const docs = await col
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