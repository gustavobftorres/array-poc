/**
 * VALIDATE ciclo 5 — auditoria da tela /integracao (a peca central da POC).
 *
 * Afere, no browser:
 *  - o diagrama servidor x browser (faixas, fronteira, "client token nunca cruza");
 *  - os 4 passos, cada um com rota da Array, rota da POC, lista do backend,
 *    estado da sessao e alternancia curl/HTML <-> TypeScript;
 *  - se o codigo copiado pelo botao "Copiar" e o mesmo exibido;
 *  - fatos contra docs/ARRAY_API_RESEARCH.md: header do client token, appKey no
 *    body das chamadas de servidor, nomes de rota, ordem dos scripts;
 *  - se o estado "feito nesta sessao" corresponde ao que REALMENTE aconteceu
 *    (sessao semeada NAO executa KBA nem POST /usertoken);
 *  - tabela de erros e links internos.
 *
 * Uso: PW_CHROMIUM=… node scripts/integration-audit-ciclo5.mjs [baseUrl]
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5173'
const SHOTS = 'docs/screenshots'
mkdirSync(SHOTS, { recursive: true })

const findings = []
const note = (sev, what) => { findings.push(`${sev} ${what}`); console.log(`${sev} ${what}`) }
const ok = (what) => console.log(`ok  ${what}`)

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
const consoleMsgs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`))
const bad = []
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`) })

// sessao limpa: quais passos aparecem como pendentes?
await page.goto(`${BASE}/integracao`, { waitUntil: 'networkidle' })
const pendingClean = await page.locator('.step').evaluateAll((els) =>
  els.map((e) => e.querySelector('.badge.ok, .badge.warn')?.textContent?.trim()),
)
console.log('sessao limpa, badges por passo:', pendingClean)
const counterClean = await page.locator('.page-head .badge').first().innerText()
console.log('contador:', counterClean)
if (!/0\/4/.test(counterClean)) note('P2', `sessao limpa deveria mostrar 0/4 passos, mostrou "${counterClean}"`)

// semear (nao executa KBA nem POST /usertoken de verdade... verificamos abaixo)
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Semear usuário demo/i }).click()
await page.waitForTimeout(1500)
await page.goto(`${BASE}/integracao`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

const steps = await page.locator('.step').evaluateAll((els) =>
  els.map((e) => ({
    title: e.querySelector('.card-title, h3, .row')?.textContent?.trim(),
    lane: /SERVIDOR/.test(e.textContent) ? 'server' : 'browser',
    badge: e.querySelector('.badge.ok, .badge.warn')?.textContent?.trim(),
    text: e.innerText,
  })),
)
if (steps.length !== 4) note('P1', `esperados 4 passos, encontrados ${steps.length}`)
else ok('4 passos renderizados')

const counterSeed = await page.locator('.page-head .badge').first().innerText()
console.log('contador depois do seed:', counterSeed)

// O seed NAO faz KBA (nem POST /authenticate/v2) nem POST /usertoken pelo browser.
const kbaStep = steps[1]
if (/feito nesta sessão/.test(kbaStep.text)) {
  note('P2', 'passo 2 (KBA) marcado "feito nesta sessão" numa sessão que nunca respondeu KBA (o seed emite o userToken direto) — o estado é derivado de session.userToken, não do passo')
}
const tokenStep = steps[2]
console.log('passo 3 badge:', tokenStep.badge)

// diagrama
const svg = await page.locator('.flow-diagram svg').first()
const svgText = (await svg.innerText().catch(() => '')) || (await page.locator('.flow-diagram').innerText())
for (const must of ['SERVIDOR', 'BROWSER', 'client token', 'nunca cruza', 'fronteira', 'userToken']) {
  if (!svgText.includes(must)) note('P2', `diagrama sem o rótulo "${must}"`)
}
const aria = await svg.getAttribute('aria-label')
if (!aria) note('P2', 'svg do diagrama sem aria-label')
else ok(`diagrama com aria-label (${aria.length} chars)`)

// codigo de cada passo, nas duas linguagens + botao copiar
const snippets = {}
for (let i = 0; i < 4; i++) {
  const card = page.locator('.step').nth(i)
  for (const langBtn of [null, 'TypeScript']) {
    if (langBtn) await card.getByRole('button', { name: langBtn }).click()
    await page.waitForTimeout(150)
    const code = await card.locator('pre.json').first().innerText()
    snippets[`${i}-${langBtn ?? 'default'}`] = code
    await card.getByRole('button', { name: /Copiar/ }).click()
    await page.waitForTimeout(150)
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null)
    if (clip !== null && clip.trim() !== code.trim()) {
      note('P2', `passo ${i + 1} (${langBtn ?? 'curl'}): texto copiado difere do exibido (${clip.length} vs ${code.length} chars)`)
    }
  }
}

// ---- fatos contra docs/ARRAY_API_RESEARCH.md ------------------------------
const serverCurls = [snippets['0-default'], snippets['1-default'], snippets['2-default']]
serverCurls.forEach((c, i) => {
  const n = i + 1
  if (!/x-credmo-client-token/.test(c)) note('P1', `passo ${n}: curl de servidor sem o header x-credmo-client-token`)
  if (/x-credmo-client-token[^\n]*#/.test(c)) {
    note('P1', `passo ${n}: o comentário "# SEGREDO…" está DENTRO do valor do header -H, então o curl envia um header inválido (não é colável)`)
  }
  if (/-H '[^']*\$[A-Z_]+/.test(c)) {
    note('P2', `passo ${n}: variável de ambiente dentro de aspas SIMPLES no curl — o shell não expande ($ARRAY_SERVER_TOKEN vai literal)`)
  }
})
// appKey no body (docs §3.1, §3.3, §3.4)
const needsAppKeyBody = [
  [1, snippets['0-default'], 'POST /user/v2'],
  [2, snippets['1-default'], 'POST /authenticate/v2'],
  [3, snippets['2-default'], 'POST /authenticate/v2/usertoken'],
]
for (const [n, code, route] of needsAppKeyBody) {
  if (!/appKey/.test(code)) note('P1', `passo ${n}: o body do ${route} não traz appKey, que docs/ARRAY_API_RESEARCH.md marca como propriedade verificada`)
}
for (const [n, code] of [[1, snippets['0-TypeScript']], [2, snippets['1-TypeScript']], [3, snippets['2-TypeScript']]]) {
  if (!/appKey/.test(code)) note('P2', `passo ${n}: o exemplo TypeScript também monta o body sem appKey`)
}
// campos de resposta
if (/expiresAt/.test(snippets['2-default']) || /expiresAt/.test(snippets['2-TypeScript'])) {
  note('P2', 'passo 3 apresenta `expiresAt` como campo da resposta da Array; a pesquisa só documenta appKey/clientKey/token/ttlInMinutes (expiresAt é invenção desta POC)')
}
// browser: ordem dos scripts e tag de fechamento
const html = snippets['3-default']
if (html.indexOf('array-web-component.js') > html.indexOf('array-credit-overview.js')) note('P1', 'passo 4: bundle antes do runtime')
if (/<array-[a-z-]+[^>]*\/>/.test(html)) note('P1', 'passo 4: custom element auto-fechado no exemplo')
if (!/<\/array-credit-overview>/.test(html)) note('P1', 'passo 4: sem tag de fechamento')
// fluxo real: o relatorio (docs §3.5/§3.6) nao tem passo
const all = await page.locator('main, body').first().innerText()
if (!/report\/v2/.test(all)) {
  note('P1', 'o guia para no passo 4 e nunca menciona POST/GET /report/v2 — pedir e buscar o relatório (docs §3.5/§3.6) é parte obrigatória do fluxo real e é o que as telas Credit Report/Playground (modo manual: reportKey+displayToken) usam')
}
if (!/webhook/i.test(all)) note('P2', 'nenhuma menção a webhooks (docs §3.10), que é como o produto do usuário fica sabendo de alertas e de relatório pronto')
if (!/x-credmo-user-token/.test(all)) note('P2', 'o guia nunca cita o header x-credmo-user-token (docs §2/§3.5), a alternativa a chamar do servidor com o client token')
if (!/UNVERIFIED|inferid|não verificad|nao verificad/i.test(all)) {
  note('P2', 'a tela apresenta tudo com a mesma confiança: nenhum selo de "inferido/UNVERIFIED" como no Playground, embora parte do fluxo (paths de alerts/monitoring, envelope exato dos bodies) seja inferência')
}

// tabela de erros
const rows = await page.locator('table tbody tr').count()
console.log('linhas na tabela de erros:', rows)
if (rows < 4) note('P2', `tabela de erros com apenas ${rows} linhas`)

// links internos
const links = await page.locator('a[href^="/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))])
console.log('links internos:', links)

// screenshots
await page.screenshot({ path: `${SHOTS}/qa5-integracao.png`, fullPage: true })
await page.locator('.flow-diagram').screenshot({ path: `${SHOTS}/qa5-integracao-diagrama.png` })
const m = await ctx.newPage()
await m.setViewportSize({ width: 390, height: 844 })
await m.goto(`${BASE}/integracao`, { waitUntil: 'networkidle' })
await m.waitForTimeout(400)
const ov = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
if (ov.sw > ov.cw) note('P2', `/integracao estoura no mobile: scrollWidth ${ov.sw} > ${ov.cw}`)
else ok(`mobile 390px sem overflow (${ov.sw})`)
await m.screenshot({ path: `${SHOTS}/qa5-m-integracao.png`, fullPage: true })

if (consoleMsgs.length) note('P2', `console com ${consoleMsgs.length} mensagem(ns): ${consoleMsgs.slice(0, 3).join(' | ')}`)
else ok('console limpo em /integracao')
if (bad.length) note('P2', `respostas >=400: ${bad.slice(0, 3).join(' | ')}`)

await browser.close()
console.log(`\n===== integration-audit: ${findings.length} achado(s) =====`)
findings.forEach((f) => console.log(f))
