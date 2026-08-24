/**
 * VALIDATE ciclo 14 — complemento isolado da sonda de polling.
 * Casos que exigem worker limpo (sem requisições atrasadas de um cenário
 * anterior contaminando a contagem): intervalo gigante vs timeout, corpo do
 * 200 vazio e o 202 infinito com timeout default.
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8903
let SCRIPT = ['200']
let hits = []
const upstream = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (!(req.method === 'GET' && /\/report\/v2$/.test(url.pathname))) {
    return res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  }
  const step = SCRIPT[Math.min(hits.length, SCRIPT.length - 1)]
  hits.push(Date.now())
  if (step === '202') return res.writeHead(202).end()
  if (step === '204') return res.writeHead(204).end()
  if (step === '200-empty') return res.writeHead(200, { 'content-type': 'application/json' }).end('')
  return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ score: 712 }))
})
await new Promise((r) => upstream.listen(PORT, '127.0.0.1', r))

let p = 8930
async function run(name, vars, script, maxWaitMs) {
  SCRIPT = script
  hits = []
  const port = p++
  const args = ['wrangler', 'dev', '--local', '--port', String(port)]
  const all = {
    ARRAY_APP_KEY: '11111111-2222-4333-8444-555555555555',
    ARRAY_SERVER_TOKEN: 'SUPERSECRETTOKEN123',
    ARRAY_BASE_URL: `http://127.0.0.1:${PORT}`,
    ...vars,
  }
  for (const [k, v] of Object.entries(all)) args.push('--var', `${k}:${v}`)
  const child = spawn('npx', args, { cwd: path.join(root, 'worker'), stdio: 'ignore' })
  try {
    for (let i = 0; i < 90; i++) {
      try {
        if ((await fetch(`http://localhost:${port}/api/health`)).ok) break
      } catch {}
      await new Promise((r) => setTimeout(r, 500))
    }
    hits = []
    const t0 = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), maxWaitMs)
    let line
    try {
      const res = await fetch(`http://localhost:${port}/api/array/report?reportKey=RK&displayToken=DT`, { signal: ctrl.signal })
      const text = await res.text()
      line = `status=${res.status} body=${JSON.stringify(text.slice(0, 180))}`
    } catch (e) {
      line = `SEM RESPOSTA em ${maxWaitMs}ms (${e.name})`
    }
    clearTimeout(timer)
    console.log(`\n### ${name}\n  ${line}\n  requisições=${hits.length} elapsed=${Date.now() - t0}ms`)
  } finally {
    child.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 1500))
  }
}

await run('interval=1e9 s com timeout=30 s (202,200)', { ARRAY_POLL_INTERVAL: '1000000000', ARRAY_POLL_TIMEOUT: '30' }, ['202', '200'], 25000)
await run('200 com corpo VAZIO', { ARRAY_POLL_INTERVAL: '0.5', ARRAY_POLL_TIMEOUT: '30' }, ['200-empty'], 20000)
await run('timeout=1e9 s, 202 infinito', { ARRAY_POLL_INTERVAL: '0.5', ARRAY_POLL_TIMEOUT: '1000000000' }, ['202'], 15000)
upstream.close()
process.exit(0)
