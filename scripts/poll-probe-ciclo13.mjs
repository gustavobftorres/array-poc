/**
 * VALIDATE ciclo 14 — sonda INDEPENDENTE do polling 202/200/204.
 *
 * Não reusa nenhum teste do DEV: sobe um upstream falso instrumentado (neste
 * processo) + um `wrangler dev` isolado por cenário, chama
 * `GET /api/array/report` de verdade e MEDE, do lado do upstream:
 *   - quantas requisições chegaram (204 tem de abortar na PRIMEIRA);
 *   - os intervalos reais entre elas (ARRAY_POLL_INTERVAL);
 *   - o tempo total até o 504 (ARRAY_POLL_TIMEOUT);
 *   - o status/kind que a POC devolve em cada caso.
 *
 * Uso: node scripts/poll-probe-ciclo13.mjs
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'scripts/.tmp-ciclo13')
fs.mkdirSync(out, { recursive: true })

const UPSTREAM_PORT = 8901
let SCRIPT = ['200']
let hits = []

const upstream = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${UPSTREAM_PORT}`)
  const isReport = req.method === 'GET' && /\/report\/v2$/.test(url.pathname)
  if (!isReport) {
    return res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ clientKey: 'CK', reportKey: 'RK', displayToken: 'DT', userToken: 'UT', authToken: 'AT' }))
  }
  const i = hits.length
  hits.push({ t: Date.now(), headers: req.headers, query: Object.fromEntries(url.searchParams) })
  const step = SCRIPT[Math.min(i, SCRIPT.length - 1)]
  if (step === '202') return res.writeHead(202).end()
  if (step === '204') return res.writeHead(204).end()
  if (step === '200-empty') return res.writeHead(200, { 'content-type': 'application/json' }).end('')
  if (step !== '200') return res.writeHead(Number(step), { 'content-type': 'application/json' }).end(JSON.stringify({ message: `upstream ${step}` }))
  return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ score: 712, reportKey: 'RK' }))
})
await new Promise((r) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', r))

let port = 8910
async function withWorker(vars, fn) {
  const p = port++
  const args = ['wrangler', 'dev', '--local', '--port', String(p)]
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`)
  const child = spawn('npx', args, { cwd: path.join(root, 'worker'), stdio: 'ignore' })
  try {
    for (let i = 0; i < 90; i++) {
      try {
        const r = await fetch(`http://localhost:${p}/api/health`)
        if (r.ok) break
      } catch {}
      await new Promise((r) => setTimeout(r, 500))
    }
    return await fn(p)
  } finally {
    child.kill('SIGKILL')
  }
}

const BASE_VARS = {
  ARRAY_APP_KEY: '11111111-2222-4333-8444-555555555555',
  ARRAY_SERVER_TOKEN: 'SUPERSECRETTOKEN123',
  ARRAY_BASE_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
}

const CASES = [
  { name: '202,202,200 (repete até pronto)', script: ['202', '202', '200'], interval: '0.5', timeout: '30' },
  { name: '204 na primeira (falha permanente)', script: ['204'], interval: '0.5', timeout: '30' },
  { name: '202,204 (falha depois de gerar)', script: ['202', '204'], interval: '0.5', timeout: '30' },
  { name: '202,404 (4xx no meio)', script: ['202', '404'], interval: '0.5', timeout: '30' },
  { name: '202,500 (5xx no meio)', script: ['202', '500'], interval: '0.5', timeout: '30' },
  { name: '202,403 (proxy-like no meio)', script: ['202', '403'], interval: '0.5', timeout: '30' },
  { name: '200 com corpo vazio', script: ['200-empty'], interval: '0.5', timeout: '30' },
  { name: '202 sempre → timeout=4s int=1s', script: ['202'], interval: '1.0', timeout: '4' },
  { name: 'intervalo 0.5s (5x 202 → 200)', script: ['202', '202', '202', '202', '202', '200'], interval: '0.5', timeout: '60' },
  { name: 'intervalo 1.0s (5x 202 → 200)', script: ['202', '202', '202', '202', '202', '200'], interval: '1.0', timeout: '60' },
  { name: 'intervalo 3.0s (3x 202 → 200)', script: ['202', '202', '202', '200'], interval: '3.0', timeout: '60' },
  { name: 'interval=0 (inválido)', script: ['202', '202', '200'], interval: '0', timeout: '30' },
  { name: 'interval=-5 (inválido)', script: ['202', '202', '200'], interval: '-5', timeout: '30' },
  { name: 'interval=abc (inválido)', script: ['202', '202', '200'], interval: 'abc', timeout: '30' },
  { name: 'timeout=abc (inválido) 202 sempre', script: ['202'], interval: '0.2', timeout: 'abc', maxWaitMs: 20000 },
  { name: 'timeout=0 (inválido) 202 sempre', script: ['202'], interval: '0.2', timeout: '0', maxWaitMs: 20000 },
  { name: 'timeout=1e9 (gigante) 202 sempre', script: ['202'], interval: '0.2', timeout: '1000000000', maxWaitMs: 20000 },
  { name: 'interval gigante (1e9) 202,200', script: ['202', '200'], interval: '1000000000', timeout: '30', maxWaitMs: 20000 },
]

const rows = []
for (const c of CASES) {
  SCRIPT = c.script
  hits = []
  const vars = { ...BASE_VARS, ARRAY_POLL_INTERVAL: c.interval, ARRAY_POLL_TIMEOUT: c.timeout }
  const r = await withWorker(vars, async (p) => {
    const status = await (await fetch(`http://localhost:${p}/api/status`)).json()
    const t0 = Date.now()
    let httpStatus = null
    let kind = null
    let message = null
    let aborted = false
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => {
        aborted = true
        ctrl.abort()
      }, c.maxWaitMs ?? 90_000)
      const res = await fetch(`http://localhost:${p}/api/array/report?reportKey=RK&displayToken=DT`, { signal: ctrl.signal })
      clearTimeout(timer)
      httpStatus = res.status
      const body = await res.json().catch(() => null)
      kind = body?.kind ?? null
      message = body?.message ?? null
    } catch (e) {
      message = `ABORTADO pelo QA após ${c.maxWaitMs} ms (a POC não respondeu): ${e.name}`
    }
    const elapsed = Date.now() - t0
    const gaps = hits.slice(1).map((h, i) => h.t - hits[i].t)
    return {
      name: c.name,
      interval: c.interval,
      timeout: c.timeout,
      pollFromStatus: status.poll,
      warnings: status.warnings,
      httpStatus,
      kind,
      message: message ? String(message).slice(0, 150) : null,
      requests: hits.length,
      gapsMs: gaps,
      elapsedMs: elapsed,
      abortedByQa: aborted,
    }
  })
  rows.push(r)
  console.log(
    `\n### ${r.name}\n  status=${r.httpStatus} kind=${r.kind} requisições=${r.requests} gaps=${JSON.stringify(r.gapsMs)} elapsed=${r.elapsedMs}ms` +
      `\n  /api/status poll=${JSON.stringify(r.pollFromStatus)} warnings=${JSON.stringify(r.warnings)}` +
      (r.message ? `\n  msg: ${r.message}` : ''),
  )
}

fs.writeFileSync(path.join(out, 'poll-probe.json'), JSON.stringify(rows, null, 2))
upstream.close()

// --- vereditos automáticos -------------------------------------------------
const find = (n) => rows.find((r) => r.name === n)
const findings = []
const chk = (cond, msg) => { if (!cond) findings.push(msg) }
let r = find('202,202,200 (repete até pronto)')
chk(r.httpStatus === 200 && r.requests === 3, `202→200: esperado 200 com 3 requisições, veio ${r.httpStatus}/${r.requests}`)
r = find('204 na primeira (falha permanente)')
chk(r.httpStatus === 502 && r.kind === 'report_failed' && r.requests === 1, `204: esperado 502 report_failed com 1 requisição, veio ${r.httpStatus}/${r.kind}/${r.requests}`)
r = find('202,204 (falha depois de gerar)')
chk(r.httpStatus === 502 && r.kind === 'report_failed' && r.requests === 2, `202,204: veio ${r.httpStatus}/${r.kind}/${r.requests}`)
for (const n of ['202,404 (4xx no meio)', '202,500 (5xx no meio)', '202,403 (proxy-like no meio)']) {
  r = find(n)
  chk(r.kind !== 'timeout' && r.httpStatus !== 200, `${n}: erro no meio do polling não pode virar 200 nem timeout — veio ${r.httpStatus}/${r.kind}`)
}
r = find('202 sempre → timeout=4s int=1s')
chk(r.httpStatus === 504 && r.kind === 'timeout', `timeout: esperado 504 timeout, veio ${r.httpStatus}/${r.kind}`)
chk(r.elapsedMs >= 3000 && r.elapsedMs <= 8000, `timeout de 4s: tempo real ${r.elapsedMs}ms fora de 3–8s`)
for (const [n, want] of [['intervalo 0.5s (5x 202 → 200)', 500], ['intervalo 1.0s (5x 202 → 200)', 1000], ['intervalo 3.0s (3x 202 → 200)', 3000]]) {
  r = find(n)
  const avg = r.gapsMs.reduce((a, b) => a + b, 0) / (r.gapsMs.length || 1)
  chk(Math.abs(avg - want) < want * 0.35 + 150, `${n}: intervalo médio real ${Math.round(avg)}ms ≠ ${want}ms (gaps ${JSON.stringify(r.gapsMs)})`)
}
for (const n of ['interval=0 (inválido)', 'interval=-5 (inválido)', 'interval=abc (inválido)']) {
  r = find(n)
  chk(r.warnings.length > 0, `${n}: sem aviso em /api/status`)
  chk(r.pollFromStatus.intervalSeconds === 1, `${n}: intervalo efetivo ${r.pollFromStatus.intervalSeconds}s (esperado o default 1s)`)
  chk(r.httpStatus === 200, `${n}: esperado 200 (default salva o loop), veio ${r.httpStatus}`)
}
for (const n of ['timeout=abc (inválido) 202 sempre', 'timeout=0 (inválido) 202 sempre']) {
  r = find(n)
  chk(!r.abortedByQa, `${n}: a POC não respondeu em ${r.elapsedMs}ms — espera absurda/loop`)
  chk(r.kind === 'timeout', `${n}: esperado kind timeout, veio ${r.kind}`)
}
r = find('timeout=1e9 (gigante) 202 sempre')
chk(r.abortedByQa || r.httpStatus, `timeout gigante: sem resposta`)
console.log(`\npoll-probe-ciclo13: ${findings.length} achado(s)`)
for (const f of findings) console.log(` - ${f}`)
process.exit(0)
