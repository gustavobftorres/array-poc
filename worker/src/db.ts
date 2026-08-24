/**
 * D1 helpers. Every write is best-effort: the POC must keep working (and the
 * unit tests must keep passing) even with a degraded/stubbed database.
 */
import { redactedJson, ssnLast4 } from './redact'
import type { Alert, Address, CreditReport, OrderReportResult } from './array/types'

export interface ApiCallRow {
  id: string
  ts: string
  method: string
  path: string
  status: number
  duration_ms: number
  request: string | null
  response: string | null
  mode: string
}

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[db] ${label} failed:`, e instanceof Error ? e.message : e)
    return null
  }
}

export async function insertUser(
  db: D1Database,
  args: { clientKey: string; firstName: string; lastName: string; dob: string; ssn: string; address: Address; mode: string },
) {
  return safe('insertUser', () =>
    db
      .prepare(
        `INSERT INTO users (id, client_key, first_name, last_name, dob, ssn_last4, address, mode, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(client_key) DO UPDATE SET first_name=excluded.first_name, last_name=excluded.last_name`,
      )
      // SSN never lands in D1 in full — only the last 4 digits.
      .bind(uid(), args.clientKey, args.firstName, args.lastName, args.dob, ssnLast4(args.ssn), JSON.stringify(args.address), args.mode, now())
      .run(),
  )
}

export async function listUsers(db: D1Database, limit = 50, offset = 0) {
  const res = await safe('listUsers', () =>
    db
      .prepare(`SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(limit, offset)
      .all(),
  )
  return (res?.results ?? []) as unknown as Record<string, unknown>[]
}

export async function countUsers(db: D1Database): Promise<number> {
  const res = await safe('countUsers', () => db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>())
  return res?.n ?? 0
}

