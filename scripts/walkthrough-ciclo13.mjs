/**
 * VALIDATE ciclo 14 — passeio próprio pelas 9 telas (a de Webhooks é nova).
 *
 * Independente do `walkthrough-ciclo7.mjs`: aqui o foco é o que o ciclo 13
 * introduziu — a tela Webhooks, o seletor de simulação do relatório
 * (202→200 e 202→204) e os nomes novos de variável na UI — além do básico de
 * regressão (console limpo, mobile 390px, tema, overflow).
 *
 * Uso: PW_CHROMIUM=… node scripts/walkthrough-ciclo13.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = path.join(root, 'docs/screenshots')
fs.mkdirSync(shots, { recursive: true })
const BASE = process.env.WEB_BASE ?? 'http://localhost:5173'
const findings = []
const add = (m) => {
  findings.push(m)
  console.log(`  ACHADO: ${m}`)
}

const SCREENS = [
  ['/', 'dashboard'],
  ['/enrollment', 'enrollment'],
  ['/kba', 'kba'],
  ['/report', 'report'],
  ['/alerts', 'alerts'],
  ['/integracao', 'integracao'],
  ['/playground', 'playground'],
  ['/webhooks', 'webhooks'],
  ['/inspector', 'inspector'],
]

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })

async function visit(page, url, name, tag) {
  const errors = []
  const onMsg = (m) => {
    if (m.type() === 'error') errors.push(m.text())
  }
  page.on('console', onMsg)
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await page.goto(BASE + url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const body = await page.locator('body').innerText()
  if (/SMARTY_AUTH/i.test(body)) add(`${name} (${tag}): a UI ainda fala SMARTY_AUTH_*`)
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientW = await page.evaluate(() => document.documentElement.clientWidth)
  if (scrollW > clientW + 2) add(`${name} (${tag}): overflow horizontal (${scrollW} > ${clientW})`)
  const filtered = errors.filter((e) => !/embed\.(sandbox\.)?array\.io|Failed to load resource|ERR_/i.test(e))
  if (filtered.length) add(`${name} (${tag}): console com erro -> ${filtered.slice(0, 2).join(' | ')}`)
  await page.screenshot({ path: path.join(shots, `qa13-${name}-${tag}.png`), fullPage: false })
  page.off('console', onMsg)
  return body
}

// --- 1. desktop + mobile por tela -----------------------------------------
for (const [vp, tag] of [
  [{ width: 1280, height: 900 }, 'desktop'],
  [{ width: 390, height: 844 }, 'mobile390'],
]) {
  const ctx = await browser.newContext({ viewport: vp })
  const page = await ctx.newPage()
  // sessão semeada, senão KBA/Report/Alerts ficam vazias
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const seed = page.getByRole('button', { name: /Semear/i })
  if (await seed.count()) {
    await seed.first().click()
    await page.waitForTimeout(1500)
  }
  for (const [url, name] of SCREENS) {
    const body = await visit(page, url, name, tag)
    if (name === 'webhooks') {
      for (const must of ['ARRAY_WEBHOOK_TOKEN', 'Customer Success', 'Simular']) {
        if (!body.includes(must)) add(`tela Webhooks (${tag}): não menciona "${must}"`)
      }
    }
    if (name === 'dashboard' && !/ARRAY_SERVER_TOKEN/.test(body)) {
      add(`dashboard (${tag}): não mostra o nome novo ARRAY_SERVER_TOKEN`)
    }
  }
  await ctx.close()
}

// --- 2. tema ---------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? getComputedStyle(document.body).backgroundColor)
  const btn = page.getByRole('button', { name: /Escuro|Claro/ })
  if (!(await btn.count())) add('tema: botão de tema não encontrado')
  else {
    await btn.first().click()
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? getComputedStyle(document.body).backgroundColor)
    if (before === after) add(`tema: alternar não mudou nada (${before})`)
    else console.log(`  tema: ${before} -> ${after}`)
  }
  await ctx.close()
}

// --- 3. o seletor de simulação do relatório (202→200 e 202→204) -----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const seed = page.getByRole('button', { name: /Semear/i })
  if (await seed.count()) {
    await seed.first().click()
    await page.waitForTimeout(1500)
  }
  for (const [value, expectRe, label] of [
    ['pending-then-ready', /score|Score/, '202,202→200 tem de terminar com relatório'],
    ['pending-then-failure', /falha|204|permanente/i, '202,202→204 tem de dizer falha permanente'],
  ]) {
    await page.goto(BASE + '/report', { waitUntil: 'networkidle' })
    const sel = page.locator('#report-simulate')
    if (!(await sel.count())) {
      add('tela Credit Report: seletor #report-simulate não existe')
      break
    }
    await sel.selectOption(value)
    const order = page.getByRole('button', { name: /Pedir e buscar|Pedir novo/i })
    if (!(await order.count())) {
      add('tela Credit Report: botão de pedir relatório não encontrado')
      break
    }
    const t0 = Date.now()
    await order.first().click()
    await page.waitForTimeout(6000)
    const body = await page.locator('body').innerText()
    const ok = expectRe.test(body)
    console.log(`  simulate=${value}: ${ok ? 'ok' : 'FALHOU'} (${Date.now() - t0}ms)`)
    if (!ok) add(`Credit Report simulate=${value}: ${label} — tela não mostrou o esperado`)
    await page.screenshot({ path: path.join(shots, `qa13-report-${value}.png`), fullPage: false })
  }
  await ctx.close()
}

await browser.close()
console.log(`\nwalkthrough-ciclo13: ${findings.length} achado(s)`)
for (const f of findings) console.log(` - ${f}`)
