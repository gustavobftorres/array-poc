/**
 * VALIDATE ciclo 7 — X-006: o contador "N/6 passos com evento real" nunca pode
 * afirmar mais do que aconteceu.
 *
 * Seis cenários, cada um em contexto de browser NOVO (localStorage limpo):
 *  1. sessão limpa
 *  2. depois de "Semear usuário demo"
 *  3. depois de enrollment manual (POST /api/array/user pela tela)
 *  4. depois de KBA real respondida na tela
 *  5. depois de emitir userToken pelo browser (botão "Renovar userToken")
 *  6. com um componente REALMENTE montado — o CDN da Array é bloqueado neste
 *     ambiente, então o script serve um stub local de array-web-component.js e
 *     do bundle e reescreve o CDN via rota interceptada; assim o passo 4 é
 *     exercitado de verdade em vez de ficar como "não testável".
 * Também confere a persistência: reload não pode apagar nem inventar passos, e
 * "componente montado" não pode ficar preso em verdadeiro depois de um reset.
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const SHOTS = 'docs/screenshots'
const findings = []
const add = (s) => (findings.push(s), console.log('ACHADO: ' + s))

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })

async function readGuide(page) {
  await page.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })
  const counter = await page.locator('.page-head .badge', { hasText: /passos com evento real/ }).first().innerText()
  const cards = page.locator('.steps > .card')
  const n = await cards.count()
  const steps = []
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i)
    const badge = await card.locator('h3 .badge').last().innerText()
    const stateBox = await card.locator('.step-state').innerText()
    steps.push({ n: i + 1, done: /feito nesta sessão/.test(badge), state: stateBox.replace(/\s+/g, ' ').trim() })
  }
  return { counter, steps, done: steps.filter((s) => s.done).map((s) => s.n) }
}

async function scenario(name, fn, expectDone) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await fn(page, ctx)
  const g = await readGuide(page)
  console.log(`\n--- ${name}\n  contador: ${g.counter}\n  feitos: [${g.done.join(', ')}]`)
  for (const s of g.steps) console.log(`   ${s.n} ${s.done ? 'FEITO ' : 'pend. '} ${s.state.slice(0, 150)}`)
  const got = g.done.join(',')
  if (expectDone !== undefined && got !== expectDone.join(','))
    add(`${name}: passos feitos = [${got}], esperado [${expectDone.join(',')}]`)
  const m = /^(\d+)\/(\d+)/.exec(g.counter)
  if (!m || Number(m[1]) !== g.done.length) add(`${name}: contador "${g.counter}" não bate com ${g.done.length} passos marcados`)
  if (errors.length) add(`${name}: ${errors.length} erro(s) de console: ${errors[0]}`)
  await page.screenshot({ path: path.join(SHOTS, `qa7-state-${name.replace(/[^a-z0-9]/gi, '-')}.png`), fullPage: false })
  return { page, ctx, guide: g }
}

// 1. sessão limpa
{
  const r = await scenario('1-sessao-limpa', async () => {}, [])
  await r.ctx.close()
}

// 2. semeada
{
  const r = await scenario(
    '2-semeada',
    async (page) => {
      await page.goto(WEB, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /Semear usuário demo/i }).click()
      await page.waitForTimeout(1200)
    },
    [1, 5],
  )
  // reload não pode mudar nada
  const before = r.guide.done.join(',')
  await r.page.reload({ waitUntil: 'networkidle' })
  const after = (await readGuide(r.page)).done.join(',')
  if (before !== after) add(`2-semeada: reload mudou os passos ([${before}] -> [${after}])`)
  await r.ctx.close()
}

// 3. enrollment manual
{
  const r = await scenario(
    '3-enrollment-manual',
    async (page) => {
      await page.goto(`${WEB}/enrollment`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Preencher identidade de teste' }).click()
      await page.getByRole('button', { name: 'Criar consumidor' }).click()
      await page.waitForTimeout(1500)
    },
    [1],
  )
  await r.ctx.close()
}

// 4. KBA real
{
  const r = await scenario(
    '4-kba-real',
    async (page) => {
      await page.goto(`${WEB}/enrollment`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Preencher identidade de teste' }).click()
      await page.getByRole('button', { name: 'Criar consumidor' }).click()
      await page.waitForTimeout(1500)
      await page.goto(`${WEB}/kba`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Buscar perguntas' }).click()
      await page.waitForTimeout(1200)
      // marca a primeira alternativa de cada pergunta e envia
      const radios = page.locator('input[type=radio]')
      const count = await radios.count()
      const seenNames = new Set()
      for (let i = 0; i < count; i++) {
        const nm = await radios.nth(i).getAttribute('name')
        if (seenNames.has(nm)) continue
        seenNames.add(nm)
        await radios.nth(i).check({ force: true }).catch(() => {})
      }
      const send = page.getByRole('button', { name: 'Enviar respostas' })
      if (await send.isEnabled().catch(() => false)) await send.click()
      else add('4-kba-real: botão "Enviar respostas" não habilitou (respostas não marcadas)')
      await page.waitForTimeout(1500)
    },
    [1, 2],
  )
  await r.ctx.close()
}

// 5. userToken emitido pelo browser
{
  const r = await scenario(
    '5-usertoken-pelo-browser',
    async (page) => {
      await page.goto(WEB, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /Semear usuário demo/i }).click()
      await page.waitForTimeout(1200)
      await page.goto(`${WEB}/playground`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /Renovar userToken/i }).click()
      await page.waitForTimeout(1200)
    },
    [1, 3, 5],
  )
  await r.ctx.close()
}

// 6. componente realmente montado (CDN da Array stubado por interceptação)
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const stub = async (pg) => {
    await pg.route('**/*array-web-component.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.__rt=1' }))
    await pg.route('**/cms/array-*.js*', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `customElements.define(document.currentScript?.src.match(/cms\\/(array-[a-z-]+)\\.js/)[1], class extends HTMLElement{connectedCallback(){this.textContent='stub local'}})`,
      }),
    )
  }
  await stub(page)
  await page.goto(`${WEB}/playground`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Montar componente/i }).click()
  await page.waitForTimeout(2500)
  const host = await page.locator('.component-host').first().innerHTML()
  const mounted = /<array-[a-z-]+/.test(host)
  const g = await readGuide(page)
  console.log(`\n--- 6-componente-montado\n  montou de verdade: ${mounted}\n  contador: ${g.counter} · feitos: [${g.done.join(', ')}]`)
  for (const s2 of g.steps) console.log(`   ${s2.n} ${s2.done ? 'FEITO ' : 'pend. '} ${s2.state.slice(0, 140)}`)
  await page.screenshot({ path: path.join(SHOTS, 'qa7-state-6-componente-montado.png') })
  if (!mounted) add('6-componente-montado: o stub não montou o componente (cenário não exercitado)')
  else if (!g.done.includes(4)) add('6-componente-montado: componente montado e o passo 4 continua pendente')
  else if (g.done.join(',') !== '4') add(`6-componente-montado: passos feitos [${g.done.join(',')}], esperado só [4]`)

  // 6b. o passo 4 fica preso em "feito" quando o CDN volta a estar bloqueado?
  const page2 = await ctx.newPage() // mesmo localStorage, SEM stub do CDN
  const g2 = await (async () => {
    await page2.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })
    return readGuide(page2)
  })()
  console.log(`  6b (sem stub, mesma sessão): feitos [${g2.done.join(', ')}] — ${g2.steps[3].state.slice(0, 160)}`)
  if (g2.done.includes(4)) add('6b: "componente montado" continua FEITO numa aba onde o CDN está bloqueado e nada montou (evento fica preso em verdadeiro)')
  await ctx.close()
}

await browser.close()
console.log(`\nstep-state-ciclo7: ${findings.length} achado(s)`)
process.exit(findings.length ? 1 : 0)
