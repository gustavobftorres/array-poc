/**
 * VALIDATE ciclo 7 — recomputa a aritmética do relatório do JSON cru, com
 * atenção a X-004 (janela de 6 meses das consultas hard) e X-005 (idade da
 * conta mais antiga por calendário). Cria N consumidores novos, pede e busca o
 * relatório de cada um e confere tudo do zero, sem confiar em nenhum campo
 * agregado do worker.
 */
const API = process.env.API ?? 'http://localhost:8787'
const N = Number(process.argv[2] ?? 14)
const findings = []
const add = (s) => (findings.push(s), console.log('ACHADO: ' + s))

function calendarAge(date, now = new Date()) {
  const [y, m, d] = date.split('-').map(Number)
  const ty = now.getUTCFullYear(), tm = now.getUTCMonth() + 1, td = now.getUTCDate()
  let age = ty - y
  if (tm < m || (tm === m && td < (d || 1))) age -= 1
  return age
}
function monthsAgoISO(months, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()))
  return d.toISOString().slice(0, 10)
}
const REVOLVING = ['Credit Card', 'Charge Card', 'Revolving']

const post = (p, b) =>
  fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }))

let checked = 0
for (let i = 0; i < N; i++) {
  const u = await post('/api/array/user', {
    firstName: 'QA' + i,
    lastName: 'CICLO7',
    ssn: '666' + String(100000 + i),
    dob: '1974-04-18',
    address: { street: `${i} QA ST`, city: 'AUSTIN', state: 'TX', zip: '78701' },
  })
  if (u.status !== 200) {
    add(`consumidor ${i}: POST /api/array/user -> ${u.status} ${JSON.stringify(u.body).slice(0, 160)}`)
    continue
  }
  const clientKey = u.body.clientKey
  const ord = await post('/api/array/report', { clientKey, productCode: 'credmo3bReportScore' })
  if (ord.status !== 200) {
    add(`${clientKey}: POST /api/array/report -> ${ord.status}`)
    continue
  }
  const { reportKey, displayToken } = ord.body
  const g = await fetch(`${API}/api/array/report?reportKey=${reportKey}&displayToken=${displayToken}&clientKey=${clientKey}`)
  if (g.status !== 200) {
    add(`${clientKey}: GET /api/array/report -> ${g.status}`)
    continue
  }
  const rep = await g.json()
  const s = rep.summary ?? {}
  const tl = rep.tradelines ?? []
  const inq = rep.inquiries ?? []
  checked++

  // --- W-004 / W-005
  const rev = tl.filter((t) => REVOLVING.includes(t.accountType) && t.creditLimit > 0)
  const inst = tl.filter((t) => !REVOLVING.includes(t.accountType) || t.creditLimit <= 0)
  const revB = rev.reduce((a, t) => a + t.balance, 0)
  const revL = rev.reduce((a, t) => a + t.creditLimit, 0)
  const util = revL > 0 ? Math.round((revB / revL) * 1000) / 10 : 0
  if (s.revolvingBalance !== revB) add(`${clientKey}: revolvingBalance ${s.revolvingBalance} != ${revB}`)
  if (s.revolvingLimit !== revL) add(`${clientKey}: revolvingLimit ${s.revolvingLimit} != ${revL}`)
  if (s.utilization !== util) add(`${clientKey}: utilization ${s.utilization} != ${util}`)
  if (s.installmentBalance !== inst.reduce((a, t) => a + t.balance, 0)) add(`${clientKey}: installmentBalance errado`)
  if (s.totalBalance !== tl.reduce((a, t) => a + t.balance, 0)) add(`${clientKey}: totalBalance errado`)
  if (rev.some((t) => /Loan|Mortgage/i.test(t.accountType))) add(`${clientKey}: conta parcelada dentro do rotativo`)

  // --- X-004: consultas hard dentro da janela de 6 meses
  const cut = monthsAgoISO(6)
  const hardIn = inq.filter((q) => q.type === 'Hard' && q.date >= cut).length
  const hardAll = inq.filter((q) => q.type === 'Hard').length
  if (s.inquiries6mo !== hardIn)
    add(`${clientKey}: inquiries6mo=${s.inquiries6mo} mas dentro da janela (>= ${cut}) há ${hardIn} (total Hard ${hardAll}; datas ${inq.map((q) => q.date + '/' + q.type).join(' ')})`)
  const fInq = (rep.factors ?? []).find((f) => f.code === 'INQUIRIES')
  if (fInq) {
    const n = Number((/(\d+)/.exec(fInq.description) ?? [])[1])
    if (n !== s.inquiries6mo) add(`${clientKey}: fator INQUIRIES diz ${n} e o summary diz ${s.inquiries6mo}`)
    if (s.inquiries6mo === 0 && fInq.direction === 'negative') add(`${clientKey}: 0 consultas mas fator INQUIRIES negativo`)
    if (hardAll > hardIn) {
      // caso interessante: a tabela mostra Hard fora da janela
      console.log(`  nota ${clientKey}: tabela tem ${hardAll} Hard, tile conta ${hardIn} (fora da janela: ${inq.filter((q) => q.type === 'Hard' && q.date < cut).map((q) => q.date).join(',')})`)
    }
  }

  // --- X-005: idade da conta mais antiga por calendário
  const oldest = tl.map((t) => t.opened).sort()[0]
  const expected = Math.max(1, calendarAge(oldest))
  if (s.oldestAccountYears !== expected)
    add(`${clientKey}: oldestAccountYears=${s.oldestAccountYears} mas ${oldest} dá ${expected} por calendário`)
  const fAge = (rep.factors ?? []).find((f) => f.code === "CREDIT_AGE" || /mais antiga/i.test(f.description ?? ''))
  if (fAge) {
    const n = Number((/(\d+)\s*anos?/.exec(fAge.description) ?? [])[1])
    if (n && n !== s.oldestAccountYears) add(`${clientKey}: fator de idade diz ${n} e o summary diz ${s.oldestAccountYears}`)
  }

  // --- W-011 / W-012
  const hist = rep.scoreHistory ?? []
  if (hist.length && hist[hist.length - 1].score !== rep.score)
    add(`${clientKey}: histórico termina em ${hist[hist.length - 1].score} e o score é ${rep.score}`)
  const delinq = tl.filter((t) => t.paymentHistory.some((p) => p !== 'OK')).length
  const fPay = (rep.factors ?? []).find((f) => f.code === 'PAYMENT_HISTORY')
  if (fPay && delinq > 0 && fPay.direction === 'positive')
    add(`${clientKey}: fator PAYMENT_HISTORY positivo com ${delinq} conta(s) em atraso`)
}

console.log(`\nrelatórios auditados: ${checked}/${N}`)
console.log(`report-audit-ciclo7: ${findings.length} achado(s)`)
process.exit(findings.length ? 1 : 0)
