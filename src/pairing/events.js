const STAGE_LOGS = {
  connecting: ({ phone }) => `generating pairing code for +${phone}...`,
  pairing_code_generated: () => 'pairing code generated',
  awaiting_pairing: ({ pairingCode }) => `enter this code on your phone: ${pairingCode}`,
  paired: ({ phone }) => `paired successfully — +${phone}`,
  waiting_before_session: ({ ms }) => `waiting ${ms / 1000}s before sending session id...`,
  session_sent_to_whatsapp: ({ name }) => `session id sent to ${name}`,
  session_ready: () => 'session id ready',
  error: ({ message }) => `error: ${message}`,
  timeout: () => 'pairing timed out — no response from whatsapp',
  closed: () => 'connection closed',
}

export function buildEvent(stage, fields = {}) {
  const buildLog = STAGE_LOGS[stage]
  if (!buildLog) throw new Error(`unknown pairing stage: ${stage}`)
  return { stage, ...fields, log: buildLog(fields) }
}