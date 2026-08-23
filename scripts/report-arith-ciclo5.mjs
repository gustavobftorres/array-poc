/**
 * VALIDATE ciclo 5 — recomputa TODA a aritmetica do relatorio a partir do JSON
 * cru, para N consumidores diferentes (o mock varia tradelines por clientKey,
 * e o W-004 original so aparecia em ~4 de 8 usuarios).
 *
 * Invariantes aferidas por relatorio:
 *   totalAccounts        == numero de tradelines
 *   revolvingBalance     == soma dos saldos de Credit Card/Charge Card/Revolving
 *   revolvingLimit       == soma dos limites das mesmas contas
 *   installmentBalance   == soma dos saldos das demais
 *   totalBalance         == revolvingBalance + installmentBalance
 *   utilization          == round1(revolvingBalance / revolvingLimit * 100)
 *   delinquencies        == tradelines com alguma marca != OK
 *   inquiries6mo         == consultas Hard nos ultimos 6 meses
 *   oldestAccountYears   == anos de calendario desde a conta mais antiga
 *   scoreHistory         termina no score canonico e nao tem degrau > 15 pts
 *   fatores              PAYMENT_HISTORY/DEROGATORY nao podem ser "positive"
 *                        nem dizer "nenhum registro negativo" havendo atraso
 *
 * Uso: node scripts/report-arith-ciclo5.mjs [n] [baseUrl]
 */
const N = Number(process.argv[2] || 10)
const API = process.argv[3] || 'http://localhost:8787/api'

const REV = new Set(['Credit Card', 'Charge Card', 'Revolving'])
const findings = []
const note = (sev, what) => { findings.push(`${sev} ${what}`); console.log(`${sev} ${what}`) }

const post = async (p, body) => {
  const r = await fetch(`${API}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`${p} -> ${r.status} ${JSON.stringify(j)}`)
  return j
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const r1 = (n) => Math.round(n * 10) / 10

for (let i = 0; i < N; i++) {
  const user = await post('/array/user', {
    firstName: `QA${i}`,
    lastName: `ARITH${i}${'X'.repeat(i % 4)}`,
    dob: '1985-03-1' + (i % 9),
    ssn: `66600${String(1000 + i).slice(-4)}`,
    address: { street: `${100 + i} QA ST`, city: 'AUSTIN', state: 'TX', zip: '73301' },
  })
  const order = await post('/array/report', { clientKey: user.clientKey, productCode: 'credmo3bReportScore' })
  const q = new URLSearchParams({ reportKey: order.reportKey, displayToken: order.displayToken, clientKey: user.clientKey })
  const d = await (await fetch(`${API}/array/report?${q}`)).json()
  const s = d.summary
  const tag = `#${i} ${user.clientKey.slice(0, 8)}`

  const rev = d.tradelines.filter((t) => REV.has(t.accountType))
  const inst = d.tradelines.filter((t) => !REV.has(t.accountType))
  const rb = sum(rev.map((t) => t.balance))
  const rl = sum(rev.map((t) => t.creditLimit))
  const ib = sum(inst.map((t) => t.balance))

  const eq = (label, got, want) => { if (got !== want) note('P1', `${tag}: ${label} = ${got}, recomputado = ${want}`) }
  eq('totalAccounts', s.totalAccounts, d.tradelines.length)
  eq('revolvingBalance', s.revolvingBalance, rb)
  eq('revolvingLimit', s.revolvingLimit, rl)
  eq('installmentBalance', s.installmentBalance, ib)
  eq('totalBalance', s.totalBalance, rb + ib)
  eq('revolvingAccounts', s.revolvingAccounts, rev.length)
  if (rl > 0) eq('utilization', s.utilization, r1((rb / rl) * 100))
  const late = d.tradelines.filter((t) => t.paymentHistory.some((m) => m !== 'OK'))
  eq('delinquencies', s.delinquencies, late.length)
  const cut = new Date(); cut.setUTCMonth(cut.getUTCMonth() - 6)
  eq('inquiries6mo', s.inquiries6mo, d.inquiries.filter((q) => q.type === 'Hard' && new Date(q.date) >= cut).length)
  const oldest = d.tradelines.map((t) => t.opened).sort()[0]
  const now = new Date()
  let years = now.getUTCFullYear() - Number(oldest.slice(0, 4))
  const [om, od] = [Number(oldest.slice(5, 7)), Number(oldest.slice(8, 10))]
  if (now.getUTCMonth() + 1 < om || (now.getUTCMonth() + 1 === om && now.getUTCDate() < od)) years -= 1
  eq('oldestAccountYears', s.oldestAccountYears, years)

  // rotativo nunca pode conter parcelado
  const wrong = rev.filter((t) => /Loan|Mortgage/i.test(t.accountType))
  if (wrong.length) note('P1', `${tag}: conta parcelada classificada como rotativa: ${wrong.map((t) => t.accountType)}`)
  // saldo total nunca deve ser comparavel a um limite so do rotativo sem rotulo
  if (s.totalCreditLimit !== undefined) note('P2', `${tag}: summary voltou a expor totalCreditLimit (${s.totalCreditLimit})`)

  // historico de score
  const h = d.scoreHistory.map((p) => p.score)
  if (h[h.length - 1] !== d.score) note('P1', `${tag}: historico termina em ${h[h.length - 1]} mas o score e ${d.score}`)
  const jumps = h.slice(1).map((v, k) => Math.abs(v - h[k]))
  const big = Math.max(...jumps)
  if (big > 15) note('P2', `${tag}: degrau de ${big} pontos no historico ${JSON.stringify(h)}`)

  // fatores coerentes com os atrasos
  const f = Object.fromEntries(d.factors.map((x) => [x.code, x]))
  if (late.length && f.PAYMENT_HISTORY?.direction === 'positive') note('P1', `${tag}: PAYMENT_HISTORY positivo com ${late.length} conta(s) em atraso`)
  if (late.length && /[Nn]enhum registro negativo/.test(f.DEROGATORY?.description ?? '')) note('P1', `${tag}: DEROGATORY diz "nenhum registro negativo" com atraso presente`)
  if (!late.length && d.collections.length === 0 && f.DEROGATORY?.direction !== 'positive') note('P2', `${tag}: sem atraso e sem cobranca, mas DEROGATORY = ${f.DEROGATORY?.direction}`)
  const utilTxt = f.UTILIZATION?.description ?? ''
  if (rl > 0 && !utilTxt.includes(String(s.utilization))) note('P2', `${tag}: texto de UTILIZATION nao cita ${s.utilization}% -> "${utilTxt}"`)

  console.log(`ok  ${tag}: ${d.tradelines.length} contas · rev ${rb}/${rl} = ${s.utilization}% · inst ${ib} · atrasos ${late.length} · score ${d.score} (hist ${h[0]}→${h[h.length - 1]})`)
}

console.log(`\n===== report-arith: ${findings.length} achado(s) em ${N} relatorio(s) =====`)
findings.forEach((f) => console.log(f))
process.exit(findings.length ? 1 : 0)
