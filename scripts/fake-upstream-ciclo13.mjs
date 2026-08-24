/**
 * VALIDATE ciclo 14 — upstream falso e INSTRUMENTADO (próprio do QA, não é o
 * `fake-array-ciclo7.mjs` do DEV).
 *
 * Registra byte a byte cada requisição recebida (método, path, query, TODOS os
 * headers, corpo e o timestamp em ms) num arquivo JSONL, e responde conforme um
 * roteiro (`--script`) para exercitar o polling 202/200/204.
 *
 * Uso:
 *   node scripts/fake-upstream-ciclo13.mjs --port 8905 \
 *        --log scripts/.tmp-ciclo13/req.jsonl --script "202,202,200"
 *
 * Roteiro (aplicado só a GET /api/report/v2, na ordem das chamadas):
 *   202,202,200   → dois "ainda gerando" e depois pronto
 *   204           → falha permanente na primeira
 *   202,500       → erro no meio do polling
 *   202,200-empty → 200 com corpo vazio
 *   202*          → 202 para sempre (exercita o timeout)
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : d
}
const port = Number(arg("port", 8905))
const logFile = arg('log', 'scripts/.tmp-ciclo13/req.jsonl')
const script = arg('script', '200').split(',')
fs.mkdirSync(path.dirname(logFile), { recursive: true })
fs.writeFileSync(logFile, '')

let reportCalls = 0
const started = Date.now()

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    const body = Buffer.concat(chunks).toString('utf8')
    const isReport = req.method === 'GET' && /\/report\/v2$/.test(url.pathname)
    let step = '200'
    if (isReport) {
      const i = reportCalls++
      step = script[Math.min(i, script.length - 1)]
      if (script[script.length - 1] === '202*') step = '202'
    }
    fs.appendFileSync(
      logFile,
      JSON.stringify({
        t: Date.now(),
        dtMs: Date.now() - started,
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body: body.slice(0, 4000),
        isReport,
        step,
        reportCallIndex: isReport ? reportCalls - 1 : null,
      }) + '\n',
    )

    if (isReport) {
      if (step === '202') return res.writeHead(202).end()
      if (step === '204') return res.writeHead(204).end()
      if (step === '200-empty') return res.writeHead(200, { 'content-type': 'application/json' }).end('')
      if (/^\d{3}$/.test(step) && step !== '200') {
        return res.writeHead(Number(step), { 'content-type': 'application/json' }).end(JSON.stringify({ message: `upstream disse ${step}` }))
      }
      return res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ reportKey: url.searchParams.get('reportKey'), score: 712, bureaus: ['TU'], fake: true }))
    }

    // Respostas genéricas suficientes para as demais rotas da POC.
    const payload = {
      clientKey: 'FAKE-CLIENT-KEY',
      userId: 'FAKE-USER-ID',
      authToken: 'FAKE-AUTH-TOKEN',
      userToken: 'FAKE-USER-TOKEN',
      reportKey: 'FAKE-REPORT-KEY',
      displayToken: 'FAKE-DISPLAY-TOKEN',
      questions: [],
      alerts: [],
      enrollments: [],
      history: [],
      fake: true,
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
  })
})
server.listen(port, '127.0.0.1', () => console.log(`fake-upstream on ${port} script=${script.join(',')} log=${logFile}`))
