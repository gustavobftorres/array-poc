/**
 * Redaction for anything persisted into `api_calls` or logged.
 * Never let SSNs or tokens reach the database or the console.
 */

const SENSITIVE_KEYS = [
  'ssn',
  'socialsecuritynumber',
  'clienttoken',
  'x-credmo-client-token',
  'usertoken',
  'x-credmo-user-token',
  'authtoken',
  'displaytoken',
  'token',
  'password',
  'secret',
  'authorization',
  'smarty_auth_token',
  'array_client_token',
]

export const REDACTED = '[REDACTED]'

function maskString(value: string): string {
  if (!value) return value
  if (value.length <= 4) return REDACTED
  return `${REDACTED}:${value.slice(-4)}`
}

/** Mask an SSN keeping only the last 4 digits. */
export function ssnLast4(ssn: string | undefined | null): string {
  const digits = (ssn ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : ''
}

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_KEYS.some((s) => k === s || k.endsWith(s))
}

/** Deep-clone `value`, replacing sensitive fields with a redacted marker. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = typeof v === 'string' ? maskString(v) : REDACTED
      } else {
        out[k] = redact(v, depth + 1)
      }
    }
    return out
  }
  if (typeof value === 'string') {
    // Bare SSN-looking strings anywhere in the payload.
    return value.replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, REDACTED)
  }
  return value
}

/** JSON-stringify with redaction, bounded in size. */
export function redactedJson(value: unknown, maxLen = 20000): string {
  let s: string
  try {
    s = JSON.stringify(redact(value)) ?? 'null'
  } catch {
    s = '"[UNSERIALIZABLE]"'
  }
  return s.length > maxLen ? `${s.slice(0, maxLen)}…"[TRUNCATED]"` : s
}
