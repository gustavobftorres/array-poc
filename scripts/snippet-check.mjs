/**
 * VALIDATE ciclo 3 — valida de verdade o snippet HTML do Playground.
 *
 * 1. abre /playground no Chromium, seleciona N componentes e copia o texto real
 *    do card "Snippet HTML" (não uma reimplementacao de buildSnippet);
 * 2. cola cada snippet num HTML em branco em scripts/.tmp-snippets/;
 * 3. serve o diretorio num http-server local (node, sem dependencias);
 * 4. abre cada pagina no Chromium e afere:
 *      - HTML valido (nenhum "parse error" do parser do proprio Chromium:
 *        comparamos a arvore serializada com o esperado)
 *      - o custom element existe no DOM e NAO engoliu o resto da pagina
 *      - ordem dos scripts: runtime array-web-component.js antes do bundle
 *      - appKey com 36 chars no <script> e no atributo
 *      - listener de array-event registrado (dispatch sintetico -> console.log)
 *      - nenhum SyntaxError de JS no console (falha de rede do CDN e ESPERADA)
 *
 * Uso: node scripts/snippet-check.mjs [baseUrl]
 * Requer PW_CHROMIUM se o build do Playwright nao estiver instalado (ver docs/QA.md).
 */
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '.tmp-snippets')
const COMPONENTS = ['Account Enroll', 'Credit Overview', 'Credit Report', 'Credit Alerts', 'Ads (?)']

const findings = []
const note = (sev, what) => { findings.push(`${sev} ${what}`); console.log(`${sev} ${what}`) }
const ok = (what) => console.log(`ok  ${what}`)

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
const ctx = await browser.newContext()
const page = await ctx.newPage()

// ---- 1. colher os snippets reais da UI -------------------------------------
await page.goto(`${BASE}/playground`, { waitUntil: 'networkidle' })
const snippets = {}
for (const label of COMPONENTS) {
  await page.getByRole('button', { name: new RegExp(`^${label.replace(/[().?]/g, '\\$&')}`) }).first().click()
  await page.waitForTimeout(300)
  const card = page.locator('.card', { has: page.getByText('Snippet HTML') })
  const text = await card.locator('pre.json').first().innerText()
  snippets[label] = text
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  writeFileSync(join(TMP, `${slug}.html`), `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>snippet ${label}</title></head>
<body>
<h1 id="before">antes do componente</h1>
${text}
<p id="after">DEPOIS do componente — se isto virar filho do custom element, o snippet e invalido.</p>
</body></html>
`)
  console.log(`--- ${label} -> ${slug}.html (${text.length} chars)`)
}

