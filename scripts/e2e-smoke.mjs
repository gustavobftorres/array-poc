/**
 * Smoke E2E de navegador (Chromium headless) para a POC Array.
 * Uso: node scripts/e2e-smoke.mjs [baseUrl]
 * Percorre as 7 telas, roda o fluxo completo, captura screenshots em docs/screenshots/
 * e reporta erros de console, requests falhando e textos suspeitos (undefined/NaN/[object Object]).
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const findings = []
const note = (sev, what) => { findings.push(`${sev} ${what}`); console.log(`${sev} ${what}`) }

const BAD = ['undefined', 'NaN', '[object Object]', 'Infinity']

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  const netFails = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text().slice(0, 200)}`) })
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) => netFails.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`))
  page.on('response', (r) => { if (r.status() >= 400) netFails.push(`${r.status()} ${r.request().method()} ${r.url()}`) })

  const shot = async (name) => { await page.screenshot({ path: OUT + name + '.png', fullPage: true }) }

  const check = async (label, name) => {
    await page.waitForTimeout(900)
    const body = await page.locator('body').innerText()
    if (body.trim().length < 80) note('P0', `${label}: tela praticamente vazia (${body.trim().length} chars)`)
    for (const b of BAD) if (new RegExp(`(^|\\s|:)${b.replace(/[[\]]/g,'\\$&')}(\\s|$|<)`).test(body)) note('P1', `${label}: texto suspeito "${b}" visível`)
    const spin = await page.getByText(/carregando|loading/i).count()
    if (spin > 0) note('P2', `${label}: ainda mostra "carregando" após 900ms (${spin}x)`)
    await shot(name)
  }

  const go = async (path, label, name) => {
    consoleErrors.length = 0; netFails.length = 0
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await check(label, name)
    if (consoleErrors.length) note('P2', `${label}: console -> ${consoleErrors.slice(0,4).join(' | ')}`)
    if (netFails.length) note('P1', `${label}: requests falhando -> ${netFails.slice(0,4).join(' | ')}`)
  }

  // 1. Dashboard
  await go('/', 'Dashboard', '01-dashboard')

  // 2. Enrollment: preencher e submeter
  await page.goto(BASE + '/enrollment', { waitUntil: 'networkidle' })
  await shot('02a-enrollment-antes')
  const labels = await page.locator('label').allInnerTexts()
  console.log('LABELS enrollment:', JSON.stringify(labels))
  const inputs = page.locator('form input, .card input')
  console.log('inputs:', await inputs.count())
  // usa o botão de preenchimento demo se existir
  const demoBtn = page.getByRole('button', { name: /Preencher identidade/i })
  if (await demoBtn.count()) { await demoBtn.first().click(); note('OK', 'Enrollment: botão de preencher demo encontrado') }
  else note('P2', 'Enrollment: sem botão de preenchimento demo')
  const submit = page.getByRole('button', { name: 'Criar consumidor' }).first()
  await submit.click()
  await page.waitForTimeout(2500)
  await check('Enrollment pós-submit', '02b-enrollment-depois')
  const ck = await page.locator('body').innerText()
  if (!/clientKey/i.test(ck)) note('P1', 'Enrollment: resposta não mostra clientKey após submeter')

  // 3. KBA
  await page.goto(BASE + '/kba', { waitUntil: 'networkidle' })
  const ask = page.getByRole('button', { name: 'Buscar perguntas' })
  if (await ask.count()) await ask.click()
  await page.waitForTimeout(2500)
  await shot('03a-kba-perguntas')
  const radios = page.locator('input[type=radio]')
  const rc = await radios.count()
  console.log('radios KBA:', rc)
  if (rc === 0) note('P1', 'KBA: nenhuma opção de resposta renderizada')
  // marca a primeira opção de cada pergunta
  const groups = new Set(await radios.evaluateAll((els) => els.map((e) => e.name)))
  for (const g of groups) await page.locator(`input[type=radio][name="${g}"]`).first().check()
  const send = page.getByRole('button', { name: 'Enviar respostas' })
  if (await send.count()) await send.click()
  await page.waitForTimeout(2500)
  await check('KBA pós-resposta', '03b-kba-resultado')
  if (!/userToken/i.test(await page.locator('body').innerText())) note('P1', 'KBA: não exibe userToken depois de responder')

  // 4. Credit Report
  await page.goto(BASE + '/report', { waitUntil: 'networkidle' })
  const order = page.getByRole('button', { name: 'Pedir e buscar' })
  if (await order.count()) await order.click()
  await page.waitForTimeout(2000)
  await check('Credit Report', '04-report')
  const rep = await page.locator('body').innerText()
  if (!/712|\b[3-8]\d{2}\b/.test(rep)) note('P1', 'Credit Report: nenhum score numérico visível')
  if (!/tradeline|conta|creditor|CAPITAL|CHASE/i.test(rep)) note('P1', 'Credit Report: nenhuma tradeline visível')

  // 5. Alerts
  await go('/alerts', 'Alerts', '05-alerts')

  // 6. Inspector
  await page.goto(BASE + '/inspector', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const insp = await page.locator('body').innerText()
  await shot('06-inspector')
  for (const p of ['/api/array/user', '/api/array/authenticate', '/api/array/report']) {
    if (!insp.includes(p)) note('P1', `Inspector: chamada ${p} não aparece no log`)
  }
  if (/erro|error|500/i.test(insp)) note('P0', 'Inspector: tela mostra erro -> ' + insp.slice(0, 300).replace(/\n/g, ' '))

  // 6b. Guia de Integração (tela nova do ciclo 5)
  await go('/integracao', 'Guia de Integração', '16-integracao')
  {
    const t = await page.locator('body').innerText()
    // O guia vai do consumidor ao relatório (6 passos desde o ciclo 6 / X-003).
    for (const must of ['/user/v2', '/authenticate/v2', '/authenticate/v2/usertoken', '/report/v2', 'appKey', 'userToken', 'SERVIDOR', 'BROWSER']) {
      if (!t.includes(must)) note('P1', `Integração: a tela não menciona ${must}`)
    }
    const steps = await page.locator('.step').count()
    if (steps !== 6) note('P1', `Integração: esperava 6 passos, achei ${steps}`)
    const svg = await page.locator('.flow-diagram svg').count()
    if (!svg) note('P1', 'Integração: diagrama do fluxo ausente')
    const done = await page.locator('.step-state.ok').count()
    console.log(`Integração: passos com evento real da sessão = ${done}/6`)
    // alternar curl/TypeScript no passo 1
    const tsBtn = page.getByRole('button', { name: 'TypeScript' }).first()
    if (await tsBtn.count()) {
      await tsBtn.click(); await page.waitForTimeout(300)
      const code = await page.locator('.step .snippet pre').first().innerText()
      if (!/ARRAY_SERVER_TOKEN|ARRAY_CLIENT_TOKEN|client token/.test(code)) note('P1', 'Integração: exemplo TypeScript não mostra o client token no servidor')
    } else note('P1', 'Integração: sem alternância curl/TypeScript')
    await shot('16b-integracao-typescript')
  }

  // 7. Playground
  consoleErrors.length = 0; netFails.length = 0
  await page.goto(BASE + '/playground', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await shot('07a-playground')
  const tabs = page.locator('.tabs button')
  console.log('componentes no catálogo:', await tabs.count())
  await tabs.nth(1).click(); await page.waitForTimeout(400)
  await shot('07b-playground-outro-componente')
  const mount = page.getByRole('button', { name: /montar/i }).first()
  if (await mount.count()) { await mount.click(); await page.waitForTimeout(9500) }
  await shot('07c-playground-cdn-bloqueado')
  const pgText = await page.locator('body').innerText()
  if (!/CDN inacess|não pôde ser carregado|bloquead/i.test(pgText)) note('P1', 'Playground: sem placeholder claro de CDN bloqueado')
  const snippet = await page.locator('pre.json').first().innerText()
  console.log('--- SNIPPET ---\n' + snippet + '\n---------------')
  if (/\/>\s*$/.test(snippet)) note('P1', 'Playground: snippet usa custom element auto-fechado (<tag />) — inválido em HTML puro')
  if (/MOCK-APP-KEY/.test(snippet)) note('P1', 'Playground: snippet traz appKey fake de 35 chars (loader da Array exige 36)')

  // tema
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const themeBtn = page.getByRole('button', { name: /claro|escuro/i }).first()
  const before = await page.evaluate(() => document.documentElement.dataset.theme)
  await themeBtn.click(); await page.waitForTimeout(400)
  const after = await page.evaluate(() => document.documentElement.dataset.theme)
  if (before === after) note('P1', 'Toggle de tema não muda data-theme')
  await shot('08-tema-alternado')

  // reload no meio do fluxo: sessão persiste?
  await page.goto(BASE + '/report', { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const afterReload = await page.locator('body').innerText()
  const ls = await page.evaluate(() => localStorage.getItem('array-poc.session'))
  console.log('sessão em localStorage:', ls)
  if (!ls || !/clientKey":"[^"]+/.test(ls)) note('P1', 'Sessão não persiste no localStorage após reload')
  if (/712/.test(afterReload)) note('OK', 'Report continua visível após reload')
  else note('P2', 'Report não é re-buscado automaticamente após reload')
  await shot('09-reload-report')

  // mobile 390x844
  const m = await ctx.newPage()
  await m.setViewportSize({ width: 390, height: 844 })
  for (const [path, name] of [['/', 'm-dashboard'], ['/report', 'm-report'], ['/playground', 'm-playground'], ['/inspector', 'm-inspector'], ['/integracao', 'm-integracao']]) {
    await m.goto(BASE + path, { waitUntil: 'networkidle' })
    await m.waitForTimeout(900)
    const ov = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
    if (ov.sw > ov.cw + 2) note('P1', `Mobile 390px ${path}: overflow horizontal (scrollWidth ${ov.sw} > ${ov.cw})`)
    await m.screenshot({ path: OUT + '10-' + name + '.png', fullPage: true })
  }

  // acessibilidade básica: inputs sem label associado
  await page.goto(BASE + '/enrollment', { waitUntil: 'networkidle' })
  const unlabeled = await page.evaluate(() =>
    [...document.querySelectorAll('input,select,textarea')].filter((el) => {
      if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false
      if (el.closest('label')) return false
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false
      return true
    }).map((el) => el.name || el.placeholder || el.type),
  )
  if (unlabeled.length) note('P1', `Enrollment: ${unlabeled.length} campos sem label associado -> ${unlabeled.join(', ')}`)
  // navegação por teclado
  const tabbed = []
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); tabbed.push(await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('name') || document.activeElement?.textContent || '').slice(0, 20))) }
  console.log('ordem de foco:', JSON.stringify(tabbed))

  await browser.close()
  console.log('\n===== RESUMO =====')
  findings.forEach((f) => console.log(f))
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
