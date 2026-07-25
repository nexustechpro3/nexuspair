// Exact stage/log table from Doc 2 §6.
// Route/pairing code should never hand-write a log string — always go
// through buildEvent(stage, fields) so the wire format can't drift from spec.
const STAGE_LOGS = {
    connecting: () => 'connecting to whatsapp...',
    pairing_code_generated: () => 'pairing code generated',
    awaiting_pairing: () => 'waiting for you to enter the code...',
    paired: () => 'paired successfully',
    waiting_before_session: ({ seconds }) => `waiting ${seconds}s before sending session id...`,
    session_sent_to_whatsapp: () => 'session id sent to your whatsapp',
    session_ready: () => 'session id ready',
    error: ({ message }) => `error: ${message}`,
    timeout: () => 'pairing timed out — no response from whatsapp',
    closed: () => 'connection closed',
}

// Builds one wire event: { stage, ...fields, log }
export function buildEvent(stage, fields = {}) {
    const buildLog = STAGE_LOGS[stage]
    if (!buildLog) {
        throw new Error(`unknown pairing stage: ${stage}`)
    }

    return {
        stage,
        ...fields,
        log: buildLog(fields),
    }
}