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

/**
 * Identity PII (Z-005). The Inspector exists to show the SHAPE of every
 * request/response, so these keys are not dropped and not blanked: they are
 * replaced by a marker that keeps the shape readable — the field is still
 * there, still a string, and still says how long the original was — without
 * persisting the value into D1 or the screen.
 *
 *  - name-like keys      -> `[REDACTED:5 chars]`
 *  - date of birth       -> `[REDACTED:1990]` (year only: enough to see that a
 *                           date was sent and that the age math has an input)
 *  - street/zip/e-mail/phone -> `[REDACTED:N chars]`
 *  - `city`/`state` stay in clear: they carry the payload's shape (and the
 *    Smarty/address validation story) without identifying anybody.
 */
const NAME_KEYS = [
  'firstname',
  'middlename',
  'lastname',
  'fullname',
  'name',
  'maidenname',
  'suffix',
]

const DOB_KEYS = ['dob', 'dateofbirth', 'birthdate', 'birthday']

const CONTACT_KEYS = [
  'address',
  'address1',
  'address2',
  'addressline1',
  'addressline2',
  'street',
  'street1',
  'street2',
  'line1',
  'line2',
  'zip',
  'zipcode',
  'postalcode',
  'email',
  'emailaddress',
  'phone',
  'phonenumber',
  'homephone',
  'mobilephone',
]

function shapeOnly(value: string): string {
  return `${REDACTED}:${value.length} chars`
}

function dobYear(value: string): string {
  const y = /(\d{4})/.exec(value)
  return y ? `${REDACTED}:${y[1]}` : shapeOnly(value)
}

function matches(key: string, list: string[]): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '')
  return list.some((s) => k === s || k.endsWith(s))
}

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
      } else if (typeof v === 'string' && v !== '' && matches(k, NAME_KEYS)) {
        out[k] = shapeOnly(v)
      } else if (typeof v === 'string' && v !== '' && matches(k, DOB_KEYS)) {
        out[k] = dobYear(v)
      } else if (typeof v === 'string' && v !== '' && matches(k, CONTACT_KEYS)) {
        out[k] = shapeOnly(v)
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

/**
 * JSON-stringify with redaction, bounded in size.
 *
 * The result is **always valid JSON**: when the payload is over `maxLen` we do
 * not cut the string in half (that used to write broken JSON into `api_calls`
 * and made GET /api/inspector fail for every row). Instead we store an envelope
 * describing the truncation plus a short, JSON-escaped preview.
 */
export function redactedJson(value: unknown, maxLen = 20000): string {
  let s: string
  try {
    s = JSON.stringify(redact(value)) ?? 'null'
  } catch {
    s = '"[UNSERIALIZABLE]"'
  }
  if (s.length <= maxLen) return s
  const previewLen = Math.max(0, Math.min(2000, maxLen - 200))
  return JSON.stringify({
    _truncated: true,
    bytes: s.length,
    maxLen,
    preview: `${s.slice(0, previewLen)}…`,
  })
}
