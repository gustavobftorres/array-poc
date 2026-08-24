import http from 'node:http'
const PORTX = Number(process.env.PORTX)
import fs from 'node:fs'
let b = 0
http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    fs.appendFileSync(process.env.UPLOG, req.method + ' ' + u.pathname + ' ' + (u.searchParams.get('reportKey') ?? '') + '\n')
    if (u.pathname === '/api/report/v2' && req.method === 'GET') {
      if (u.searchParams.get('reportKey') === 'B') {
        b++
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(b <= 2 ? '{}' : '{"score":712}')
      }
      res.writeHead(401, { 'content-type': 'application/json' })
      return res.end('{"message":"Unauthorized: client token invalido"}')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"displayToken":"novo-1"}')
  })
  .listen(PORTX, '127.0.0.1')
