/**
 * VALIDATE ciclo 7 — verificação INDEPENDENTE dos artefatos coláveis do Guia.
 *
 * Não reusa nada de scripts/guide-check-ciclo6.mjs (do DEV). A ideia é diferente
 * e mais dura: em vez de reescrever o host para o worker da POC (que expõe rotas
 * /api/array/*, e não as da Array), este script sobe um FALSO servidor da Array
 * em 127.0.0.1:8899 que implementa as rotas reais (/api/user/v2,
 * /api/authenticate/v2, /api/authenticate/v2/usertoken, /api/report/v2) e
 * VALIDA a requisição como a Array validaria:
 *   - header x-credmo-client-token EXATAMENTE igual ao segredo (sem comentário
 *     colado dentro do valor, sem `$VAR` literal) — senão 401;
 *   - appKey presente no corpo (ou na query, no GET de perguntas) — senão 400
 *     com o shape de "Validation failed" da pesquisa §6;
 *   - content-type application/json nas rotas de POST/PUT.
 * Cada `curl` da TELA RENDERIZADA (não do código-fonte) é extraído, passa por
 * `bash -n` e é EXECUTADO com o host reescrito. Cada snippet TypeScript é
 * compilado com `tsc --strict`.
 */
import { chromium } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const PORT = 8899
const TMP = path.join(process.cwd(), 'scripts/.tmp-guide7')
const SECRET = 'CLIENT-TOKEN-SEGREDO-DO-SERVIDOR'
const APP_KEY = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE' // 36 chars
const findings = []
const add = (s) => (findings.push(s), console.log('ACHADO: ' + s))

fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

// ------------------------------------------- fake Array em processo separado
const LOG = path.join(TMP, 'requests.jsonl')
fs.writeFileSync(LOG, '')
const child = spawn(process.execPath, ['scripts/fake-array-ciclo7.mjs'], {
  env: { ...process.env, PORT: String(PORT), LOG, SECRET, APP_KEY },
  stdio: 'inherit',
})
await new Promise((r) => setTimeout(r, 700))
const readLog = () =>
  fs
    .readFileSync(LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

// ------------------------------------------------------- extract from screen
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })
const cards = page.locator('.steps > .card')
const n = await cards.count()
if (n !== 6) add(`esperava 6 passos na tela, achei ${n}`)
const steps = []
for (let i = 0; i < n; i++) {
  const card = cards.nth(i)
  const title = (await card.locator('h3').first().innerText()).replace(/\n/g, ' ')
  const buttons = card.locator('button.tiny')
  // primeiro botão = curl|HTML, segundo = TypeScript
  await buttons.nth(0).click()
  const curl = await card.locator('pre.json').innerText()
  await buttons.nth(1).click()
  const ts = await card.locator('pre.json').innerText()
  await buttons.nth(0).click()
  steps.push({ i: i + 1, title, curl, ts })
}
await browser.close()
fs.writeFileSync(path.join(TMP, 'steps.json'), JSON.stringify(steps, null, 2))

// -------------------------------------------------------------- curl checks
const env = {
  ...process.env,
  ARRAY_SERVER_TOKEN: SECRET,
  ARRAY_APP_KEY: APP_KEY,
  CLIENT_KEY: 'FF9CDBA5-1111-4222-8333-444444444444',
  AUTH_TOKEN: 'AUTH-1',
  REPORT_KEY: 'REPORT-KEY-1',
  DISPLAY_TOKEN: 'DISPLAY-TOKEN-1',
  ARRAY_POLL_INTERVAL: '0',
  ARRAY_POLL_TIMEOUT: '10',
}

