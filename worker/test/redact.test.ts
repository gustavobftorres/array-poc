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
    // Z-005: identity PII is redacted keeping the SHAPE, never the value.
    expect(json).not.toContain('BANKER')
    expect(json).toContain('[REDACTED]:6 chars')
    expect(json).toContain(REDACTED)
  })

  it('redacts identity PII keeping the shape (Z-005)', () => {
    const out = redact({
      firstName: 'Zed',
      lastName: 'Redact',
      dob: '1990-05-05',
      emailAddress: 'zed@example.com',
      phoneNumber: '5551234567',
      address: {
        address1: '123 Main St',
        address2: 'Apt 4',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
      },
    }) as Record<string, any>
    expect(out.firstName).toBe('[REDACTED]:3 chars')
    expect(out.lastName).toBe('[REDACTED]:6 chars')
    expect(out.dob).toBe('[REDACTED]:1990')
    expect(out.emailAddress).toBe('[REDACTED]:15 chars')
    expect(out.phoneNumber).toBe('[REDACTED]:10 chars')
    expect(out.address.address1).toBe('[REDACTED]:11 chars')
    expect(out.address.address2).toBe('[REDACTED]:5 chars')
    // City/state stay readable: payload shape without identifying anybody.
    expect(out.address.city).toBe('Austin')
    expect(out.address.state).toBe('TX')
    expect(out.address.zipCode).toBe('[REDACTED]:5 chars')
    const json = JSON.stringify(out)
    for (const v of ['Zed', 'Redact', '1990-05-05', '123 Main St', 'zed@example.com', '78701'])
      expect(json).not.toContain(v)
  })

  it('leaves empty identity fields alone (shape stays visible)', () => {
    expect(redact({ firstName: '', dob: '' })).toEqual({ firstName: '', dob: '' })
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
