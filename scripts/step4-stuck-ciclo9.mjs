/**
 * VALIDATE ciclo 9 — caracterização do achado pendente do step-state-ciclo7:
 * `componentMountedAt` fica preso em verdadeiro depois que o CDN volta a ser
 * bloqueado.
 *
 * Três cenários, todos com localStorage limpo no começo:
 *   A. CDN stubado → Montar componente → /integracao (passo 4 deve acender)
 *   B. mesma aba → Desmontar (o elemento sai do DOM) → /integracao
 *   C. nova aba do MESMO contexto, CDN bloqueado de novo, sem montar nada
 *      → /integracao (é aqui que o passo 4 mente)
 *
 * Uso: PW_CHROMIUM=… node scripts/step4-stuck-ciclo9.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const TMP = path.join(process.cwd(), 'scripts/.tmp-ciclo9')
fs.mkdirSync(TMP, { recursive: true })

const STUB = `window.__arrayStub=true;
(function(){
  class Fake extends HTMLElement { connectedCallback(){ this.textContent='[componente falso do QA]' } }
  for (const t of ['array-credit-score','array-credit-overview','array-credit-report','array-account-enroll'])
    if (!customElements.get(t)) customElements.define(t, class extends Fake {})
})();`

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const ctx = await browser.newContext()

const stub = async (page) => {
  await page.route(/embed(\.sandbox)?\.array\.io\/.*/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }),
  )
}
const block = async (page) => {
  await page.route(/embed(\.sandbox)?\.array\.io\/.*/, (r) => r.abort('failed'))
}
const step4 = async (page) => {
  await page.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const cards = page.locator('.steps > .card')
  const t = await cards.nth(3).innerText()
  const body = await page.locator('body').innerText()
  const tail = 'Nesta sess' + (t.split('Nesta sess')[1] ?? '')
  return { counter: (body.match(/(\d)\s*\/\s*6/) ?? [])[0], tail: tail.replace(/\s+/g, ' ').slice(0, 200) }
}

const page = await ctx.newPage()
await stub(page)
await page.goto(`${WEB}/playground`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Montar componente' }).click()
await page.waitForTimeout(2500)
const mountedDom = await page.locator('array-credit-overview, array-credit-score, array-account-enroll').count()
const A = await step4(page)

// B: volta ao Playground e DESMONTA (o custom element sai do DOM)
await page.goto(`${WEB}/playground`, { waitUntil: 'networkidle' })
const desmontar = page.getByRole('button', { name: 'Desmontar' })
const hadUnmount = (await desmontar.count()) > 0
if (hadUnmount) {
  await desmontar.click()
  await page.waitForTimeout(500)
}
const domAfterUnmount = await page.locator('array-credit-overview, array-credit-score, array-account-enroll').count()
const B = await step4(page)

// C: nova aba do mesmo contexto (mesmo localStorage), CDN bloqueado
const page2 = await ctx.newPage()
await block(page2)
const C = await step4(page2)

console.log('A (CDN stubado, componente montado):', JSON.stringify(A), 'elementos no DOM:', mountedDom)
console.log('B (após Desmontar, elemento fora do DOM):', JSON.stringify(B), 'elementos no DOM:', domAfterUnmount)
console.log('C (nova aba, CDN bloqueado, nada montado):', JSON.stringify(C))
fs.writeFileSync(path.join(TMP, 'step4-stuck.json'), JSON.stringify({ A, B, C, mountedDom, domAfterUnmount }, null, 2))
await page2.screenshot({ path: path.join(TMP, 'step4-stuck-C.png'), fullPage: true })
await browser.close()
