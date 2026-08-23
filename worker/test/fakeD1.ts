/** Minimal in-memory D1 stand-in: enough for the routes' best-effort writes. */
export interface FakeD1 {
  statements: { sql: string; params: unknown[] }[]
  prepare(sql: string): any
}

export function fakeD1(): FakeD1 & { rows: Record<string, unknown>[] } {
  const statements: { sql: string; params: unknown[] }[] = []
  const rows: Record<string, unknown>[] = []
  const stmt = (sql: string, params: unknown[] = []): any => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    run: async () => {
      statements.push({ sql, params })
      return { success: true, meta: {} }
    },
    all: async () => {
      statements.push({ sql, params })
      return { results: rows, success: true }
    },
    first: async () => {
      statements.push({ sql, params })
      return /COUNT/i.test(sql) ? { n: rows.length } : (rows[0] ?? null)
    },
  })
  return { statements, rows, prepare: (sql: string) => stmt(sql) }
}
