/**
 * VALIDATE ciclo 7 — passeio pelas 9 telas (8 rotas + a rota inexistente).
 * Console, respostas >=400, tema, mobile 390px, reload no meio do fluxo e a
 * coerência da contagem de usuários na tabela do Dashboard (o payload agora vem
 * paginado pela API — `limit` default 50 — e a UI ainda conta o que recebeu).
 */
import { chromium } from '@playwright/test'
import path from 'node:path'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const API = process.env.API ?? 'http://localhost:8787'
const SHOTS = 'docs/screenshots'
const findings = []
const add = (s) => (findings.push(s), console.log('ACHADO: ' + s))

const ROUTES = [
  ['dashboard', '/'],
  ['enrollment', '/enrollment'],
  ['kba', '/kba'],
  ['report', '/report'],
  ['alerts', '/alerts'],
  ['integracao', '/integracao'],
  ['playground', '/playground'],
  ['inspector', '/inspector'],
  ['rota-inexistente', '/nao-existe'],
]

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })

for (const [width, tagName] of [[1280, 'desktop'], [390, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  const console_ = []
  const bad = []
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console_.push(`${m.type()}: ${m.text()}`))
  page.on('response', (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`))
  // sessão real antes de passear
  await page.goto(WEB, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Semear usuário demo/i }).click()
  await page.waitForTimeout(1200)
  for (const [name, route] of ROUTES) {
    await page.goto(WEB + route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 2) add(`${tagName}/${name}: overflow horizontal de ${overflow}px`)
    await page.screenshot({ path: path.join(SHOTS, `qa7-${tagName}-${name}.png`), fullPage: tagName === 'desktop' })
  }
  const cdnOnly = bad.filter((b) => !/embed(\.sandbox)?\.array\.io/.test(b))
  if (cdnOnly.length) add(`${tagName}: respostas >=400 fora do CDN: ${cdnOnly.slice(0, 4).join(' | ')}`)
  const noise = console_.filter((c) => !/embed(\.sandbox)?\.array\.io|Failed to load resource/.test(c))
  if (noise.length) add(`${tagName}: ${noise.length} mensagem(ns) de console: ${noise.slice(0, 3).join(' | ')}`)
  await ctx.close()
}

// tema + reload no meio do fluxo + contagem de usuários
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(WEB, { waitUntil: 'networkidle' })
  const themeBtn = page.getByRole('button', { name: /Claro|Escuro/ }).first()
  if (await themeBtn.isVisible().catch(() => false)) {
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? getComputedStyle(document.body).backgroundColor)
    await themeBtn.click()
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? getComputedStyle(document.body).backgroundColor)
    if (before === after) add('tema: clicar no botão não mudou nada')
    await page.screenshot({ path: path.join(SHOTS, 'qa7-tema.png') })
  } else add('tema: não achei o botão de tema')

  // contagem de usuários: API paginada x texto da tela
  const apiTotal = await fetch(`${API}/api/array/users`).then((r) => r.json())
  await page.goto(WEB, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const verTodos = await page.locator('button', { hasText: /Ver todos \(/ }).first().innerText().catch(() => '')
  const linha = await page.locator('text=/Mostrando os \\d+ mais recentes de \\d+/').first().innerText().catch(() => '')
  console.log(`API: total=${apiTotal.total} payload=${apiTotal.users.length} limit=${apiTotal.limit}`)
  console.log(`UI: "${verTodos}" · "${linha}"`)
  const shown = Number((/\((\d+)\)/.exec(verTodos) ?? [])[1] ?? NaN)
  if (Number.isFinite(shown) && apiTotal.total > apiTotal.users.length && shown !== apiTotal.total)
    add(`Dashboard: a tela anuncia ${shown} usuários e o banco tem ${apiTotal.total} (a UI conta o payload paginado e ignora o campo total)`)

  // reload no meio do fluxo (KBA -> F5 -> ainda de pé?)
  await page.goto(`${WEB}/kba`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Buscar perguntas' }).click().catch(() => {})
  await page.waitForTimeout(1200)
  const qBefore = await page.locator('fieldset').count()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const qAfter = await page.locator('fieldset').count()
  console.log(`KBA fieldsets antes=${qBefore} depois do F5=${qAfter}`)
  if (qBefore > 0 && qAfter === 0) console.log('  (perguntas não sobrevivem ao F5 — por design: authToken é de sessão)')
  await page.goto(`${WEB}/report`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const scoreBefore = await page.locator('.stat .value').first().innerText().catch(() => '')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const scoreAfter = await page.locator('.stat .value').first().innerText().catch(() => '')
  if (scoreBefore && scoreBefore !== scoreAfter) add(`report: score mudou depois do F5 (${scoreBefore} -> ${scoreAfter})`)
  await page.screenshot({ path: path.join(SHOTS, 'qa7-report-pos-reload.png'), fullPage: true })
  await ctx.close()
}

await browser.close()
console.log(`\nwalkthrough-ciclo7: ${findings.length} achado(s)`)
process.exit(findings.length ? 1 : 0)
