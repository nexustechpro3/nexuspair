import 'dotenv/config'
import app from './app.js'
import { startCleanupJob } from './cleanup/expireSessions.js'

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`[session-api] listening on port ${PORT}`)
})

startCleanupJob()