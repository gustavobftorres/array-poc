/**
 * VALIDATE ciclo 7 — X-008/X-011: envenenamento do cache de userToken no KV.
 *
 * Escreve entradas à mão no KV local do miniflare (sqlite + blob) na chave que o
 * worker vai consultar e verifica se o valor envenenado é servido. Variantes:
 * sem `scope`, `scope` divergente, `expiresAt` vencido, `ttl` divergente,
 * `scope` do client token antigo (rotação, X-011) e o caso de controle
 * (entrada perfeita, que DEVE ser servida — senão o cache está morto e o teste
 * dos outros casos não provaria nada).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const API = process.env.API ?? 'http://localhost:8787'
const KVDIR = 'worker/.wrangler/state/v3/kv/miniflare-KVNamespaceObject'
const BLOBS = 'worker/.wrangler/state/v3/kv/local-cache/blobs'
const findings = []
const add = (s) => (findings.push(s), console.log('ACHADO: ' + s))

function shortHash(value) {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

const st = await fetch(`${API}/api/status`).then((r) => r.json())
// Em modo mock o cfg.appKey é vazio (o appKey exibido é placeholder) e o client
// token é vazio -> o mesmo cálculo do worker.
const appKeyScope = st.hasAuthId ? st.appKey : 'no-appkey'
const clientToken = ''
const SCOPE = `${st.mode}|${appKeyScope}|${st.baseUrl}|ct${shortHash(clientToken)}`
console.log('escopo corrente:', SCOPE)

const dbfile = fs.readdirSync(KVDIR).find((f) => f.endsWith('.sqlite'))
const dbpath = path.join(KVDIR, dbfile)
fs.mkdirSync(BLOBS, { recursive: true })

/**
 * Inserir uma linha NOVA no sqlite do miniflare não funciona: o namespace já
 * está aberto e não vê a chave nova. Então o envenenamento é feito no BLOB de
 * uma entrada legítima recém-emitida (a linha já está no índice), que é o pior
 * caso realista: alguém com acesso ao volume do KV reescreve o valor.
 */
function blobPathOf(key) {
  const out = execFileSync('python3', [
    '-c',
    'import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nr=[x[0] for x in c.execute("select blob_id from _mf_entries where key=?",(sys.argv[2],))]\nprint(r[0] if r else "")',
    dbpath,
    key,
  ]).toString().trim()
  return out ? path.join(BLOBS, out) : ''
}

const cases = [
  { ttl: 61, name: 'controle (valor legítimo, só o token trocado)', mutate: (v) => v, expectServed: true },
  { ttl: 62, name: 'sem campo scope', mutate: (v) => { const { scope, ...r } = v; return r } },
  { ttl: 63, name: 'scope divergente (mock -> sandbox)', mutate: (v) => ({ ...v, scope: v.scope.replace('mock', 'sandbox') }) },
  { ttl: 64, name: 'scope divergente (appKey de outra conta)', mutate: (v) => ({ ...v, scope: v.scope.replace('no-appkey', 'AAAAAAAA-2222-4333-8444-555555555555') }) },
  { ttl: 65, name: 'expiresAt vencido', mutate: (v) => ({ ...v, expiresAt: new Date(Date.now() - 60_000).toISOString() }) },
  { ttl: 66, name: 'expiresAt dentro da margem de 60s', mutate: (v) => ({ ...v, expiresAt: new Date(Date.now() + 30_000).toISOString() }) },
  { ttl: 67, name: 'ttl divergente no valor', mutate: (v) => ({ ...v, ttlInMinutes: 1440 }) },
  { ttl: 68, name: 'client token rotacionado (ct antigo no scope)', mutate: (v) => ({ ...v, scope: v.scope.replace(/ct[0-9a-f]{8}/, 'ct' + shortHash('TOKEN-ANTIGO')) }) },
  { ttl: 69, name: 'scope null', mutate: (v) => ({ ...v, scope: null }) },
  { ttl: 70, name: 'scope = prefixo do corrente', mutate: (v) => ({ ...v, scope: SCOPE.slice(0, -2) }) },
  { ttl: 71, name: 'scope = corrente + sufixo', mutate: (v) => ({ ...v, scope: SCOPE + 'X' }) },
]

// Um consumidor registrado no mock (o cache só é alcançado com clientKey válido).
const seeded = await fetch(`${API}/api/seed`, { method: 'POST' }).then((r) => r.json())
const clientKey = seeded.clientKey
console.log('clientKey:', clientKey)

for (const c of cases) {
  const mint = await fetch(`${API}/api/array/usertoken?refresh=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientKey, ttlInMinutes: c.ttl }),
  }).then((r) => r.json())
  const key = `usertoken:v2:${SCOPE}|${c.ttl}|${clientKey}`
  const bp = blobPathOf(key)
  if (!bp || !fs.existsSync(bp)) {
    add(`${c.name}: a emissão não gravou a entrada ${key} no KV (nada a envenenar)`)
    continue
  }
  const stored = JSON.parse(fs.readFileSync(bp, 'utf8'))
  const poisoned = c.mutate({ ...stored, userToken: 'POISONED-' + c.ttl })
  fs.writeFileSync(bp, JSON.stringify(poisoned))
  const res = await fetch(`${API}/api/array/usertoken`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientKey, ttlInMinutes: c.ttl }),
  })
  const body = await res.json()
  const served = String(body.userToken ?? '').startsWith('POISONED')
  console.log(`${c.name}: ${res.status} served=${served} cached=${body.cached ?? false} token=${body.userToken}`)
  if (c.expectServed && !served) add(`${c.name}: o cache NÃO serviu a entrada válida — os outros casos perdem valor`)
  if (!c.expectServed && served) add(`${c.name}: entrada envenenada FOI servida (${body.userToken})`)
  if (!c.expectServed && !served && body.userToken === mint.userToken) {
    // reemissão em modo mock devolve valor diferente; token igual ao anterior seria cache
    add(`${c.name}: recusou o veneno mas devolveu o token anterior (suspeita de outro cache)`)
  }
}

console.log(`\nkv-poison-ciclo7: ${findings.length} achado(s)`)
process.exit(findings.length ? 1 : 0)