for (const s of steps) {
  const isHtml = /<script/.test(s.curl)
  if (isHtml) {
    // passo do browser: sem curl para executar; só checa que não tem segredo
    if (/credmo-client-token|ARRAY_SERVER_TOKEN|ARRAY_CLIENT_TOKEN/.test(s.curl)) add(`passo ${s.i}: snippet de BROWSER menciona o client token`)
    if (!/array-web-component\.js[\s\S]*\.js\?appKey=/.test(s.curl)) add(`passo ${s.i}: ordem runtime→bundle não confere`)
    continue
  }
  const before = readLog().length
  const rewritten = s.curl.replace(/https:\/\/sandbox\.array\.io/g, `http://127.0.0.1:${PORT}`)
  const file = path.join(TMP, `step${s.i}.sh`)
  fs.writeFileSync(file, rewritten + '\n')
  try {
    execFileSync('bash', ['-n', file], { stdio: 'pipe' })
  } catch (e) {
    add(`passo ${s.i}: 'bash -n' recusou o snippet — ${String(e.stderr)}`)
    continue
  }
  let out = ''
  try {
    out = execFileSync('bash', [file], { env, stdio: 'pipe', timeout: 60000 }).toString()
  } catch (e) {
    add(`passo ${s.i}: execução falhou (exit ${e.status}) — ${String(e.stderr).slice(0, 300)}`)
    out = String(e.stdout ?? '')
  }
  fs.writeFileSync(path.join(TMP, `step${s.i}.out`), out)
  const reqs = readLog().slice(before)
  const arrayReqs = reqs
  if (!arrayReqs.length) add(`passo ${s.i}: nenhuma requisição chegou ao servidor Array falso`)
  for (const r of arrayReqs) {
    if (r.ct === null && !(r.method === 'GET' && r.path === '/api/report/v2'))
      add(`passo ${s.i}: ${r.method} ${r.path} sem header x-credmo-client-token`)
    else if (r.ct !== null && r.ct !== SECRET)
      add(`passo ${s.i}: valor do client token corrompido -> ${JSON.stringify(r.ct)}`)
    if (r.body) {
      let p = null
      try {
        p = JSON.parse(r.body)
      } catch {
        add(`passo ${s.i}: corpo enviado não é JSON válido -> ${r.body.slice(0, 120)}`)
      }
      if (p && !(r.method === 'PUT') && p.appKey !== APP_KEY)
        add(`passo ${s.i}: corpo de ${r.method} ${r.path} sem appKey expandido -> ${JSON.stringify(p.appKey)}`)
      if (p && /\$[A-Z_]/.test(r.body.replace(/"appKey":"[^"]*"/, '')))
        add(`passo ${s.i}: variável não expandida no corpo -> ${r.body.slice(0, 160)}`)
    }
    if (/401|Unauthorized/.test(out) && r.path !== '/nope') add(`passo ${s.i}: a Array falsa respondeu 401 (credencial malformada)`)
    if (/Validation failed/.test(out)) add(`passo ${s.i}: a Array falsa respondeu "Validation failed" (appKey ausente)`)
  }
  // O curl extra do passo 3 fala com o worker da POC: exige userToken de volta
  if (/localhost:8787/.test(s.curl) && !/userToken/.test(out))
    add(`passo ${s.i}: o curl contra o worker da POC não devolveu userToken -> ${out.slice(0, 200)}`)
}

// ----------------------------------------------------------------- tsc pass
const ambient = `
declare const db: any; declare const sessao: any; declare const telemetria: any
declare function arrayGet(u: string): Promise<any>
declare function arrayPost(u: string, b: any): Promise<any>
declare function arrayPut(u: string, b: any): Promise<any>
declare const APP_KEY: string
declare class KbaReprovada extends Error {}
declare class DisplayTokenExpirado extends Error {}
interface Identidade { userId: string }
declare const process: { env: Record<string, string | undefined> }
`
fs.writeFileSync(path.join(TMP, 'ambient.d.ts'), ambient)
for (const s of steps) {
  const f = path.join(TMP, `step${s.i}.ts`)
  fs.writeFileSync(f, s.ts + '\nexport {}\n')
  try {
    execFileSync(
      'node_modules/.bin/tsc',
      [ '--strict', '--noEmit', '--target', 'es2022', '--lib', 'es2022,dom', '--moduleResolution', 'bundler', '--module', 'esnext', path.join(TMP, 'ambient.d.ts'), f],
      { stdio: 'pipe', cwd: process.cwd() },
    )
  } catch (e) {
    add(`passo ${s.i}: snippet TypeScript não compila com tsc --strict —\n${String(e.stdout)}`)
  }
}

child.kill()
const all = readLog()
console.log(`\nrequisições vistas pela Array falsa: ${all.length}`)
console.log(all.map((r) => `${r.method} ${r.path} ct=${r.ct === SECRET ? 'OK' : JSON.stringify(r.ct)} ct-type=${r.contentType}`).join('\n'))
console.log(`\nverify-guide-ciclo7: ${findings.length} achado(s)`)
process.exit(findings.length ? 1 : 0)
