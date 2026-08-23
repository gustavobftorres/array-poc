/**
 * VALIDATE ciclo 5 — passeio pelas 8 telas: console limpo, requests >=400,
 * tema alternado, reload no meio do fluxo, mobile 390px e screenshots
 * `docs/screenshots/qa5-*.png`.
 *
 * Uso: PW_CHROMIUM=… node scripts/walkthrough-ciclo5.mjs [baseUrl]
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5173'
const SHOTS = 'docs/screenshots'
mkdirSync(SHOTS, { recursive: true })
const ROUTES = [
  ['/', 'dashboard'],
  ['/enrollment', 'enrollment'],
  ['/kba', 'kba'],
  ['/report', 'report'],
  ['/alerts', 'alerts'],
  ['/integracao', 'integracao'],
  ['/playground', 'playground'],
  ['/inspector', 'inspector'],
]

const findings = []
const note = (sev, w) => { findings.push(`${sev} ${w}`); console.log(`${sev} ${w}`) }
const ok = (w) => console.log(`ok  ${w}`)

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
const ctx = await browser.newContext()
const page = await ctx.newPage()
const msgs = []
const bad = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => msgs.push(`[pageerror] ${e.message}`))
page.on('response', (r) => { if (r.status() >= 400 && !/embed(\.sandbox)?\.array\.io/.test(r.url())) bad.push(`${r.status()} ${r.url()}`) })

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Semear usuário demo/i }).click()
await page.waitForTimeout(1500)

for (const [route, slug] of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const empty = await page.locator('main').innerText()
  if (empty.trim().length < 60) note('P1', `${route}: tela praticamente vazia`)
  await page.screenshot({ path: `${SHOTS}/qa5-${slug}.png`, fullPage: true })
  ok(`${route} renderizou (${empty.length} chars)`)
}

// tema
await page.goto(`${BASE}/report`, { waitUntil: 'networkidle' })
const themeBtn = page.getByRole('button', { name: /Claro|Escuro/ }).first()
const before = await page.evaluate(() => document.documentElement.dataset.theme || getComputedStyle(document.body).backgroundColor)
await themeBtn.click()
await page.waitForTimeout(400)
const after = await page.evaluate(() => document.documentElement.dataset.theme || getComputedStyle(document.body).backgroundColor)
if (before === after) note('P2', `tema não mudou (${before})`)
else ok(`tema alternou (${before} -> ${after})`)
await page.screenshot({ path: `${SHOTS}/qa5-tema.png`, fullPage: true })
await themeBtn.click()

// reload no meio do fluxo: KBA com perguntas na tela
await page.goto(`${BASE}/kba`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const qBefore = await page.locator('main').innerText()
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)
const qAfter = await page.locator('main').innerText()
if (!/pergunta|Pergunta|question/i.test(qAfter)) note('P2', 'KBA perdeu as perguntas depois do reload')
else ok('KBA continua com perguntas depois do reload')
void qBefore
await page.goto(`${BASE}/report`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const rep = await page.locator('main').innerText()
if (!/71\d|Score|Tradelines/.test(rep)) note('P1', 'relatório não voltou depois do reload')
else ok('relatório voltou depois do reload')
await page.screenshot({ path: `${SHOTS}/qa5-reload-report.png`, fullPage: true })

// mobile
const m = await ctx.newPage()
await m.setViewportSize({ width: 390, height: 844 })
for (const [route, slug] of ROUTES) {
  await m.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  await m.waitForTimeout(500)
  const o = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  if (o.sw > o.cw) note('P2', `${route}: overflow horizontal no mobile (${o.sw} > ${o.cw})`)
  if (['/', '/report', '/integracao', '/playground'].includes(route)) {
    await m.screenshot({ path: `${SHOTS}/qa5-m-${slug}.png`, fullPage: true })
  }
}
ok('mobile 390px: 8 telas medidas')

if (msgs.length) note('P2', `console: ${msgs.length} mensagem(ns) -> ${msgs.slice(0, 5).join(' | ')}`)
else ok('console limpo nas 8 telas + tema + reloads')
if (bad.length) note('P2', `respostas >=400 (fora do CDN): ${bad.slice(0, 5).join(' | ')}`)
else ok('nenhuma resposta >=400 fora do CDN bloqueado')

await browser.close()
console.log(`\n===== walkthrough: ${findings.length} achado(s) =====`)
findings.forEach((f) => console.log(f))
