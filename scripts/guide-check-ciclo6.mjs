/**
 * Ciclo 6 — prova de que os artefatos do Guia de Integração (/integracao) são
 * COLÁVEIS e corretos. O guia é o que sai da POC para o código do usuário, e no
 * ciclo 5 nenhum dos três curl funcionava (X-001) e os bodies não levavam
 * `appKey` (X-002), além de o fluxo parar antes do relatório (X-003).
 *
 * Para cada passo da tela, no browser de verdade:
 *  1. lê o snippet `curl` e o snippet `TypeScript` (o texto exibido);
 *  2. `bash -n` no curl (sintaxe de shell);
 *  3. dry-run: reescreve o host para o worker local e EXECUTA o curl, exigindo
 *     2xx e o campo esperado na resposta (prova que header e body estão certos);
 *  4. `tsc --strict` em cada snippet TypeScript, com declarações ambientes
 *     apenas para os helpers ilustrativos;
 *  5. asserções de conteúdo: `appKey` em todo body de API, nenhum comentário
 *     dentro de um `-H`, aspas duplas no header do client token, `report/v2`
 *     presente e selos verificado/inferido na tela.
 *
 * Uso: PW_CHROMIUM=… node scripts/guide-check-ciclo6.mjs [webBase] [workerBase]
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WEB = process.argv[2] || 'http://localhost:5173'
const WORKER = process.argv[3] || 'http://localhost:8787'
const tmp = mkdtempSync(join(tmpdir(), 'guide-'))

const findings = []
const note = (sev, what) => { findings.push(`${sev} ${what}`); console.log(`${sev} ${what}`) }
const ok = (what) => console.log(`ok  ${what}`)

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
const page = await (await browser.newContext()).newPage()
await page.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })

const steps = await page.locator('.step').count()
if (steps !== 6) note('P1', `esperava 6 passos no guia (X-003), achei ${steps}`)
else ok('6 passos: consumidor, KBA, userToken, componente, pedir e buscar relatório')

const snippets = []
for (let i = 0; i < steps; i++) {
  const card = page.locator('.step').nth(i)
  const title = (await card.locator('.card-title, h3, header').first().innerText()).replace(/\s+/g, ' ').trim()
  const buttons = card.locator('button')
  // primeiro botão = curl/HTML, segundo = TypeScript
  await buttons.nth(0).click()
  await page.waitForTimeout(60)
  const curl = await card.locator('pre').first().innerText()
  await buttons.nth(1).click()
  await page.waitForTimeout(60)
  const ts = await card.locator('pre').first().innerText()
  snippets.push({ i, title, curl, ts })
}

// selos de confiança (X-009)
const bodyText = await page.locator('body').innerText()
for (const [needle, why] of [
  ['// UNVERIFIED', 'selo de inferência'],
  ['verificado', 'selo de fato verificado'],
  ['x-credmo-user-token', 'alternativa do header de user token'],
  ['webhook', 'menção aos webhooks'],
  ['expiresAt', 'nota de que expiresAt é desta POC'],
]) {
  if (!bodyText.includes(needle)) note('P2', `a tela não menciona "${needle}" (${why})`)
  else ok(`tela menciona ${needle} (${why})`)
}
if (!/PUT \/report\/v2/.test(bodyText)) note('P2', 'a tela não menciona PUT /report/v2 (renovação do displayToken)')

// ---------------------------------------------------------------------------
// 1) shell: sintaxe + execução contra o worker local
// ---------------------------------------------------------------------------
const EXPECT = {
  0: { field: 'clientKey' },
  1: { field: 'authToken' },
  2: { field: 'userToken' },
  4: { field: 'reportKey' },
  5: { field: 'score' },
}

let CLIENT_KEY = ''
let AUTH_TOKEN = ''
let REPORT_KEY = ''
let DISPLAY_TOKEN = ''

for (const s of snippets) {
  const isShell = /^#|^curl/m.test(s.curl) && !/^<!--/.test(s.curl.trim())
  if (!isShell) { ok(`passo ${s.i + 1}: snippet de HTML (não é shell)`); continue }

  // comentário dentro do valor de um header é o defeito X-001
  for (const line of s.curl.split('\n')) {
    if (/-H\s+["'][^"']*#/.test(line)) note('P1', `passo ${s.i + 1}: comentário DENTRO do valor de um header -> ${line.trim()}`)
    if (/-H\s+'x-credmo-client-token/.test(line)) note('P1', `passo ${s.i + 1}: header do client token entre aspas simples (o shell não expande)`)
  }

  // Todo corpo de chamada de API à Array leva appKey (X-002) — exceto
  // PUT /report/v2, cujo corpo verificado é { clientKey, reportKey }, e as
  // chamadas ao worker local (que injeta o appKey do ambiente).
  for (const frag of s.curl.split(/(?=curl )/).slice(1)) {
    if (!/array\.io\/api/.test(frag)) continue
    // -G = parâmetros de query (não é corpo): a leitura do relatório se
    // autentica com reportKey+displayToken na query, sem appKey.
    if (/ -G\b/.test(frag)) continue
    if (!/-d @-/.test(frag)) continue
    if (/-X PUT/.test(frag)) {
      if (!/clientKey/.test(frag) || !/reportKey/.test(frag)) {
        note('P1', `passo ${s.i + 1}: PUT /report/v2 sem clientKey/reportKey no corpo`)
      }
      continue
    }
    if (!/appKey/.test(frag)) note('P1', `passo ${s.i + 1}: body sem appKey (X-002) -> ${frag.split('\n')[0]}`)
  }

  const file = join(tmp, `step${s.i + 1}.sh`)
  writeFileSync(file, s.curl)
  try {
    sh('bash', ['-n', file])
    ok(`passo ${s.i + 1}: bash -n limpo`)
  } catch (e) {
    note('P1', `passo ${s.i + 1}: bash -n falhou -> ${String(e.stderr || e.message).slice(0, 200)}`)
    continue
  }

  // dry-run contra o worker local: mesmo header, mesmo body, host trocado
  const expect = EXPECT[s.i]
  if (!expect) continue
  const runnable = s.curl
    .replace(/https:\/\/sandbox\.array\.io\/api/g, `${WORKER}/api/array`)
    .replace(/\/api\/array\/user\/v2/g, '/api/array/user')
    .replace(/\/api\/array\/authenticate\/v2\/usertoken/g, '/api/array/usertoken')
    .replace(/\/api\/array\/authenticate\/v2/g, '/api/array/authenticate')
    .replace(/\/api\/array\/report\/v2/g, '/api/array/report')
    .replace(/sleep 3/g, 'sleep 0')
  const header = [
    'set -u',
    `export ARRAY_SERVER_TOKEN='LOCAL-DEV-TOKEN'`,
    `export ARRAY_POLL_INTERVAL='0'`,
    `export ARRAY_POLL_TIMEOUT='10'`,
    `export ARRAY_APP_KEY='MOCK0000-0000-4000-8000-MOCKAPPKEY00'`,
    `export CLIENT_KEY='${CLIENT_KEY}'`,
    `export AUTH_TOKEN='${AUTH_TOKEN}'`,
    `export REPORT_KEY='${REPORT_KEY}'`,
    `export DISPLAY_TOKEN='${DISPLAY_TOKEN}'`,
  ].join('\n')
  const runFile = join(tmp, `run${s.i + 1}.sh`)
  writeFileSync(runFile, `${header}\n${runnable}\n`)
  let out = ''
  try {
    out = sh('bash', [runFile])
  } catch (e) {
    note('P1', `passo ${s.i + 1}: curl não rodou -> ${String(e.stderr || e.message).slice(0, 300)}`)
    continue
  }
  if (!out.includes(`"${expect.field}"`)) {
    note('P1', `passo ${s.i + 1}: resposta do worker local sem "${expect.field}" -> ${out.slice(0, 300)}`)
  } else {
    ok(`passo ${s.i + 1}: curl colado no shell devolveu ${expect.field} do worker local`)
  }
  const grab = (k) => (out.match(new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`)) || [])[1] || ''
  CLIENT_KEY = grab('clientKey') || CLIENT_KEY
  AUTH_TOKEN = grab('authToken') || AUTH_TOKEN
  REPORT_KEY = grab('reportKey') || REPORT_KEY
  DISPLAY_TOKEN = grab('displayToken') || DISPLAY_TOKEN
}

// ---------------------------------------------------------------------------
// 2) TypeScript: cada snippet compila com --strict
// ---------------------------------------------------------------------------
const AMBIENT = `
declare const db: any
declare const sessao: any
declare const app: any
declare const process: { env: Record<string, string | undefined> }
declare const telemetria: any
declare const APP_KEY: string
declare const requerLogin: any
declare function arrayGet(path: string): Promise<any>
declare function arrayPost(path: string, body: unknown): Promise<any>
declare function arrayPut(path: string, body: unknown): Promise<any>
declare class KbaReprovada extends Error {}
declare class DisplayTokenExpirado extends Error {}
interface Identidade { userId: string }
`
writeFileSync(join(tmp, 'ambient.d.ts'), AMBIENT)
for (const s of snippets) {
  const f = join(tmp, `step${s.i + 1}.ts`)
  writeFileSync(f, s.ts)
  try {
    sh('npx', ['tsc', '--noEmit', '--strict', '--target', 'es2022', '--lib', 'es2022,dom', '--moduleDetection', 'force', '--module', 'esnext', '--skipLibCheck', join(tmp, 'ambient.d.ts'), f], { cwd: process.cwd() })
    ok(`passo ${s.i + 1}: snippet TypeScript compila com --strict`)
  } catch (e) {
    note('P1', `passo ${s.i + 1}: snippet TypeScript NÃO compila -> ${String(e.stdout || e.message).slice(0, 400)}`)
  }
  if (/array\.io\/api\/(user|authenticate|report)/.test(s.ts) && /JSON\.stringify/.test(s.ts) && !/appKey/.test(s.ts)) {
    note('P1', `passo ${s.i + 1}: snippet TypeScript monta body sem appKey (X-002)`)
  }
}

// ---------------------------------------------------------------------------
// 3) X-006 — o "estado da sessão" tem que vir do EVENTO, não do userToken
// ---------------------------------------------------------------------------
const counter = async () =>
  (await page.locator('.page-head .badge').filter({ hasText: /passos/ }).first().innerText()).trim()
const badges = async () =>
  page.locator('.step').evaluateAll((els) =>
    els.map((e) => e.querySelector('.card-actions .badge, .badge.ok, .badge.warn')?.textContent?.trim()),
  )

await page.evaluate(() => localStorage.clear())
await page.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })
const clean = await counter()
if (!/0\/6/.test(clean)) note('P2', `sessão limpa deveria mostrar 0/6, mostrou "${clean}"`)
else ok('sessão limpa: 0/6 passos')

await page.goto(`${WEB}/`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Semear usuário demo/i }).click()
await page.waitForTimeout(1500)
await page.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })
const seeded = await counter()
const state = await page.locator('.step .step-state').allInnerTexts()
const done = state.map((t) => !/pendente/.test(t))
// semear cria consumidor e pede relatório no servidor; NÃO responde KBA, NÃO
// chama /usertoken do browser, NÃO monta componente e NÃO busca o relatório.
// Y-001 (ciclo 9): o passo 5 saiu de "reportKey presente" para o evento
// `reportOrderedAt`, e o /api/seed pede o relatório no servidor.
const esperado = [true, false, false, false, false, false]
for (let i = 0; i < esperado.length; i++) {
  if (done[i] !== esperado[i]) {
    note('P1', `X-006: passo ${i + 1} após semear = ${done[i] ? 'feito' : 'pendente'}, esperado ${esperado[i] ? 'feito' : 'pendente'} -> ${state[i]?.slice(0, 140)}`)
  }
}
// Desde o ciclo 9 (Y-001) o passo 5 também vem do EVENTO (`reportOrderedAt`), e o
// /api/seed pede o relatório no servidor: semear acende só o passo 1.
if (!/1\/6/.test(seeded)) note('P1', `X-006/Y-001: após semear o contador deveria ser 1/6, foi "${seeded}"`)
else ok('X-006/Y-001: após semear = 1/6 (só o consumidor); KBA, usertoken, componente e relatório seguem pendentes')

await browser.close()
console.log(`\n${findings.length} achado(s)`)
if (findings.length) { findings.forEach((f) => console.log(f)); process.exit(1) }
console.log('guia: curl coláveis, bodies com appKey, fluxo até o relatório e TS compilando')