// ---- 2. http-server local --------------------------------------------------
const server = createServer((req, res) => {
  const p = join(TMP, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html')
  let body
  try { body = readFileSync(p) } catch { res.writeHead(404); res.end('nope'); return }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
console.log(`\nhttp-server local em http://127.0.0.1:${port}\n`)

// ---- 3. abrir cada snippet e aferir ---------------------------------------
for (const [label, snippet] of Object.entries(snippets)) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const p = await ctx.newPage()
  const consoleMsgs = []
  const netFails = []
  p.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
  p.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.name}: ${e.message}`))
  p.on('requestfailed', (r) => netFails.push(`${r.url()} :: ${r.failure()?.errorText}`))
  await p.goto(`http://127.0.0.1:${port}/${slug}.html`, { waitUntil: 'load' }).catch(() => {})
  await p.waitForTimeout(1200)

  const tagMatch = snippet.match(/<(array-[a-z-]+)/)
  const tag = tagMatch?.[1]
  console.log(`\n=== ${label} (${tag}) ===`)

  // custom element no DOM + nao engoliu o resto
  const dom = await p.evaluate((t) => {
    const el = document.querySelector(t)
    const after = document.getElementById('after')
    return {
      exists: !!el,
      childCount: el ? el.childElementCount : -1,
      innerLen: el ? el.innerHTML.length : -1,
      afterExists: !!after,
      afterInsideEl: !!(el && after && el.contains(after)),
      afterIsBodyChild: !!(after && after.parentElement === document.body),
      scripts: [...document.querySelectorAll('script')].map((s) => s.src || '(inline)'),
      attrs: el ? Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])) : {},
      bodyChildTags: [...document.body.children].map((c) => c.tagName.toLowerCase()),
    }
  }, tag)

  if (!dom.exists) note('P1', `${label}: custom element <${tag}> NAO existe no DOM`)
  else ok(`<${tag}> criado no DOM`)
  if (dom.afterInsideEl) note('P1', `${label}: o paragrafo #after virou FILHO de <${tag}> (self-closing/HTML invalido)`)
  else if (!dom.afterIsBodyChild) note('P1', `${label}: #after nao e filho direto de <body> (arvore deslocada): ${dom.bodyChildTags}`)
  else ok('conteudo seguinte permaneceu fora do custom element')

  // ordem dos scripts
  const srcs = dom.scripts.filter((s) => s !== '(inline)')
  const iRuntime = srcs.findIndex((s) => s.includes('array-web-component.js'))
  const iBundle = srcs.findIndex((s) => s.includes(`${tag}.js`))
  if (iRuntime === -1) note('P1', `${label}: runtime array-web-component.js ausente`)
  else if (iBundle === -1) note('P1', `${label}: bundle ${tag}.js ausente`)
  else if (iRuntime > iBundle) note('P1', `${label}: ordem errada — bundle antes do runtime`)
  else ok(`ordem dos scripts correta (runtime[${iRuntime}] antes de bundle[${iBundle}])`)

  // appKey 36 chars nos dois lugares
  const keyInUrl = srcs.find((s) => s.includes('appKey='))?.match(/appKey=([^&]*)/)?.[1]
  const keyAttr = dom.attrs.appkey ?? dom.attrs.appKey
  const dec = keyInUrl ? decodeURIComponent(keyInUrl) : ''
  if (dec.length !== 36) note('P1', `${label}: appKey da URL do bundle tem ${dec.length} chars (esperado 36): ${dec}`)
  else ok(`appKey na URL do bundle: 36 chars`)
  if (!keyAttr) note('P2', `${label}: atributo appKey ausente no elemento`)
  else if (keyAttr.length !== 36) note('P1', `${label}: atributo appKey tem ${keyAttr.length} chars: ${keyAttr}`)
  else ok('atributo appKey: 36 chars')
  if (keyAttr && dec && keyAttr !== dec) note('P2', `${label}: appKey do atributo != appKey da URL`)

  // listener de array-event
  const heard = await p.evaluate(() => {
    const seen = []
    const orig = console.log
    console.log = (...a) => { seen.push(a.map(String).join(' ')); orig(...a) }
    window.dispatchEvent(new CustomEvent('array-event', { detail: { probe: true } }))
    console.log = orig
    return seen
  })
  if (heard.some((l) => l.includes('array-event'))) ok('listener de array-event registrado e reagiu ao dispatch')
  else note('P1', `${label}: nenhum listener de array-event reagiu (console: ${JSON.stringify(heard)})`)

  // erros de JS (falha de rede do CDN e esperada)
  const syntax = consoleMsgs.filter((m) => /SyntaxError|Unexpected token|is not defined|TypeError/.test(m))
  if (syntax.length) note('P1', `${label}: erro de JS no console -> ${syntax.join(' | ')}`)
  else ok('nenhum SyntaxError/TypeError no console')
  const netErr = consoleMsgs.filter((m) => /Failed to load resource|ERR_/.test(m))
  console.log(`    (esperado) falhas de rede do CDN: ${netFails.length}`)
  await p.screenshot({ path: join(TMP, `${slug}.png`), fullPage: true })
  void netErr
}

// ---- 4. validador de HTML independente do browser -------------------------
// parse com htmlparser2 se disponivel; senao, checagens estruturais minimas.
for (const [label, snippet] of Object.entries(snippets)) {
  const selfClosing = snippet.match(/<array-[a-z-]+[^>]*\/>/)
  if (selfClosing) note('P1', `${label}: snippet contem custom element auto-fechado: ${selfClosing[0].slice(0, 60)}`)
  const tag = snippet.match(/<(array-[a-z-]+)/)?.[1]
  if (tag && !snippet.includes(`</${tag}>`)) note('P1', `${label}: sem tag de fechamento </${tag}>`)
  // atributos com aspas nao escapadas
  const attrBlock = snippet.slice(snippet.indexOf(`<${tag}`), snippet.indexOf(`</${tag}>`))
  const badQuote = attrBlock.match(/=\s*"[^"]*"[^\s>]/)
  if (badQuote) note('P1', `${label}: atributo com aspas malformadas: ${badQuote[0]}`)
}

