/**
 * Servidor Array FALSO usado por scripts/verify-guide-ciclo7.mjs. Roda em
 * processo próprio (o pai bloqueia o event loop com execFileSync ao rodar os
 * curl do Guia) e registra cada requisição em JSONL.
 */
import http from 'node:http'
import fs from 'node:fs'

const PORT = Number(process.env.PORT ?? 8899)
const LOG = process.env.LOG ?? 'scripts/.tmp-guide7/requests.jsonl'
const SECRET = process.env.SECRET
const APP_KEY = process.env.APP_KEY

http
  .createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
      const ct = req.headers['x-credmo-client-token']
      fs.appendFileSync(
        LOG,
        JSON.stringify({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), ct: ct ?? null, body, contentType: req.headers['content-type'] ?? null }) + '\n',
      )
      const json = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      // GET /report/v2 NAO leva client token: o par reportKey+displayToken E a
      // autenticacao da leitura (ARRAY_API_RESEARCH §3.6). Exigir o segredo aqui
      // fazia a Array falsa devolver 401 num caminho legitimo (ciclo 9).
      if (url.pathname === '/api/report/v2' && req.method === 'GET') {
        const rk = url.searchParams.get('reportKey')
        const dt = url.searchParams.get('displayToken')
        if (!rk || !dt) return json(400, { message: 'Validation failed', error: [{ param: 'displayToken' }] })
        if (dt !== 'DISPLAY-TOKEN-1' && dt !== 'DISPLAY-TOKEN-2')
          return json(401, { message: 'Unauthorized', got: dt })
        return json(200, { reportKey: rk, score: 712 })
      }
      if (ct !== SECRET) return json(401, { message: 'Unauthorized', got: ct ?? null })
      let parsed = null
      if (body) {
        try {
          parsed = JSON.parse(body)
        } catch {
          return json(400, { message: 'Bad Request' })
        }
      }
      const appKey = parsed?.appKey ?? url.searchParams.get('appKey')
      const needsAppKey = !(req.method === 'PUT')
      if (needsAppKey && appKey !== APP_KEY)
        return json(400, { message: 'Validation failed', error: [{ value: appKey ?? '', message: 'appKey is required', param: 'appKey', location: 'body' }] })
      if (url.pathname === '/api/user/v2') return json(200, { clientKey: 'FF9CDBA5-1111-4222-8333-444444444444' })
      if (url.pathname === '/api/authenticate/v2' && req.method === 'GET')
        return json(200, { authToken: 'AUTH-1', questions: [{ questionId: 'Q1', answers: [{ answerId: 'Q1A1' }] }] })
      if (url.pathname === '/api/authenticate/v2' && req.method === 'POST')
        return json(200, { status: 'authenticated', userToken: 'USER-TOKEN-1', ttlInMinutes: 60 })
      if (url.pathname === '/api/authenticate/v2/usertoken')
        return json(200, { appKey, clientKey: parsed.clientKey, userToken: 'USER-TOKEN-2', ttlInMinutes: parsed.ttlInMinutes })
      if (url.pathname === '/api/report/v2' && req.method === 'POST') return json(200, { reportKey: 'REPORT-KEY-1', displayToken: 'DISPLAY-TOKEN-1' })
      if (url.pathname === '/api/report/v2' && req.method === 'GET') return json(200, { reportKey: url.searchParams.get('reportKey'), score: 712 })
      if (url.pathname === '/api/report/v2' && req.method === 'PUT') return json(200, { displayToken: 'DISPLAY-TOKEN-2' })
      return json(404, { message: 'Not Found' })
    })
  })
  .listen(PORT, '127.0.0.1', () => console.log('fake array on ' + PORT))
