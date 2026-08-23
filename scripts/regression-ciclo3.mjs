/**
 * VALIDATE ciclo 3 — checagens de navegador para os IDs V-005..V-020.
 * Uso: PW_CHROMIUM=... node scripts/regression-ciclo3.mjs [baseUrl]
 */
import { chromium } from '@playwright/test'
const BASE = process.argv[2] || 'http://localhost:5173'
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const console_ = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console_.push(`[${m.type()}] ${m.text().slice(0,160)}`) })
page.on('pageerror', (e) => console_.push(`[pageerror] ${e.message}`))
const reqs = []
page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`) })
const fails = []
page.on('response', (r) => { if (r.status() >= 400) fails.push(`${r.status()} ${r.url()}`) })

const go = async (p) => { await page.goto(BASE + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(900) }

// seed
await go('/')
await page.getByRole('button', { name: /Semear usuário demo|Semear/i }).first().click().catch(() => {})
await page.waitForTimeout(1500)

// V-008: chamadas por visita ao Dashboard
reqs.length = 0
await go('/enrollment'); await go('/')
console.log('V-008 chamadas na visita ao Dashboard:', JSON.stringify(reqs.filter((r) => !r.includes('seed'))))

// V-007/V-019: auto-load das telas
for (const [p, expect] of [['/kba', /pergunta|Q1|autentic/i], ['/report', /712|score/i], ['/alerts', /alerta/i]]) {
  reqs.length = 0
  await go(p)
  const body = await page.locator('body').innerText()
  const filled = expect.test(body)
  console.log(`V-007 ${p}: auto-carregou=${filled} | chamadas=${JSON.stringify(reqs)} | chars=${body.length}`)
}

// V-011: tiles do summary
await go('/report')
const tiles = await page.locator('.tile, .kpi, .summary-tile').allInnerTexts().catch(() => [])
console.log('V-011 tiles:', JSON.stringify(tiles).slice(0, 800))
const bodyRep = await page.locator('body').innerText()
console.log('V-006 trechos:', bodyRep.match(/Utiliza[^\n]*/g)?.slice(0,4), '|', bodyRep.match(/[Cc]obran[^\n]*/g)?.slice(0,3), '|', bodyRep.match(/consulta[^\n]*/g)?.slice(0,3))

// V-015: base exibida em modo mock
for (const p of ['/kba', '/report', '/enrollment']) {
  await go(p)
  const t = await page.locator('body').innerText()
  const m = t.match(/[^\n]*sandbox\.array\.io[^\n]*/g)
  console.log(`V-015 ${p}:`, JSON.stringify(m?.slice(0,2)))
}

// V-016: hint de clique no Inspector
await go('/inspector')
const insp = await page.locator('body').innerText()
console.log('V-016 hint de clique:', /clique|clicar|payload/i.test(insp), '|', JSON.stringify(insp.match(/[^\n]*clique[^\n]*/gi)?.slice(0,2)))

// V-017/V-020: catalogo
await go('/playground')
const tabs = await page.locator('.tabs button').allInnerTexts()
console.log('V-017 catálogo:', tabs.length, JSON.stringify(tabs))
await page.getByRole('button', { name: /^Credit Score(?!\s)/ }).first().click()
await page.waitForTimeout(400)
const attrs = await page.locator('.attr-row label').allInnerTexts()
console.log('V-020 atributos de array-credit-score:', JSON.stringify(attrs))
// V-018: largura do input de atributo
const box = await page.locator('.attr-row input').first().boundingBox()
const val = await page.locator('.attr-row input').first().inputValue()
console.log('V-018 input attr:', box?.width, 'px para valor de', val.length, 'chars')

// V-009: overflow mobile nas 7 telas
const m = await ctx.newPage()
await m.setViewportSize({ width: 390, height: 844 })
for (const p of ['/', '/enrollment', '/kba', '/report', '/alerts', '/playground', '/inspector']) {
  await m.goto(BASE + p, { waitUntil: 'networkidle' }); await m.waitForTimeout(700)
  const o = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  console.log(`V-009 ${p}: scrollWidth=${o.sw} clientWidth=${o.cw} ${o.sw > o.cw ? 'OVERFLOW' : 'ok'}`)
}

console.log('V-012 console (erros/warnings):', console_.length, JSON.stringify([...new Set(console_)].slice(0, 8)))
console.log('requests >=400:', JSON.stringify([...new Set(fails)].slice(0, 8)))
await browser.close()
