import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLL_INTERVAL_S,
  DEFAULT_POLL_TIMEOUT_S,
  DEFAULT_PRODUCT_CODE,
  getConfig,
  MAX_POLL_INTERVAL_S,
  MAX_POLL_TIMEOUT_S,
  normalizeBaseUrl,
  publicStatus,
  PROD_BASE_URL,
  PROD_COMPONENTS_CDN,
  SANDBOX_BASE_URL,
} from '../src/config'
import { DEFAULT_IDENTITY, identityIsEmpty } from '../src/personas'

describe('config / mode', () => {
  it('falls back to mock with no credentials', () => {
    const cfg = getConfig({})
    expect(cfg.mode).toBe('mock')
    expect(cfg.hasAppKey).toBe(false)
    expect(cfg.hasServerToken).toBe(false)
    expect(cfg.baseUrl).toBe(SANDBOX_BASE_URL)
    expect(cfg.baseUrlSource).toBe('ARRAY_ENV')
  })

  it('stays in mock when only one credential is present', () => {
    expect(getConfig({ ARRAY_APP_KEY: 'abc' }).mode).toBe('mock')
    expect(getConfig({ ARRAY_SERVER_TOKEN: 'abc' }).mode).toBe('mock')
  })

  it('treats whitespace-only values as empty', () => {
    expect(getConfig({ ARRAY_APP_KEY: '   ', ARRAY_SERVER_TOKEN: '  ' }).mode).toBe('mock')
  })

  it('maps ARRAY_APP_KEY -> appKey and ARRAY_SERVER_TOKEN -> the client-token header value', () => {
    const cfg = getConfig({ ARRAY_APP_KEY: 'APP', ARRAY_SERVER_TOKEN: 'SECRET' })
    expect(cfg.mode).toBe('sandbox')
    expect(cfg.appKey).toBe('APP')
    expect(cfg.serverToken).toBe('SECRET')
    expect(cfg.warnings).toEqual([])
  })

  it('accepts ARRAY_CLIENT_TOKEN as a non-deprecated alias of ARRAY_SERVER_TOKEN', () => {
    const cfg = getConfig({ ARRAY_APP_KEY: 'APP', ARRAY_CLIENT_TOKEN: 'SECRET' })
    expect(cfg.mode).toBe('sandbox')
    expect(cfg.serverToken).toBe('SECRET')
    expect(cfg.warnings).toEqual([])
  })

  it('accepts the SMARTY_* names only as DEPRECATED aliases, with a warning', () => {
    const cfg = getConfig({ SMARTY_AUTH_ID: 'APP', SMARTY_AUTH_TOKEN: 'SECRET' })
    expect(cfg.mode).toBe('sandbox')
    expect(cfg.appKey).toBe('APP')
    expect(cfg.serverToken).toBe('SECRET')
    expect(cfg.warnings.join(' ')).toMatch(/SMARTY_AUTH_ID.*DEPRECADO/)
    expect(cfg.warnings.join(' ')).toMatch(/SMARTY_AUTH_TOKEN.*DEPRECADO/)
    // O aviso jamais imprime o valor do segredo.
    expect(cfg.warnings.join(' ')).not.toContain('SECRET')
  })

  it('prefers the canonical names over every alias (and then stops warning)', () => {
    const cfg = getConfig({
      ARRAY_APP_KEY: 'CANON',
      SMARTY_AUTH_ID: 'OLD',
      ARRAY_SERVER_TOKEN: 'CANON-T',
      ARRAY_CLIENT_TOKEN: 'ALIAS-T',
      SMARTY_AUTH_TOKEN: 'OLD-T',
    })
    expect(cfg.appKey).toBe('CANON')
    expect(cfg.serverToken).toBe('CANON-T')
    expect(cfg.warnings).toEqual([])
  })

  it('selects the production base URL for ARRAY_ENV=production', () => {
    const cfg = getConfig({ ARRAY_ENV: 'production' })
    expect(cfg.arrayEnv).toBe('production')
    expect(cfg.baseUrl).toBe(PROD_BASE_URL)
    expect(cfg.componentsCdn).toBe('https://embed.array.io/cms/')
  })

  it('never exposes the server token in the public status', () => {
    const status = publicStatus(getConfig({ ARRAY_APP_KEY: 'APP', ARRAY_SERVER_TOKEN: 'SUPERSECRET' }))
    expect(JSON.stringify(status)).not.toContain('SUPERSECRET')
    expect(status).toMatchObject({ mode: 'sandbox', hasAppKey: true, hasServerToken: true })
  })
})