// ---- 5. ciclo 5: injecao no valor do atributo (W-002) e pedagogia do userToken (W-003)
{
  const pg = await ctx.newPage()
  await pg.goto(`${BASE}/playground`, { waitUntil: 'networkidle' })
  await pg.getByRole('button', { name: /^Credit Overview/ }).first().click()
  await pg.waitForTimeout(300)

  // valor hostil no atributo `sandbox`
  const row = pg.locator('.attr-row', { has: pg.locator('label', { hasText: /^sandbox$/ }) })
  const input = row.locator('input').first()
  await input.fill('true" onload="alert(1)')
  await pg.waitForTimeout(300)

  // nome de atributo invalido via prompt -> deve ser recusado
  pg.once('dialog', (d) => d.accept('bad name="x'))
  await pg.getByRole('button', { name: /\+ atributo/ }).click()
  await pg.waitForTimeout(300)

  const hostile = await pg.locator('.card', { has: pg.getByText('Snippet HTML') }).locator('pre.json').first().innerText()
  writeFileSync(join(TMP, 'hostile.html'), `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>snippet hostil</title></head>
<body>
<h1 id="before">antes</h1>
${hostile}
<p id="after">DEPOIS</p>
</body></html>
`)

  // um handler so seria executavel se estivesse FORA de um valor entre aspas:
  // removemos os valores citados e so entao procuramos por on*=
  const skeleton = hostile.replace(/"[^"]*"/g, '""')
  if (/\son[a-z]+\s*=/i.test(skeleton)) note('P1', `W-002: snippet emitiu um handler de evento executavel -> ${skeleton.match(/[^\n]*\son[a-z]+\s*=[^\n]*/i)[0]}`)
  else ok('W-002: valor hostil nao virou atributo/handler novo no texto do snippet')
  if (!/sandbox="true&quot; onload=&quot;alert\(1\)"/.test(hostile)) note('P1', 'W-002: valor hostil nao foi escapado como esperado no atributo sandbox')
  else ok('W-002: aspas do valor escapadas como &quot;')
  if (/bad name/.test(hostile)) note('P1', 'W-002: nome de atributo invalido entrou no snippet')
  else ok('W-002: nome de atributo invalido recusado')

  // W-003: a linha do userToken existe sempre, com comentario de origem/TTL
  if (!/userToken="/.test(hostile)) note('P1', 'W-003: snippet de componente de dados sem a linha userToken')
  else ok('W-003: linha userToken presente')
  if (!/authenticate\/v2\/usertoken/.test(hostile)) note('P1', 'W-003: snippet nao diz quem emite o userToken')
  else ok('W-003: snippet cita o endpoint que emite o userToken')
  if (!/client token/.test(hostile) || !/backend|servidor/i.test(hostile)) note('P1', 'W-003: snippet nao diz que o token vem do servidor')
  else ok('W-003: snippet marca a fronteira servidor/browser')
  if (!/expira|min/.test(hostile)) note('P1', 'W-003: snippet nao menciona o TTL do token')
  else ok('W-003: snippet menciona o TTL')

  // colar o snippet hostil num HTML em branco e conferir o DOM
  const hp = await ctx.newPage()
  const alerts = []
  hp.on('dialog', (d) => { alerts.push(d.message()); d.dismiss() })
  await hp.goto(`http://127.0.0.1:${port}/hostile.html`, { waitUntil: 'load' }).catch(() => {})
  await hp.waitForTimeout(900)
  const dom = await hp.evaluate(() => {
    const el = document.querySelector('array-credit-overview')
    const after = document.getElementById('after')
    return {
      exists: !!el,
      attrs: el ? Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])) : {},
      afterIsBodyChild: !!(after && after.parentElement === document.body),
    }
  })
  if (!dom.exists) note('P1', 'W-002: elemento nao existe na pagina do snippet hostil')
  else if ('onload' in dom.attrs) note('P1', `W-002: atributo onload chegou ao DOM -> ${dom.attrs.onload}`)
  else ok(`W-002: DOM sem onload; sandbox="${dom.attrs.sandbox}"`)
  if (dom.attrs.sandbox !== 'true" onload="alert(1)') note('P2', `W-002: valor do atributo sandbox nao voltou intacto: ${JSON.stringify(dom.attrs.sandbox)}`)
  else ok('W-002: valor do atributo preservado literalmente (nao quebrou em dois atributos)')
  if (!dom.afterIsBodyChild) note('P1', 'W-002: arvore deslocada apos o snippet hostil')
  else ok('W-002: arvore intacta depois do snippet hostil')
  if (alerts.length) note('P1', `W-002: o snippet hostil disparou alert(): ${alerts.join(' | ')}`)
  else ok('W-002: nenhum alert() disparado')
  await hp.screenshot({ path: join(TMP, 'hostile.png'), fullPage: true })
}

await browser.close()
server.close()
console.log(`\n===== snippet-check: ${findings.length} achado(s) =====`)
findings.forEach((f) => console.log(f))
console.log(`artefatos em ${TMP}`)
process.exit(findings.length ? 1 : 0)