export async function insertUserToken(
  db: D1Database,
  args: { clientKey: string; userToken: string; authToken?: string; ttlInMinutes?: number; expiresAt: string },
) {
  return safe('insertUserToken', () =>
    db
      .prepare(
        `INSERT INTO user_tokens (id, client_key, user_token, auth_token, ttl_minutes, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(uid(), args.clientKey, args.userToken, args.authToken ?? null, args.ttlInMinutes ?? null, args.expiresAt, now())
      .run(),
  )
}

export async function latestUserToken(db: D1Database, clientKey: string) {
  return safe('latestUserToken', () =>
    db
      .prepare(`SELECT * FROM user_tokens WHERE client_key = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(clientKey)
      .first<Record<string, unknown>>(),
  )
}

export async function insertReport(db: D1Database, order: OrderReportResult) {
  return safe('insertReport', () =>
    db
      .prepare(
        `INSERT INTO reports (id, client_key, report_key, display_token, product_code, payload, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(report_key) DO UPDATE SET display_token=excluded.display_token`,
      )
      .bind(uid(), order.clientKey, order.reportKey, order.displayToken, order.productCode, null, now())
      .run(),
  )
}

export async function saveReportPayload(db: D1Database, reportKey: string, payload: CreditReport | unknown) {
  return safe('saveReportPayload', () =>
    db.prepare(`UPDATE reports SET payload = ? WHERE report_key = ?`).bind(JSON.stringify(payload), reportKey).run(),
  )
}

export async function listReports(db: D1Database, clientKey?: string, limit = 25) {
  const res = await safe('listReports', () =>
    clientKey
      ? db.prepare(`SELECT id, client_key, report_key, product_code, created_at FROM reports WHERE client_key = ? ORDER BY created_at DESC LIMIT ?`).bind(clientKey, limit).all()
      : db.prepare(`SELECT id, client_key, report_key, product_code, created_at FROM reports ORDER BY created_at DESC LIMIT ?`).bind(limit).all(),
  )
  return (res?.results ?? []) as unknown as Record<string, unknown>[]
}

/** Every stored report with its capability tokens — used to rehydrate the mock. */
export async function allReportKeys(db: D1Database, limit = 200) {
  const res = await safe('allReportKeys', () =>
    db
      .prepare(`SELECT client_key, report_key, display_token, product_code FROM reports ORDER BY created_at DESC LIMIT ?`)
      .bind(limit)
      .all(),
  )
  return (res?.results ?? []) as unknown as Record<string, unknown>[]
}

export async function upsertAlerts(db: D1Database, alerts: Alert[]) {
  for (const a of alerts) {
    await safe('upsertAlert', () =>
      db
        .prepare(
          `INSERT INTO alerts (id, alert_id, client_key, bureau, type, severity, title, description, payload, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(alert_id) DO UPDATE SET severity=excluded.severity, payload=excluded.payload`,
        )
        .bind(uid(), a.alertId, a.clientKey, a.bureau, a.type, a.severity, a.title, a.description, JSON.stringify(a), a.createdAt ?? now())
        .run(),
    )
  }
}

export async function insertApiCall(
  db: D1Database,
  args: { method: string; path: string; status: number; durationMs: number; request?: unknown; response?: unknown; mode: string },
) {
  return safe('insertApiCall', () =>
    db
      .prepare(
        `INSERT INTO api_calls (id, ts, method, path, status, duration_ms, request, response, mode)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      // Redaction happens here so nothing sensitive can reach the table.
      .bind(uid(), now(), args.method, args.path, args.status, args.durationMs, redactedJson(args.request ?? null), redactedJson(args.response ?? null), args.mode)
      .run(),
  )
}

export async function listApiCalls(db: D1Database, limit: number, offset: number) {
  const rows = await safe('listApiCalls', () =>
    db.prepare(`SELECT * FROM api_calls ORDER BY ts DESC, rowid DESC LIMIT ? OFFSET ?`).bind(limit, offset).all(),
  )
  const total = await safe('countApiCalls', () => db.prepare(`SELECT COUNT(*) AS n FROM api_calls`).first<{ n: number }>())
  return { rows: (rows?.results ?? []) as unknown as ApiCallRow[], total: total?.n ?? 0 }
}

export async function clearApiCalls(db: D1Database) {
  return safe('clearApiCalls', () => db.prepare(`DELETE FROM api_calls`).run())
}

// ---------------------------------------------------------------------------
// Webhooks (ciclo 13)
// ---------------------------------------------------------------------------

export interface WebhookEventRow {
  id: string
  received_at: string
  event_type: string
  client_key: string | null
  report_key: string | null
  source: string
  payload: string | null
  created_at: string
}

/**
 * Persiste um evento recebido no listener. O payload passa pela mesma redação
 * de PII/segredos do Inspector — o token do path NUNCA chega aqui.
 */
export async function insertWebhookEvent(
  db: D1Database,
  args: { eventType: string; clientKey?: string | null; reportKey?: string | null; source: 'array' | 'simulated'; payload: unknown },
) {
  const id = uid()
  await safe('insertWebhookEvent', () =>
    db
      .prepare(
        `INSERT INTO webhook_events (id, received_at, event_type, client_key, report_key, source, payload, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(id, now(), args.eventType, args.clientKey ?? null, args.reportKey ?? null, args.source, redactedJson(args.payload ?? null), now())
      .run(),
  )
  return id
}

export async function listWebhookEvents(db: D1Database, limit = 50) {
  const res = await safe('listWebhookEvents', () =>
    db.prepare(`SELECT * FROM webhook_events ORDER BY received_at DESC, rowid DESC LIMIT ?`).bind(limit).all(),
  )
  const total = await safe('countWebhookEvents', () =>
    db.prepare(`SELECT COUNT(*) AS n FROM webhook_events`).first<{ n: number }>(),
  )
  return { rows: (res?.results ?? []) as unknown as WebhookEventRow[], total: total?.n ?? 0 }
}

export async function clearWebhookEvents(db: D1Database) {
  return safe('clearWebhookEvents', () => db.prepare(`DELETE FROM webhook_events`).run())
}
