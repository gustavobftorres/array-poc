/**
 * VALIDATE ciclo 7 — X-007: tentativa de burlar a recusa de nomes executáveis.
 *
 * Para cada nome hostil: digita o nome no `prompt` do Playground, põe um payload
 * no valor, lê o snippet REAL da tela, cola num HTML em branco instrumentado com
 * `window.__pwned` e abre no Chromium. Falha se o snippet executar algo, se
 * emitir qualquer atributo `on*`/`style`/`srcdoc` no DOM, se a árvore deslocar
 * (`#after` deixar de ser filho de body) ou se aparecer dialog.
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const TMP = path.join(process.cwd(), 'scripts/.tmp-attr7')
const findings = []
const add = (s) => (findings.push(s), console.log('ACHADO: ' + s))
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

const PAYLOAD = 'window.__pwned=1'
const NAMES = [
  { name: 'onload', why: 'minúsculo (caso do X-007)' },
  { name: 'onLoad', why: 'camelCase' },
  { name: 'ONLOAD', why: 'maiúsculas' },
  { name: 'oNlOaD', why: 'alternado' },
  { name: 'onload ', why: 'espaço no fim' },
  { name: ' onload', why: 'espaço no início' },
  { name: 'on', why: 'só o prefixo' },
  { name: 'onclick', why: 'outro handler' },
  { name: 'onerror', why: 'handler de erro' },
  { name: 'style', why: 'CSS injection' },
  { name: 'srcdoc', why: 'documento embutido' },
  { name: 'оnload', why: 'homoglifo cirílico (о U+043E)' },
  { name: 'onlоad', why: 'homoglifo no meio' },
  { name: 'data-onload', why: 'data-* que parece handler' },
  { name: 'formaction', why: 'URL executável em submit' },
  { name: 'href', why: 'javascript: em href' },
  { name: 'xlink:href', why: 'href de SVG' },
  { name: 'background', why: 'URL legada' },
  { name: 'one', why: 'nome legítimo que começa com on (over-block?)' },
]
const VALUE_BY_NAME = (n) =>
  /href|action|background/i.test(n) ? `javascript:${PAYLOAD}` : `${PAYLOAD};alert(9)`

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto(`${WEB}/playground`, { waitUntil: 'networkidle' })

const results = []
for (const c of NAMES) {
  await page.reload({ waitUntil: 'networkidle' })
  const handler = (d) => d.accept(c.name)
  page.once('dialog', handler)
  await page.getByRole('button', { name: '+ atributo' }).click()
  await page.waitForTimeout(200)
  const input = page.locator(`.attr-row input`).last()
  const label = await page.locator('.attr-row label').last().innerText()
  const refused = label.trim() !== c.name.trim()
  if (!refused) {
    await input.fill(VALUE_BY_NAME(c.name))
    await page.waitForTimeout(150)
  }
  const snippet = await page.locator('pre.json').first().innerText()
  const uiMsg = (await page.locator('.hint.danger').allInnerTexts()).join(' | ')
  results.push({ ...c, refused, snippet, uiMsg })
  fs.writeFileSync(path.join(TMP, `snippet-${c.name.replace(/[^a-z0-9]/gi, '_')}.txt`), snippet)
  if (!refused && new RegExp(`\\b${c.name.trim()}\\s*=`, 'i').test(snippet))
    add(`nome "${c.name}" (${c.why}) SAIU no snippet como atributo`)
}

// ---------- cola cada snippet num HTML em branco e abre de verdade
const pages = new Map()
for (const r of results) {
  const id = r.name.replace(/[^a-z0-9]/gi, '_')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${id}</title>
<script>window.__pwned=false;window.__err=[];window.onerror=(m)=>window.__err.push(String(m))</script>
</head><body>
<div id="before">antes</div>
${r.snippet}
<div id="after">depois</div>
</body></html>`
  const f = path.join(TMP, `${id}.html`)
  fs.writeFileSync(f, html)
  pages.set(id, f)
}
const server = http.createServer((req, res) => {
  const f = path.join(TMP, decodeURIComponent(req.url).replace(/^\//, '').split('?')[0])
  if (!fs.existsSync(f)) return (res.writeHead(404), res.end())
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript' })
  res.end(fs.readFileSync(f))
})
await new Promise((r) => server.listen(8901, '127.0.0.1', r))

for (const [id, f] of pages) {
  const p = await ctx.newPage()
  let dialogs = 0
  p.on('dialog', (d) => (dialogs++, d.dismiss()))
  await p.goto(`http://127.0.0.1:8901/${path.basename(f)}`, { waitUntil: 'load' }).catch(() => {})
  await p.waitForTimeout(400)
  const probe = await p.evaluate(() => {
    const bad = []
    document.querySelectorAll('*').forEach((el) => {
      for (const a of el.attributes)
        if (/^on/i.test(a.name) || ['style', 'srcdoc'].includes(a.name.toLowerCase())) bad.push(`${el.tagName}[${a.name}]`)
    })
    const after = document.getElementById('after')
    return {
      pwned: window.__pwned === true || window.__pwned === 1,
      bad,
      afterIsBodyChild: !!after && after.parentElement === document.body,
      errs: window.__err,
    }
  })
  if (probe.pwned) add(`[${id}] o snippet EXECUTOU código na página colada`)
  if (probe.bad.length) add(`[${id}] atributo executável no DOM: ${probe.bad.join(', ')}`)
  if (!probe.afterIsBodyChild) add(`[${id}] a árvore deslocou (#after não é mais filho de body)`)
  if (dialogs) add(`[${id}] ${dialogs} dialog(s) disparados pelo snippet`)
  await p.close()
}
server.close()
await browser.close()

console.log('\nresumo (nome -> recusado pela UI?):')
for (const r of results) console.log(`  ${JSON.stringify(r.name)} recusado=${r.refused} ${r.refused ? '· msg: ' + r.uiMsg.slice(0, 90) : ''}`)
console.log(`\nhostile-attrname-ciclo7: ${findings.length} achado(s)`)
process.exit(findings.length ? 1 : 0)
