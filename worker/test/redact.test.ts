import { describe, expect, it } from 'vitest'
import { redact, redactedJson, ssnLast4, REDACTED } from '../src/redact'

describe('redaction', () => {
  it('masks ssn, tokens and nested secrets', () => {
    const out = redact({
      ssn: '666230560',
      firstName: 'BANKER',
      nested: { userToken: 'ABCD-EFGH-1234', headers: { 'x-credmo-client-token': 'SECRET-TOKEN' } },
      list: [{ displayToken: 'DT-99998888' }],
    })
    const json = JSON.stringify(out)
    expect(json).not.toContain('666230560')
    expect(json).not.toContain('SECRET-TOKEN')
    expect(json).not.toContain('ABCD-EFGH-1234')
    expect(json).toContain('BANKER')
    expect(json).toContain(REDACTED)
  })

  it('masks bare SSN-looking strings in free text', () => {
    expect(redactedJson({ note: 'ssn is 123-45-6789 ok' })).not.toContain('123-45-6789')
  })

  it('keeps only the last 4 digits of an ssn', () => {
    expect(ssnLast4('666-23-0560')).toBe('0560')
    expect(ssnLast4(undefined)).toBe('')
  })

  it('truncates oversized payloads', () => {
    const big = { blob: 'x'.repeat(50_000) }
    expect(redactedJson(big).length).toBeLessThan(21_000)
  })

  it('keeps the truncated output valid JSON (regression: inspector 500)', () => {
    const big = { firstName: 'A'.repeat(50_000), nested: { deep: 'B'.repeat(30_000) } }
    const out = redactedJson(big)
    const parsed = JSON.parse(out) as { _truncated: boolean; bytes: number; preview: string }
    expect(parsed._truncated).toBe(true)
    expect(parsed.bytes).toBeGreaterThan(20_000)
    expect(parsed.preview.length).toBeLessThanOrEqual(2001)
  })

  it('stays valid JSON for payloads just over the limit', () => {
    for (const n of [19_990, 20_000, 20_010, 25_000]) {
      expect(() => JSON.parse(redactedJson({ blob: 'y'.repeat(n) }))).not.toThrow()
    }
  })
})