// ---------------------------------------------------------------------------
// ARRAY_BASE_URL — normalização do sufixo /api
// ---------------------------------------------------------------------------

describe('ARRAY_BASE_URL normalization', () => {
  it('appends the /api prefix the user will forget (the value they paste)', () => {
    expect(normalizeBaseUrl('https://sandbox.array.io')).toBe('https://sandbox.array.io/api')
  })

  it.each([
    ['https://sandbox.array.io/', 'https://sandbox.array.io/api'],
    ['https://sandbox.array.io/api', 'https://sandbox.array.io/api'],
    ['https://sandbox.array.io/api/', 'https://sandbox.array.io/api'],
    ['  https://sandbox.array.io/api//  ', 'https://sandbox.array.io/api'],
    ['https://array.io', 'https://array.io/api'],
    ['https://array.io/api/', 'https://array.io/api'],
    ['http://localhost:8788', 'http://localhost:8788/api'],
    ['http://localhost:8788/api', 'http://localhost:8788/api'],
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected)
  })

  it('rejects what is not an http(s) URL', () => {
    expect(normalizeBaseUrl('')).toBeNull()
    expect(normalizeBaseUrl('sandbox.array.io')).toBeNull()
    expect(normalizeBaseUrl('ftp://sandbox.array.io')).toBeNull()
    expect(normalizeBaseUrl('   ')).toBeNull()
  })

  it('uses ARRAY_BASE_URL as the base and records where it came from', () => {
    const cfg = getConfig({ ARRAY_BASE_URL: 'https://sandbox.array.io' })
    expect(cfg.baseUrl).toBe('https://sandbox.array.io/api')
    expect(cfg.baseUrlSource).toBe('ARRAY_BASE_URL')
    expect(cfg.arrayEnv).toBe('sandbox')
  })

  it('derives production (and its CDN) from a non-sandbox host when ARRAY_ENV is absent', () => {
    const cfg = getConfig({ ARRAY_BASE_URL: 'https://array.io' })
    expect(cfg.baseUrl).toBe('https://array.io/api')
    expect(cfg.arrayEnv).toBe('production')
    expect(cfg.componentsCdn).toBe('https://embed.array.io/cms/')
  })

  // W2-001: o HOST manda. `ARRAY_ENV=sandbox` com base em `array.io` era
  // exatamente o defeito (Dashboard dizendo "sandbox" chamando produção).
  it('derives the environment from the effective host, with ARRAY_ENV only as fallback', () => {
    const cfg = getConfig({ ARRAY_BASE_URL: 'https://array.io', ARRAY_ENV: 'sandbox' })
    expect(cfg.arrayEnv).toBe('production')
    expect(cfg.arrayEnvSource).toBe('ARRAY_BASE_URL')
    expect(cfg.baseUrl).toBe('https://array.io/api')
    expect(cfg.componentsCdn).toBe(PROD_COMPONENTS_CDN)
    expect(cfg.envMismatch).toEqual({ declared: 'sandbox', effective: 'production', host: 'array.io' })
    expect(cfg.warnings.join(' ')).toMatch(/contradiz o host/)
  })

  it('keeps ARRAY_ENV in charge when there is no ARRAY_BASE_URL', () => {
    expect(getConfig({ ARRAY_ENV: 'production' }).arrayEnvSource).toBe('ARRAY_ENV')
    expect(getConfig({ ARRAY_ENV: 'production' }).baseUrl).toBe(PROD_BASE_URL)
    expect(getConfig({}).arrayEnvSource).toBe('default')
  })

  it('lets ARRAY_ENV decide for a loopback base URL (fake upstream of dev/QA)', () => {
    const cfg = getConfig({ ARRAY_BASE_URL: 'http://127.0.0.1:8905', ARRAY_ENV: 'production' })
    expect(cfg.arrayEnv).toBe('production')
    expect(cfg.hostClass).toBe('local')
    expect(cfg.envMismatch).toBeNull()
    // http:// para loopback é legítimo e não deve avisar (W2-005).
    expect(cfg.warnings.join(' ')).not.toMatch(/TEXTO CLARO/)
  })

  it('a sandbox host with ARRAY_ENV=production is a visible mismatch too', () => {
    const cfg = getConfig({ ARRAY_BASE_URL: 'https://sandbox.array.io', ARRAY_ENV: 'production' })
    expect(cfg.arrayEnv).toBe('sandbox')
    expect(cfg.envMismatch?.declared).toBe('production')
    expect(cfg.warnings.join(' ')).toMatch(/contradiz o host/)
  })

  // W2-005
  it('warns when http:// points at a REMOTE host (client token in clear text)', () => {
    const cfg = getConfig({ ARRAY_BASE_URL: 'http://sandbox.array.io' })
    expect(cfg.baseUrl).toBe('http://sandbox.array.io/api')
    expect(cfg.warnings.join(' ')).toMatch(/TEXTO CLARO/)
  })

  // W2-007
  it('warns when an extra path is patched into the base URL', () => {
    const cfg = getConfig({ ARRAY_BASE_URL: 'https://sandbox.array.io/api/v2' })
    expect(cfg.baseUrl).toBe('https://sandbox.array.io/api/v2/api')
    expect(cfg.warnings.join(' ')).toMatch(/path extra/)
  })

  it('falls back to the ARRAY_ENV host (with a warning) on a broken value', () => {
    const cfg = getConfig({ ARRAY_BASE_URL: 'nao-e-url' })
    expect(cfg.baseUrl).toBe(SANDBOX_BASE_URL)
    expect(cfg.baseUrlSource).toBe('ARRAY_ENV')
    expect(cfg.warnings.join(' ')).toMatch(/ARRAY_BASE_URL/)
  })
})

