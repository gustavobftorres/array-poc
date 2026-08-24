/**
 * VALIDATE ciclo 9 — regressão independente dos 7 defeitos Y-* do ciclo 7.
 *
 * Nada aqui reusa asserção de script anterior: cada Y-* é reprovado/aprovado por
 * evidência produzida neste arquivo.
 *
 *  Y-001  passo 5 do Guia deriva de evento (reportOrderedAt), sessão semeada = 1/6
 *  Y-002  o curl do passo 6 aborta em 4xx imprimindo o corpo (servidor 401 próprio)
 *  Y-003  as duas inferências do passo 6 têm selo // UNVERIFIED
 *  Y-004  atributos de URL recusados SEM recusar nenhum atributo real da Array
 *  Y-005  consultas hard da fixture dentro da janela que o tile anuncia
 *  Y-006  Dashboard imprime o total da rota, não o tamanho da página
 *  Y-007  monthsAgoISO sem rollover de dia 31 · ?limit= vazio cai no default
 *
 * Uso: PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *      node scripts/regression-ciclo9.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import { freePort, waitForPort } from './free-port.mjs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const API = process.env.API ?? 'http://localhost:8787'
const TMP = path.join(process.cwd(), 'scripts/.tmp-ciclo9')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

const verdict = {}
const findings = []
const add = (s) => (findings.push(s), console.log('ACHADO: ' + s))
const set = (id, v, ev) => {
  verdict[id] = { v, ev }
  console.log(`${id}: ${v} — ${ev}`)
}

// ===================================================================== Y-007a
// monthsAgoISO em dias 29/30/31, transpilando o módulo real (sem reimplementar).
{
  const src = fs.readFileSync('worker/src/dates.ts', 'utf8')
  const js = execFileSync('node_modules/.bin/esbuild', ['--loader=ts', '--format=esm'], {
    input: src,
    encoding: 'utf8',
  })
  const f = path.join(TMP, 'dates.mjs')
  fs.writeFileSync(f, js)
  const { monthsAgoISO, calendarAge } = await import(f)
  const cases = [
    ['2026-08-31', 6, '2026-02-28'],
    ['2026-03-31', 1, '2026-02-28'],
    ['2024-08-29', 6, '2024-02-29'], // ano bissexto
    ['2026-05-31', 3, '2026-02-28'],
    ['2026-08-24', 6, '2026-02-24'],
    ['2026-01-15', 6, '2025-07-15'], // atravessa o ano
  ]
  const bad = []
  for (const [today, m, want] of cases) {
    const got = monthsAgoISO(m, new Date(`${today}T12:00:00Z`))
    if (got !== want) bad.push(`monthsAgoISO(${m}) em ${today} = ${got}, esperado ${want}`)
  }
  // a janela nunca pode ser mais curta que o anunciado: prova por varredura
  for (let d = 1; d <= 31; d++) {
    const today = `2026-08-${String(d).padStart(2, '0')}`
    if (Number(today.slice(8)) > 31) continue
    const cut = monthsAgoISO(6, new Date(`${today}T12:00:00Z`))
    const diffMonths = (2026 - Number(cut.slice(0, 4))) * 12 + (8 - Number(cut.slice(5, 7)))
    if (diffMonths !== 6) bad.push(`em ${today} o corte ${cut} não está 6 meses atrás (${diffMonths})`)
  }
  if (calendarAge('2008-08-25', new Date('2026-08-24T23:00:00Z')) !== 17)
    bad.push('calendarAge regrediu na fronteira de 18 anos')
  bad.forEach(add)
  set('Y-007a', bad.length ? 'NAO CORRIGIDO' : 'CORRIGIDO',
    bad.length ? bad.join('; ') : '37 datas (incl. 29/30/31, bissexto, virada de ano): dia clampado ao mês-alvo, janela sempre = 6 meses de calendário')
}

// ===================================================================== Y-007b
{
  const q = async (s) => {
    const r = await fetch(`${API}/api/array/users${s}`)
    const j = await r.json()
    return { n: j.users.length, total: j.total, limit: j.limit }
  }
  const rows = {
    'vazio ?limit=': await q('?limit='),
    'espaço ?limit=%20': await q('?limit=%20'),
    'ilegível ?limit=abc': await q('?limit=abc'),
    'ausente': await q(''),
    'teto ?limit=999999': await q('?limit=999999'),
    'min ?limit=-1': await q('?limit=-1'),
  }
  const bad = []
  for (const k of ['vazio ?limit=', 'espaço ?limit=%20', 'ilegível ?limit=abc']) {
    if (rows[k].limit !== 50) bad.push(`${k} devolveu limit=${rows[k].limit}, esperado o default 50`)
  }
  if (rows['teto ?limit=999999'].limit !== 200) bad.push('teto de limit deixou de ser 200')
  if (rows['min ?limit=-1'].limit !== 1) bad.push('clamp inferior de limit quebrou')
  bad.forEach(add)
  set('Y-007b', bad.length ? 'NAO CORRIGIDO' : 'CORRIGIDO',
    JSON.stringify(rows))
}

// ====================================================================== Y-005
// consultas hard: recomputa a janela do zero em N consumidores novos.
{
  const N = Number(process.env.N ?? 8)
  const bad = []
  const detail = []
  const today = new Date()
  const cutoff = (() => {
    const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1, d = today.getUTCDate()
    const t = new Date(Date.UTC(y, m - 1 - 6, 1))
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
  })()
  for (let i = 0; i < N; i++) {
    const seed = await (await fetch(`${API}/api/seed`, { method: 'POST' })).json()
    const rep = await (await fetch(
      `${API}/api/array/report?reportKey=${encodeURIComponent(seed.reportKey)}&displayToken=${encodeURIComponent(seed.displayToken)}`,
    )).json()
    const inq = rep.inquiries ?? rep.report?.inquiries ?? []
    const hard = inq.filter((q) => q.type === 'Hard')
    const inWindow = hard.filter((q) => q.date >= cutoff)
    const tile = rep.summary?.inquiries6mo ?? rep.report?.summary?.inquiries6mo
    detail.push(`${hard.length} hard, ${inWindow.length} na janela, tile ${tile}`)
    if (tile !== inWindow.length) bad.push(`tile ${tile} != ${inWindow.length} hard na janela`)
    // Y-005 era: a fixture gerava fora da janela que ela mesma anuncia.
    if (hard.length !== inWindow.length)
      bad.push(`${hard.length - inWindow.length} consulta(s) hard FORA da janela de 6 meses (${hard.filter((q) => q.date < cutoff).map((q) => q.date).join(',')})`)
  }
  bad.forEach(add)
  set('Y-005', bad.length ? 'NAO CORRIGIDO' : 'CORRIGIDO',
    `${N} relatórios novos, corte ${cutoff}: ${[...new Set(detail)].join(' | ')}`)
}

// ============================================================ Y-002 (servidor)
// Upstream próprio em PROCESSO SEPARADO: 401 sempre em /api/report/v2 (reportKey
// A), 202 duas vezes e depois 200 com corpo (reportKey B) e 204 na primeira
// (reportKey C) — o critério documentado do ciclo 13. Tem que ser outro
// processo — execFileSync bloqueia o event loop, então um servidor no mesmo
// processo nunca aceitaria a conexão do curl (e o snippet pareceria não pedir
// nada).
// W2-014: porta livre em vez de porta fixa — uma 8931 ocupada fazia este
// script acusar 8 achados falsos ("Y-002 NAO CORRIGIDO").
const PORT9 = await freePort(Number(process.env.PORT9 ?? 8931))
const UPLOG = path.join(TMP, 'upstream.log')
const UPFILE = path.join(TMP, 'upstream.mjs')
fs.writeFileSync(UPFILE, `import http from 'node:http'
const PORTX = Number(process.env.PORTX)
import fs from 'node:fs'
let b = 0
http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    fs.appendFileSync(process.env.UPLOG, req.method + ' ' + u.pathname + ' ' + (u.searchParams.get('reportKey') ?? '') + '\\n')
    if (u.pathname === '/api/report/v2' && req.method === 'GET') {
      if (u.searchParams.get('reportKey') === 'B') {
        b++
        // 202 = ainda gerando (duas vezes), depois 200 com o corpo real.
        if (b <= 2) {
          res.writeHead(202)
          return res.end()
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{"score":712}')
      }
      if (u.searchParams.get('reportKey') === 'C') {
        // 204 = falha PERMANENTE: o snippet tem que abortar na primeira.
        res.writeHead(204)
        return res.end()
      }
      res.writeHead(401, { 'content-type': 'application/json' })
      return res.end('{"message":"Unauthorized: client token invalido"}')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"displayToken":"novo-1"}')
  })
  .listen(PORTX, '127.0.0.1')
`)
fs.writeFileSync(UPLOG, '')
const { spawn } = await import('node:child_process')
const up = spawn(process.execPath, [UPFILE], {
  env: { ...process.env, UPLOG, PORTX: String(PORT9) },
  stdio: 'ignore',
  detached: false,
})
if (!(await waitForPort(PORT9))) {
  console.error(`ERRO DE HARNESS: o upstream falso não subiu em 127.0.0.1:${PORT9} (porta ocupada?). Isto NAO e achado do produto.`)
  up.kill()
  process.exit(2)
}
const upHits = (rk) =>
  fs.readFileSync(UPLOG, 'utf8').split('\n').filter((l) => l.startsWith('GET /api/report/v2 ' + rk)).length

// ============================================================== browser checks
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })

// ---- Y-001 / Y-003 / Y-002 (extração) no Guia, contexto limpo + semeado
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  // (a) sessão limpa
  await page.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })
  const limpa = await page.locator('body').innerText()
  const mLimpa = limpa.match(/(\d)\s*\/\s*6/)

  // (b) semeia pelo Dashboard (como o avaliador faria)
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Semear usuário demo/i }).click()
  await page.waitForTimeout(1500)
  const dash = await page.locator('body').innerText()
  await page.goto(`${WEB}/integracao`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const cards = page.locator('.steps > .card')
  const stepTexts = []
  for (let i = 0; i < (await cards.count()); i++) stepTexts.push(await cards.nth(i).innerText())
  const body = await page.locator('body').innerText()
  const m = body.match(/(\d)\s*\/\s*6/)
  fs.writeFileSync(path.join(TMP, 'guia-semeada.txt'), body)
  await page.screenshot({ path: path.join(TMP, 'y001-semeada.png'), fullPage: true })

  const bad = []
  if (!mLimpa || mLimpa[1] !== '0') bad.push(`sessão limpa marcou ${mLimpa?.[0] ?? '?'} (esperado 0/6)`)
  if (!m || m[1] !== '1') bad.push(`sessão semeada marcou ${m?.[0] ?? '?'} (esperado 1/6)`)
  const s5 = stepTexts[4] ?? ''
  fs.writeFileSync(path.join(TMP, 'passo5.txt'), s5)
  // o veredito do passo vive no bloco final "Nesta sessão · <label>"
  const s5tail = 'Nesta sess' + (s5.split('Nesta sess')[1] ?? '')
  const s5head = s5tail
  // "POST /api/array/report feito nesta sessão" é o LABEL do passo; o veredito
  // é o selo (feito/pendente) e o motivo logo abaixo.
  if (!/pendente/i.test(s5head) || /\bfeito\b\s*—/.test(s5head))
    bad.push('passo 5 não está pendente numa sessão semeada (contou o evento do /api/seed)')
  if (!/pendente/i.test(s5head)) bad.push('passo 5 não está pendente numa sessão semeada')
  if (!/seed/i.test(s5head)) bad.push('passo 5 não explica que o pedido do relatório veio do /api/seed')
  bad.forEach(add)
  set('Y-001', bad.length ? 'NAO CORRIGIDO' : 'CORRIGIDO',
    `limpa ${mLimpa?.[0]} · semeada ${m?.[0]} · passo 5: "${s5head.replace(/\s+/g, ' ').slice(0, 260)}"`)

  // ---- Y-006: o Dashboard imprime o total da rota
  const totalApi = (await (await fetch(`${API}/api/array/users?limit=10`)).json()).total
  const badd = []
  if (!dash.includes(String(totalApi)))
    badd.push(`Dashboard não mostra o total real (${totalApi}) em nenhum lugar do texto`)
  if (/de\s+50\b/.test(dash) && totalApi !== 50) badd.push('Dashboard ainda imprime 50 (tamanho da página)')
  badd.forEach(add)
  set('Y-006', badd.length ? 'NAO CORRIGIDO' : 'CORRIGIDO',
    `total da rota=${totalApi}; trecho: "${(dash.match(/Mostrando[^\n]*/) ?? [''])[0]}" / "${(dash.match(/Ver todos[^\n]*/) ?? [''])[0]}"`)

  // ---- Y-003: selos do passo 6
  const s6 = stepTexts[5] ?? ''
  const bad3 = []
  const seals = [...s6.matchAll(/\/\/ UNVERIFIED/g)].length
  // Ciclo 13: o critério de conclusão passou a ser o STATUS HTTP documentado —
  // ele é VERIFICADO; o que continua inferido é a UNIDADE do intervalo/timeout.
  if (!/202/.test(s6) || !/200/.test(s6) || !/204/.test(s6))
    bad3.push('o passo 6 não descreve o critério documentado 202/200/204')
  if (!/UNVERIFIED/.test(s6)) bad3.push('passo 6 sem nenhum selo // UNVERIFIED')
  if (!/ARRAY_POLL_(INTERVAL|TIMEOUT)/.test(s6))
    bad3.push('o passo 6 não cita ARRAY_POLL_INTERVAL/ARRAY_POLL_TIMEOUT')
  if (!/(UNIDADE|unidade)[^.]*segundos/.test(s6))
    bad3.push('a unidade (segundos) do polling não está marcada como inferida no passo 6')
  if (!/401\/403/.test(s6)) bad3.push('mapeamento 401/403 não aparece nos selos do passo 6')
  bad3.forEach(add)
  set('Y-003', bad3.length ? 'NAO CORRIGIDO' : 'CORRIGIDO',
    `${seals} selos // UNVERIFIED no passo 6, cobrindo a unidade do polling e o 401/403; critério 202/200/204 presente`)

  // ---- Y-002: extrai o curl do passo 6 e executa contra o upstream próprio
  const c6 = cards.nth(5)
  await c6.locator('button.tiny').nth(0).click()
  const curl6 = await c6.locator('pre.json').innerText()
  fs.writeFileSync(path.join(TMP, 'passo6.sh'), curl6)
  await ctx.close()

  const rewrite = (s, rk) =>
    s.replace(/https:\/\/sandbox\.array\.io\/api/g, `http://127.0.0.1:${PORT9}/api`)
      .replace(/^export ARRAY_SERVER_TOKEN=.*$/m, '')
      .replace(/\$REPORT_KEY/g, rk)
  const env = {
    ...process.env,
    ARRAY_SERVER_TOKEN: 'SEGREDO',
    ARRAY_POLL_INTERVAL: '0.2',
    ARRAY_POLL_TIMEOUT: '10',
    ARRAY_APP_KEY: '11111111-2222-4333-8444-555555555555',
    CLIENT_KEY: 'CK-1',
    REPORT_KEY: 'A',
    DISPLAY_TOKEN: 'DT-1',
    // curl usa o proxy de egresso do ambiente até para 127.0.0.1 se no_proxy
    // não listar o loopback — sem isto o snippet nem chega ao upstream local.
    no_proxy: '127.0.0.1,localhost',
    NO_PROXY: '127.0.0.1,localhost',
  }
  const run = (script) => {
    const f = path.join(TMP, 'run.sh')
    fs.writeFileSync(f, script)
    try {
      execFileSync('bash', ['-n', f], { stdio: 'pipe' })
    } catch (e) {
      return { code: -1, out: '', err: 'bash -n falhou: ' + e.stderr }
    }
    const t0 = Date.now()
    try {
      const out = execFileSync('bash', [f], { env, encoding: 'utf8', stdio: 'pipe', timeout: 90000 })
      return { code: 0, out, err: '', ms: Date.now() - t0 }
    } catch (e) {
      return { code: e.status, out: e.stdout ?? '', err: e.stderr ?? '', ms: Date.now() - t0 }
    }
  }
  const a = run(rewrite(curl6, 'A'))
  const b = run(rewrite(curl6, 'B'))
  const cc = run(rewrite(curl6, 'C'))
  const bad2 = []
  const ha = upHits('A')
  const hb = upHits('B')
  const hc = upHits('C')
  if (ha !== 1) bad2.push(`401: o snippet fez ${ha} requisições (esperado 1, abortar na primeira)`)
  if (a.ms > 8000) bad2.push(`401: o snippet esperou ${a.ms} ms antes de desistir`)
  if (!/401/.test(a.err + a.out)) bad2.push('401: o snippet não imprimiu o status')
  if (!/Unauthorized/.test(a.err + a.out)) bad2.push('401: o snippet não imprimiu o corpo do erro')
  if (hb !== 3) bad2.push(`202→200: fez ${hb} requisições (esperado 3: 202, 202, 200)`)
  if (!/712/.test(b.out)) bad2.push('202→200: o snippet não imprimiu o corpo quando ele finalmente chegou')
  if (b.code !== 0) bad2.push(`202→200: o snippet saiu com ${b.code} num caso de sucesso`)
  // 204 = falha permanente: uma requisição, saída não-zero, e RÁPIDO (o bug
  // antigo girava até o timeout tratando 204 como "ainda vazio").
  if (hc !== 1) bad2.push(`204: fez ${hc} requisições (esperado 1, abortar imediatamente)`)
  if (cc.code === 0) bad2.push('204: o snippet saiu com 0 numa falha permanente')
  if (!/204/.test(cc.err + cc.out)) bad2.push('204: o snippet não imprimiu o status')
  if (cc.ms > 3000) bad2.push(`204: o snippet esperou ${cc.ms} ms antes de desistir`)
  bad2.forEach(add)
  fs.writeFileSync(path.join(TMP, 'y002.log'),
    `=== 401 ===\nexit=${a.code} ms=${a.ms}\nSTDOUT\n${a.out}\nSTDERR\n${a.err}\n=== 202->200 ===\nexit=${b.code} ms=${b.ms}\nSTDOUT\n${b.out}\nSTDERR\n${b.err}\n=== 204 ===\nexit=${cc.code} ms=${cc.ms}\nSTDOUT\n${cc.out}\nSTDERR\n${cc.err}\n`)
  set('Y-002', bad2.length ? 'NAO CORRIGIDO' : 'CORRIGIDO',
    `401: ${ha} req, exit ${a.code} em ${a.ms} ms · 202→200: ${hb} req, corpo impresso · 204: ${hc} req, exit ${cc.code} em ${cc.ms} ms`)
}

