import { describe, expect, it } from 'vitest'
import { getConfig, publicStatus, PROD_BASE_URL, SANDBOX_BASE_URL } from '../src/config'

describe('config / mode', () => {
  it('falls back to mock with no credentials', () => {
    const cfg = getConfig({})
    expect(cfg.mode).toBe('mock')
    expect(cfg.hasAuthId).toBe(false)
    expect(cfg.hasAuthToken).toBe(false)
    expect(cfg.baseUrl).toBe(SANDBOX_BASE_URL)
  })

  it('stays in mock when only one credential is present', () => {
    expect(getConfig({ SMARTY_AUTH_ID: 'abc' }).mode).toBe('mock')
    expect(getConfig({ SMARTY_AUTH_TOKEN: 'abc' }).mode).toBe('mock')
  })

  it('treats whitespace-only values as empty', () => {
    expect(getConfig({ SMARTY_AUTH_ID: '   ', SMARTY_AUTH_TOKEN: '  ' }).mode).toBe('mock')
  })

  it('maps SMARTY_AUTH_ID -> appKey and SMARTY_AUTH_TOKEN -> client token', () => {
    const cfg = getConfig({ SMARTY_AUTH_ID: 'APP', SMARTY_AUTH_TOKEN: 'SECRET' })
    expect(cfg.mode).toBe('sandbox')
    expect(cfg.appKey).toBe('APP')
    expect(cfg.clientToken).toBe('SECRET')
  })

  it('accepts ARRAY_* aliases', () => {
    const cfg = getConfig({ ARRAY_APP_KEY: 'APP', ARRAY_CLIENT_TOKEN: 'SECRET' })
    expect(cfg.mode).toBe('sandbox')
    expect(cfg.appKey).toBe('APP')
  })

  it('prefers SMARTY_* over the aliases', () => {
    const cfg = getConfig({ SMARTY_AUTH_ID: 'A', ARRAY_APP_KEY: 'B', SMARTY_AUTH_TOKEN: 'T' })
    expect(cfg.appKey).toBe('A')
  })

  it('selects the production base URL for ARRAY_ENV=production', () => {
    const cfg = getConfig({ ARRAY_ENV: 'production' })
    expect(cfg.arrayEnv).toBe('production')
    expect(cfg.baseUrl).toBe(PROD_BASE_URL)
    expect(cfg.componentsCdn).toBe('https://embed.array.io/cms/')
  })

  it('never exposes the client token in the public status', () => {
    const status = publicStatus(getConfig({ SMARTY_AUTH_ID: 'APP', SMARTY_AUTH_TOKEN: 'SUPERSECRET' }))
    expect(JSON.stringify(status)).not.toContain('SUPERSECRET')
    expect(status).toMatchObject({ mode: 'sandbox', hasAuthId: true, hasAuthToken: true })
  })
})