// ---------------------------------------------------------------------------
// ARRAY_AUTH_MODE
// ---------------------------------------------------------------------------

describe('ARRAY_AUTH_MODE', () => {
  it('defaults to server (the safe mode)', () => {
    expect(getConfig({}).authMode).toBe('server')
    expect(getConfig({ ARRAY_AUTH_MODE: '' }).authMode).toBe('server')
  })

  it('accepts browser and its synonyms', () => {
    expect(getConfig({ ARRAY_AUTH_MODE: 'browser' }).authMode).toBe('browser')
    expect(getConfig({ ARRAY_AUTH_MODE: 'BROWSER' }).authMode).toBe('browser')
    expect(getConfig({ ARRAY_AUTH_MODE: 'user' }).authMode).toBe('browser')
  })

  it('falls back to server with a warning on garbage', () => {
    const cfg = getConfig({ ARRAY_AUTH_MODE: 'sim' })
    expect(cfg.authMode).toBe('server')
    expect(cfg.warnings.join(' ')).toMatch(/ARRAY_AUTH_MODE/)
  })

  it('is exposed in the public status', () => {
    expect(publicStatus(getConfig({ ARRAY_AUTH_MODE: 'browser' })).authMode).toBe('browser')
  })
})

// ---------------------------------------------------------------------------
// ARRAY_POLL_INTERVAL / ARRAY_POLL_TIMEOUT (unidade em segundos: INFERIDA)
// ---------------------------------------------------------------------------

describe('poll settings', () => {
  it('defaults to 1.0s / 120s', () => {
    const cfg = getConfig({})
    expect(cfg.pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_S * 1000)
    expect(cfg.pollTimeoutMs).toBe(DEFAULT_POLL_TIMEOUT_S * 1000)
  })

  it('reads SECONDS (float) and converts to ms', () => {
    const cfg = getConfig({ ARRAY_POLL_INTERVAL: '0.25', ARRAY_POLL_TIMEOUT: '300' })
    expect(cfg.pollIntervalMs).toBe(250)
    expect(cfg.pollTimeoutMs).toBe(300_000)
  })

  it('ignores non-positive / unreadable values, with a warning', () => {
    const cfg = getConfig({ ARRAY_POLL_INTERVAL: '0', ARRAY_POLL_TIMEOUT: 'abc' })
    expect(cfg.pollIntervalMs).toBe(1000)
    expect(cfg.pollTimeoutMs).toBe(120_000)
    expect(cfg.warnings.filter((w) => /ARRAY_POLL_/.test(w))).toHaveLength(2)
  })

  it('marks the unit as inferred in the public status', () => {
    const poll = publicStatus(getConfig({})).poll
    expect(poll).toMatchObject({ intervalSeconds: 1, timeoutSeconds: 120, unit: 'seconds', unitInferred: true })
  })
})