// ====================================================================== Y-004
// Duas listas: (1) TODOS os atributos reais da Array (ARRAY_API_RESEARCH §4.3) —
// nenhum pode ser recusado; (2) os 5 atributos de URL do Y-004 — todos devem ser.
{
  const LEGIT = [
    'appKey', 'sandbox', 'userToken', 'clientKey', 'userId', 'exp', 'tui', 'efx',
    'showResultPages', 'productCode', 'reportKey', 'displayToken',
    'creditAlertsLink', 'creditReportLink', 'debtAnalysisLink', 'identityProtectLink',
    'scoreFactorsLink', 'scoreSimulatorLink', 'settingsLink', 'helloPrivacyLink',
  ]
  const MUST_REFUSE = [
    'href', 'formaction', 'background', 'xlink:href', 'data-onload',
    'src', 'srcset', 'action', 'poster', 'ping', 'onload', 'style', 'srcdoc',
  ]
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const tryName = async (name) => {
    await page.goto(`${WEB}/playground`, { waitUntil: 'networkidle' })
    page.once('dialog', (d) => d.accept(name))
    await page.getByRole('button', { name: '+ atributo' }).click()
    await page.waitForTimeout(150)
    const labels = await page.locator('.attr-row label').allInnerTexts()
    const accepted = labels.map((l) => l.trim()).includes(name.trim())
    const msg = (await page.locator('.hint.danger').allInnerTexts()).join(' | ')
    return { accepted, msg }
  }
  const wrongly = []
  const escaped = []
  for (const n of LEGIT) {
    const r = await tryName(n)
    if (!r.accepted) wrongly.push(`${n} (${r.msg.slice(0, 80)})`)
  }
  for (const n of MUST_REFUSE) {
    const r = await tryName(n)
    if (r.accepted) escaped.push(n)
  }
  await ctx.close()
  wrongly.forEach((w) => add(`Y-004 REGRESSÃO: atributo LEGÍTIMO da Array recusado: ${w}`))
  escaped.forEach((e) => add(`Y-004: atributo de URL "${e}" ainda entra no snippet`))
  set('Y-004', wrongly.length ? 'REGREDIU' : escaped.length ? 'NAO CORRIGIDO' : 'CORRIGIDO',
    `${LEGIT.length}/${LEGIT.length - wrongly.length} atributos reais da Array aceitos; ${MUST_REFUSE.length - escaped.length}/${MUST_REFUSE.length} hostis recusados`)
}

await browser.close()
up.kill()

console.log('\n=== veredito ciclo 9 ===')
for (const [k, v] of Object.entries(verdict)) console.log(`${k}\t${v.v}`)
fs.writeFileSync(path.join(TMP, 'verdict.json'), JSON.stringify(verdict, null, 2))
console.log(`\nregression-ciclo9: ${findings.length} achado(s)`)
process.exit(0)
