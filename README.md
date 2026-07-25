# NexusBot Session Generation API

Pairs a WhatsApp number via Baileys pairing code, stores the resulting auth
bundle in MongoDB via `useKeyvAuthState`, and issues a short-lived
`SESSION_ID` token that a personal deployment can redeem exactly once.

This service is the only producer of Baileys auth bundles in the wider
architecture. Personal deployments never generate a session — they redeem
one issued here.

## How it works

1. `POST /create` starts a pairing-code connection for a phone number.
   The phone number itself is the Keyv/Mongo namespace
   (`useKeyvAuthState(phoneNumber, MONGO_URI)`).
2. Progress is pushed live over `GET /create/stream?requestId=...` (SSE) —
   connecting, pairing code generated, paired, etc.
3. Once paired, the API waits 6s, generates a random token
   (`NEXUSBOT-<16 chars>`), sends it to the user's own WhatsApp, and emits
   it on the stream as `session_ready`.
4. The token is mapped to the phone number in a local `sessions.json` file
   (not Mongo) — this is the lookup used by the redeem routes.
5. A personal deployment calls `GET /api/session/:id` with the token to
   pull the auth files it needs (creds, pre-keys, sessions,
   app-state-sync-keys — not the full bundle, for speed).
6. It then calls `POST /api/session/:id/confirm` once saved, which
   hard-deletes the Mongo data via `clearSession()` and removes the token
   from `sessions.json`.
7. A 30-minute sweep (`cleanup/expireSessions.js`) force-deletes any session
   never confirmed, using timestamps stored in `sessions.json` so this
   survives a process restart.

## Routes

| Route | Access |
|---|---|
| `POST /create` | Site key + Origin restricted |
| `GET /create/stream` | Site key + Origin restricted |
| `GET /api/session/:id` | Open — the id is the credential |
| `POST /api/session/:id/confirm` | Open |
| `POST /api/session/:id/delete` | Open |

## Setup

```bash
npm install
cp .env.example .env   # fill in SITE_API_KEY, ALLOWED_ORIGINS, MONGO_URI
npm start
```

## Notes

- `sessions.json` is created in the working directory on first run — this
  is local file storage, not Mongo. Back it up or move it to a persistent
  volume if deploying to an ephemeral filesystem (containers, etc.).
- Only `creds`, `pre-key-*`, `session-*`, and `app-state-sync-key-*` are
  returned on redeem. Everything else in a session's Mongo namespace is
  left behind and cleaned up later — never returned to a client.