// ---------------------------------------------------------------------------
// ARRAY_PRODUCT_CODE / ARRAY_IDENTITY
// ---------------------------------------------------------------------------

describe('ARRAY_PRODUCT_CODE', () => {
  it('defaults to credmo3bReportScore', () => {
    expect(getConfig({}).productCode).toBe(DEFAULT_PRODUCT_CODE)
    expect(DEFAULT_PRODUCT_CODE).toBe('credmo3bReportScore')
  })

  it('is overridable', () => {
    expect(getConfig({ ARRAY_PRODUCT_CODE: 'tui1bReportScore' }).productCode).toBe('tui1bReportScore')
  })
})

describe('ARRAY_IDENTITY', () => {
  it('defaults to the BANKER COLDIRON persona', () => {
    const { identity } = getConfig({})
    expect(identity.slug).toBe('banker-coldiron')
    expect(identity.source).toBe('default')
    expect(identity.confidence).toBe('verified')
  })

  it('accepts a persona slug in any spelling', () => {
    for (const raw of ['dalton-lot', 'DALTON_LOT', 'Dalton Lot']) {
      const { identity } = getConfig({ ARRAY_IDENTITY: raw })
      expect(identity.slug).toBe('dalton-lot')
      expect(identity.source).toBe('persona')
      // Os campos dessas personas são placeholder: o selo tem que dizer isso.
      expect(identity.confidence).toBe('unverified')
    }
  })

  it('accepts inline JSON', () => {
    const { identity } = getConfig({
      ARRAY_IDENTITY: JSON.stringify({
        firstName: 'MARIA',
        lastName: 'SILVA',
        dob: '1990-05-05',
        ssn: '666-11-2222',
        address: { street: '1 MAIN ST', city: 'AUSTIN', state: 'tx', zip: '78701' },
      }),
    })
    expect(identity).toMatchObject({ firstName: 'MARIA', lastName: 'SILVA', source: 'json', confidence: 'unverified' })
    expect(identity.ssn).toBe('666112222')
    expect(identity.address.state).toBe('TX')
  })

  it('falls back to the default persona with a warning on an unknown value', () => {
    const cfg = getConfig({ ARRAY_IDENTITY: 'ninguem-conhecido' })
    expect(cfg.identity.slug).toBe('banker-coldiron')
    expect(cfg.warnings.join(' ')).toMatch(/ARRAY_IDENTITY/)
  })

  // ---------------------------------------------------------------------
  // W2-002 — em produção a identidade é DESCARTADA (esvaziada), não só
  // re-rotulada. Antes o spread preservava ssn/dob/endereço e o /api/seed
  // mandava tudo para o host de produção.
  // ---------------------------------------------------------------------
  it('is DISCARDED (emptied) in production, not just relabelled', () => {
    const cfg = getConfig({ ARRAY_ENV: 'production', ARRAY_IDENTITY: 'dalton-lot' })
    expect(cfg.identityDiscarded).toBe(true)
    expect(cfg.identity.source).toBe('discarded')
    expect(identityIsEmpty(cfg.identity)).toBe(true)
    expect(cfg.identity.ssn).toBe('')
    expect(cfg.identity.dob).toBe('')
    expect(cfg.identity.address.street).toBe('')
    expect(cfg.warnings.join(' ')).toMatch(/DESCARTADA/)
    expect(publicStatus(cfg).identity.discarded).toBe(true)
  })

  it('never keeps a user-typed SSN in production, whatever the host route', () => {
    const inline = '{"firstName":"MARIA","lastName":"SILVA","ssn":"123456789"}'
    for (const env of [
      { ARRAY_ENV: 'production', ARRAY_IDENTITY: inline },
      { ARRAY_BASE_URL: 'https://array.io', ARRAY_IDENTITY: inline },
      { ARRAY_BASE_URL: 'https://array.io', ARRAY_ENV: 'sandbox', ARRAY_IDENTITY: inline },
    ]) {
      const cfg = getConfig(env)
      expect(cfg.arrayEnv).toBe('production')
      expect(JSON.stringify(cfg.identity)).not.toContain('123456789')
      expect(JSON.stringify(cfg.identity)).not.toContain('MARIA')
      // Invariante: nenhum campo de PII sobra no objeto de config.
      expect(identityIsEmpty(cfg.identity)).toBe(true)
    }
  })

  it('keeps every persona SSN out of production even without ARRAY_IDENTITY', () => {
    const cfg = getConfig({ ARRAY_ENV: 'production' })
    expect(identityIsEmpty(cfg.identity)).toBe(true)
    expect(JSON.stringify(cfg.identity)).not.toContain('666')
  })

  // W2-010 — JSON parcial herdava o SSN da persona default sem dizer nada.
  it('warns which fields a partial ARRAY_IDENTITY JSON inherited from the default persona', () => {
    const cfg = getConfig({ ARRAY_IDENTITY: '{"firstName":"MARIA"}' })
    expect(cfg.identity.ssn).toBe(DEFAULT_IDENTITY.ssn)
    expect(cfg.warnings.join(' ')).toMatch(/ssn/)
    expect(cfg.warnings.join(' ')).toMatch(/persona default/)
    // Um JSON completo não avisa nada.
    const full = getConfig({
      ARRAY_IDENTITY:
        '{"firstName":"MARIA","lastName":"SILVA","dob":"1990-01-01","ssn":"666000111","address":{"street":"1 A ST","city":"X","state":"TX","zip":"70000"}}',
    })
    expect(full.warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Webhook config
// ---------------------------------------------------------------------------

// W2-006 — teto de sanidade para ARRAY_POLL_*
describe('ARRAY_POLL_* clamp (W2-006)', () => {
  it('clampa um timeout absurdo com aviso em vez de pendurar a requisição', () => {
    const cfg = getConfig({ ARRAY_POLL_TIMEOUT: '1e9' })
    expect(cfg.pollTimeoutMs).toBe(MAX_POLL_TIMEOUT_S * 1000)
    expect(cfg.warnings.join(' ')).toMatch(/teto de sanidade/)
  })

  it('clampa um intervalo absurdo com aviso', () => {
    const cfg = getConfig({ ARRAY_POLL_INTERVAL: '1000000' })
    expect(cfg.pollIntervalMs).toBe(MAX_POLL_INTERVAL_S * 1000)
    expect(cfg.warnings.join(' ')).toMatch(/teto de sanidade/)
  })

  it('valores plausíveis continuam intactos e sem aviso', () => {
    const cfg = getConfig({ ARRAY_POLL_INTERVAL: '2.5', ARRAY_POLL_TIMEOUT: '300' })
    expect(cfg.pollIntervalMs).toBe(2500)
    expect(cfg.pollTimeoutMs).toBe(300000)
    expect(cfg.warnings).toEqual([])
  })
})

describe('webhook config', () => {
  it('reports the listener URL and never the token', () => {
    const cfg = getConfig({ ARRAY_LISTENER_URL: 'https://meu.host/api/webhooks/array/abc', ARRAY_WEBHOOK_TOKEN: 'SEGREDO-DO-PATH' })
    const status = publicStatus(cfg)
    // W2-003: o segredo vive no PATH, então a URL inteira é segredo — sai elidida.
    expect(status.webhook).toMatchObject({
      listenerUrl: 'https://meu.host/api/webhooks/array/***',
      listenerUrlMasked: true,
      configured: true,
      secretInPathInferred: true,
      registrationIsManual: true,
    })
    expect(JSON.stringify(status.webhook)).not.toContain('SEGREDO-DO-PATH')
  })

  it('elides the token even when it appears elsewhere in the listener URL', () => {
    const cfg = getConfig({
      ARRAY_LISTENER_URL: 'https://meu.host/hooks/SEGREDO-DO-PATH?k=SEGREDO-DO-PATH',
      ARRAY_WEBHOOK_TOKEN: 'SEGREDO-DO-PATH',
    })
    expect(cfg.listenerUrlMasked).toBe('https://meu.host/hooks/***?k=***')
    expect(cfg.listenerUrlHadSecret).toBe(true)
    expect(JSON.stringify(publicStatus(cfg))).not.toContain('SEGREDO-DO-PATH')
  })

  it('reports "not configured" without ARRAY_WEBHOOK_TOKEN', () => {
    expect(publicStatus(getConfig({})).webhook).toMatchObject({ configured: false, listenerUrl: null })
  })
})

describe('mock appKey placeholder', () => {
  it('is 36 chars so Array\'s embed loader accepts it', () => {
    // The loader validates appKey.length === 36 (docs/ARRAY_API_RESEARCH.md §2).
    expect(publicStatus(getConfig({})).appKey).toHaveLength(36)
  })
})
