/**
 * Minimal in-memory D1 stand-in: enough for the routes' best-effort writes.
 *
 * `api_calls` is modelled for real (insert / select / delete / update of one
 * column) so the Inspector route can be exercised end-to-end in unit tests.
 */
export interface FakeD1 {
  statements: { sql: string; params: unknown[] }[]
  prepare(sql: string): any
}

const API_CALL_COLS = ['id', 'ts', 'method', 'path', 'status', 'duration_ms', 'request', 'response', 'mode']

const WEBHOOK_COLS = ['id', 'received_at', 'event_type', 'client_key', 'report_key', 'source', 'payload', 'created_at']

export function fakeD1(): FakeD1 & {
  rows: Record<string, unknown>[]
  apiCalls: Record<string, unknown>[]
  webhookEvents: Record<string, unknown>[]
} {
  const statements: { sql: string; params: unknown[] }[] = []
  const rows: Record<string, unknown>[] = []
  const apiCalls: Record<string, unknown>[] = []
  const webhookEvents: Record<string, unknown>[] = []

  const isApiCalls = (sql: string) => /api_calls/i.test(sql)
  const isWebhooks = (sql: string) => /webhook_events/i.test(sql)

  const stmt = (sql: string, params: unknown[] = []): any => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    run: async () => {
      statements.push({ sql, params })
      if (isWebhooks(sql)) {
        if (/^\s*INSERT/i.test(sql)) {
          webhookEvents.unshift(Object.fromEntries(WEBHOOK_COLS.map((c, i) => [c, params[i] ?? null])))
        } else if (/^\s*DELETE/i.test(sql)) {
          webhookEvents.length = 0
        }
      }
      if (isApiCalls(sql)) {
        if (/^\s*INSERT/i.test(sql)) {
          apiCalls.unshift(Object.fromEntries(API_CALL_COLS.map((c, i) => [c, params[i] ?? null])))
        } else if (/^\s*DELETE/i.test(sql)) {
          apiCalls.length = 0
        } else if (/^\s*UPDATE\s+api_calls\s+SET\s+(\w+)\s*=\s*\?\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
          const col = sql.match(/SET\s+(\w+)\s*=/i)![1]
          const row = apiCalls.find((r) => r.id === params[1])
          if (row) row[col] = params[0]
        }
      }
      return { success: true, meta: {} }
    },
    all: async () => {
      statements.push({ sql, params })
      if (isWebhooks(sql)) {
        const limit = /LIMIT/i.test(sql) ? Number(params[0]) : webhookEvents.length
        return { results: webhookEvents.slice(0, limit), success: true }
      }
      if (isApiCalls(sql)) {
        const [limit, offset] = /LIMIT/i.test(sql) ? [Number(params[0]), Number(params[1])] : [apiCalls.length, 0]
        return { results: apiCalls.slice(offset, offset + limit), success: true }
      }
      return { results: rows, success: true }
    },
    first: async () => {
      statements.push({ sql, params })
      if (/COUNT/i.test(sql)) {
        return { n: isWebhooks(sql) ? webhookEvents.length : isApiCalls(sql) ? apiCalls.length : rows.length }
      }
      if (isWebhooks(sql)) return webhookEvents[0] ?? null
      return isApiCalls(sql) ? (apiCalls[0] ?? null) : (rows[0] ?? null)
    },
  })
  return { statements, rows, apiCalls, webhookEvents, prepare: (sql: string) => stmt(sql) }
}
