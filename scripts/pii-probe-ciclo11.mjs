/**
 * Z-005 — varredura independente de PII (ciclo 12).
 *
 * Envia payloads com sentinelas únicas (nome, DOB, endereco, e-mail, telefone,
 * SSN) por vários caminhos — corpo plano, aninhado, array, chaves variantes,
 * query string, corpo nao-JSON e payload grande (envelope de truncamento) — e
 * depois varre TODAS as superficies persistidas procurando o valor ORIGINAL:
 *
 *   - GET /api/inspector (a tela)
 *   - o sqlite do D1 inteiro (api_calls, users, ...), em bruto
 *   - os blobs do KV
 *   - o stdout do `npm run dev` (se o caminho for passado em DEV_LOG)
 *
 * Uso: node scripts/pii-probe-ciclo11.mjs
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const API = process.env.API ?? 'http://127.0.0.1:8787'
const findings = []
const add = (m) => { findings.push(m); console.log(`  ACHADO: ${m}`) }

// Sentinelas: strings improváveis, uma por classe, para grep sem falso positivo.
const S = {
  first: 'Zaphodxq',
  last: 'Beeblebroxqq',
  nested: 'NestedNameQq',
  arr: 'ArrayGivenQq',
  variantA: 'SnakeFirstQq',
  variantB: 'CamelGivenQq',
  variantC: 'PascalFirstQq',
  variantD: 'SurnameFamQq',
  street: '9876 Sentinelaqq Roadway',
  zip: '90210',
  email: 'zaphodxq@sentinela-qq.example',
  phone: '4155550137',
  dob: '1991-07-13',
  ssn: '666230561',
  qs: 'QueryStringNameQq',
  bigName: 'BigPayloadNameQq',
  rawBody: 'RawBodyNameQq',
  errMsg: 'ErrorMessageNameQq',
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text }
}

const enroll = (over = {}) => ({
  firstName: S.first,
  lastName: S.last,
  dob: S.dob,
  ssn: S.ssn,
  email: S.email,
  phone: S.phone,
  address: { street: S.street, city: 'Austin', state: 'TX', zip: S.zip },
  ...over,
})

async function main() {
  await call('DELETE', '/api/inspector')

  // 1. enrollment canonico
  const r1 = await call('POST', '/api/array/user', enroll())
  console.log(`1. enrollment plano -> ${r1.status}`)

  // 2. PII aninhada em varios niveis
  await call('POST', '/api/array/user', enroll({
    consumer: { identity: { profile: { firstName: S.nested, dob: '1982-02-02' } } },
  }))

  // 3. PII dentro de array
  await call('POST', '/api/array/user', enroll({
    applicants: [{ givenName: S.arr, emailAddress: 'arr@sentinela-qq.example' }],
  }))

  // 4. chaves variantes
  await call('POST', '/api/array/user', enroll({
    first_name: S.variantA,
    givenName: S.variantB,
    FirstName: S.variantC,
    surname: S.variantD,
    family_name: 'FamilyUnderscoreQq',
    birthDate: '1975-03-04',
    postalCode: '73301',
    homePhone: '4155550138',
    'e-mail': 'dash@sentinela-qq.example',
    nickname: 'NickNameQq',
  }))

  // 5. query string com PII
  await call('GET', `/api/array/authenticate?clientKey=nope&firstName=${S.qs}&ssn=${S.ssn}`)

  // 6. payload grande -> envelope de truncamento (preview)
  await call('POST', '/api/array/user', enroll({
    firstName: S.bigName,
    notes: 'x'.repeat(60000),
  }))
  // 6b. payload grande com a PII DEPOIS do padding (preview corta antes)
  await call('POST', '/api/array/user', { notes: 'y'.repeat(60000), lateName: 'LateNameQq', firstName: 'PreviewNameQq' })

  // 7. corpo nao-JSON (form-encoded) — o middleware guarda { raw }
  await call('POST', '/api/array/user', `firstName=${S.rawBody}&ssn=${S.ssn}`, {
    'content-type': 'application/x-www-form-urlencoded',
  })

  // 8. PII vinda de mensagem de erro upstream: reproduzido na propria funcao de
  //    redacao (o worker em modo mock nunca fala com a Array).
  const redactSrc = fs.readFileSync('worker/src/redact.ts', 'utf8')
  fs.mkdirSync('scripts/.tmp-ciclo11', { recursive: true })
  execFileSync('node_modules/.bin/esbuild', [
    'worker/src/redact.ts', '--format=esm', '--outfile=scripts/.tmp-ciclo11/redact.mjs',
  ], { stdio: 'pipe' })
  const { redact, redactedJson } = await import('../scripts/.tmp-ciclo11/redact.mjs')
  const upstreamErr = {
    message: `Consumer ${S.errMsg} (${S.dob}) already enrolled`,
    kind: 'http',
    upstream: { message: `duplicate for ${S.errMsg}`, detail: { firstName: 'OkNameQq' } },
  }
  const redactedErr = JSON.stringify(redact(upstreamErr))
  if (redactedErr.includes(S.errMsg)) add(`PII em mensagem de erro upstream NAO e redigida: ${redactedErr.slice(0, 160)}`)
  if (redactedErr.includes('OkNameQq')) add('firstName dentro de upstream.detail nao redigido')
  if (redactSrc.includes('SENSITIVE_KEYS') === false) add('redact.ts mudou de forma inesperada')

  // 8b. forma continua util?
  const shaped = JSON.parse(redactedJson(enroll()))
  for (const k of ['firstName', 'lastName', 'dob', 'ssn', 'email', 'phone']) {
    if (!(k in shaped)) add(`redacao APAGOU a chave ${k} — a forma do payload deixou de ser legivel`)
  }
  if (shaped.address?.city !== 'Austin' || shaped.address?.state !== 'TX') add('city/state deixaram de ficar em claro')
  console.log(`8. forma preservada: ${JSON.stringify(shaped).slice(0, 220)}`)

  // ---- varredura ----
  const insp = (await call('GET', '/api/inspector?limit=200')).text
  const sqlite = fs.readFileSync(
    execFileSync('bash', ['-lc', "ls -t worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | head -1"])
      .toString().trim(),
  ).toString('latin1')
  let kv = ''
  try {
    kv = execFileSync('bash', ['-lc', 'cat worker/.wrangler/state/v3/kv/*/blobs/* 2>/dev/null | tr -d "\\0"']).toString()
  } catch { kv = '' }
  const devLog = process.env.DEV_LOG && fs.existsSync(process.env.DEV_LOG)
    ? fs.readFileSync(process.env.DEV_LOG, 'utf8') : ''

  const surfaces = [
    ['GET /api/inspector', insp],
    ['D1 sqlite (bruto)', sqlite],
    ['KV blobs', kv],
    ...(devLog ? [['stdout do npm run dev', devLog]] : []),
  ]

  // A tabela `users` guarda nome/dob/endereco em claro POR DESIGN (declarado no
  // README); o sqlite bruto por isso sempre casa. Separamos: o que precisa ser
  // limpo em toda superficie sao os campos de auditoria (api_calls) e o KV.
  const mustBeAbsent = Object.entries(S).filter(([k]) => k !== 'zip')
  for (const [name, hay] of surfaces) {
    for (const [k, v] of mustBeAbsent) {
      if (!hay.includes(v)) continue
      if (name === 'D1 sqlite (bruto)' && ['first', 'last', 'street', 'email', 'phone', 'dob'].includes(k)) {
        console.log(`  (esperado, tabela users por design) ${k} em ${name}`)
        continue
      }
      add(`${k} ("${v}") aparece em ${name}`)
    }
  }

  // api_calls isolada, via a propria rota: nenhuma sentinela pode estar la.
  for (const [k, v] of mustBeAbsent) {
    if (insp.includes(v)) add(`sentinela ${k} no /api/inspector`)
  }

  // SSN completo em qualquer lugar do log de auditoria
  if (/\b\d{3}-?\d{2}-?\d{4}\b/.test(insp.replace(/\d{4}-\d{2}-\d{2}/g, ''))) {
    add('sequencia com forma de SSN no /api/inspector')
  }

  // preview do envelope de truncamento
  const rows = JSON.parse(insp).calls ?? JSON.parse(insp).items ?? []
  const trunc = rows.filter((r) => JSON.stringify(r).includes('_truncated'))
  console.log(`envelope(s) de truncamento vistos: ${trunc.length}`)
  for (const t of trunc) {
    const s = JSON.stringify(t)
    for (const [k, v] of mustBeAbsent) if (s.includes(v)) add(`preview do truncamento vaza ${k}`)
  }

  console.log(`\npii-probe-ciclo11: ${findings.length} achado(s)`)
  process.exit(findings.length ? 1 : 0)
}
main()
