/**
 * VALIDATE ciclo 14 — matriz de normalização do ARRAY_BASE_URL.
 *
 * Evidência independente: transpila `worker/src/config.ts` com esbuild e chama
 * `getConfig` direto, com e sem `ARRAY_ENV` (a wrangler.toml define
 * ARRAY_ENV="sandbox" em [vars], então o caso "sem ARRAY_ENV" NÃO acontece na
 * POC rodando — é exatamente o que este script expõe).
 *
 * Uso: node scripts/baseurl-matrix-ciclo13.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'scripts/.tmp-ciclo13')
fs.mkdirSync(out, { recursive: true })
const bundle = path.join(out, 'config.mjs')
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'worker/src/config.ts'),
  '--bundle',
  '--format=esm',
  '--platform=neutral',
  `--outfile=${bundle}`,
])
const { getConfig } = await import(bundle)

const CASES = [
  ['(ausente)', undefined],
  ['https://sandbox.array.io', 'https://sandbox.array.io'],
  ['https://sandbox.array.io/api', 'https://sandbox.array.io/api'],
  ['https://sandbox.array.io/', 'https://sandbox.array.io/'],
  ['https://sandbox.array.io/api/', 'https://sandbox.array.io/api/'],
  ['http:// (sem TLS)', 'http://sandbox.array.io'],
  ['produção', 'https://array.io'],
  ['produção /api', 'https://array.io/api'],
  ['localhost:9999 (sem esquema)', 'localhost:9999'],
  ['http://localhost:9999', 'http://localhost:9999'],
  ['string vazia', ''],
  ['sem esquema', 'sandbox.array.io'],
  ['path extra', 'https://sandbox.array.io/api/v2'],
  ['com espaços', '  https://sandbox.array.io  '],
  ['espaço no meio', 'https://sandbox.array.io/a b'],
  ['absurdo', 'nao-e-uma-url-!!!'],
  ['javascript:', 'javascript:alert(1)'],
  ['file://', 'file:///etc/passwd'],
  ['query+hash', 'https://sandbox.array.io/api?x=1#f'],
  ['userinfo', 'https://evil.com@sandbox.array.io/api'],
  ['upper host', 'HTTPS://SANDBOX.ARRAY.IO'],
  ['ip literal', 'https://127.0.0.1:8899'],
]

const rows = []
for (const [label, value] of CASES) {
  for (const envMode of ['ARRAY_ENV=sandbox (wrangler.toml)', 'sem ARRAY_ENV']) {
    const env = { ARRAY_APP_KEY: 'A'.repeat(36), ARRAY_SERVER_TOKEN: 'SECRET' }
    if (value !== undefined) env.ARRAY_BASE_URL = value
    if (envMode.startsWith('ARRAY_ENV')) env.ARRAY_ENV = 'sandbox'
    let cfg
    try {
      cfg = getConfig(env)
    } catch (e) {
      rows.push({ label, value, envMode, throw: String(e) })
      continue
    }
    rows.push({
      label,
      value,
      envMode,
      baseUrl: cfg.baseUrl,
      baseUrlSource: cfg.baseUrlSource,
      arrayEnv: cfg.arrayEnv,
      cdn: cfg.componentsCdn,
      warnings: cfg.warnings,
    })
  }
}

const findings = []
for (const r of rows) {
  if (r.throw) findings.push(`THROW em ${r.label}/${r.envMode}: ${r.throw}`)
  // Um valor inválido não pode apontar para produção silenciosamente.
  if (r.baseUrl === 'https://array.io/api' && !/produção/.test(r.label)) {
    findings.push(`PRODUÇÃO silenciosa: ${r.label} (${r.envMode}) -> ${r.baseUrl} warnings=${JSON.stringify(r.warnings)}`)
  }
  // http:// para loopback é legítimo (é como este QA observa as chamadas);
  // para host REMOTO significa client token em texto claro na rede.
  const remoteHttp = r.baseUrl && /^http:/.test(r.baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(r.baseUrl)
  if (remoteHttp && r.warnings?.length === 0) {
    findings.push(`baseUrl não-https sem aviso: ${r.label} (${r.envMode}) -> ${r.baseUrl}`)
  }
  if (r.baseUrlSource === 'ARRAY_ENV' && r.value && r.warnings?.length === 0) {
    findings.push(`valor recusado SEM aviso: ${r.label} (${r.envMode}) -> ${r.baseUrl}`)
  }
}

console.log(
  rows
    .map(
      (r) =>
        `${r.envMode.padEnd(32)} | ${String(r.value).padEnd(34)} | ${String(r.baseUrl).padEnd(34)} | ${String(
          r.baseUrlSource,
        ).padEnd(14)} | ${r.arrayEnv} | ${r.warnings?.length ? 'AVISO' : '-'}`,
    )
    .join('\n'),
)
fs.writeFileSync(path.join(out, 'baseurl-matrix.json'), JSON.stringify(rows, null, 2))
console.log(`\nbaseurl-matrix-ciclo13: ${findings.length} achado(s)`)
for (const f of findings) console.log(` - ${f}`)
