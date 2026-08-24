import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { Card, ErrorBox, Field, Json, TokenChip, useAsync } from '../components/ui'

/** Sandbox identity from docs/ARRAY_API_RESEARCH.md §5. */
const DEMO = {
  firstName: 'BANKER',
  lastName: 'COLDIRON',
  dob: '1974-04-18',
  ssn: '666230560',
  street: '3627 CALIFORNIA ST',
  city: 'GRAND PRAIRIE',
  state: 'TX',
  zip: '75052',
}

const EMPTY = { firstName: '', lastName: '', dob: '', ssn: '', street: '', city: '', state: '', zip: '' }
type Form = typeof EMPTY

/**
 * Whole years by CALENDAR — the same rule as `calendarAge` in the worker.
 * Dividing milliseconds by 365.25 days made somebody who turns 18 today pass
 * or fail depending on the hour of the day (W-006).
 */
export function calendarAge(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number)
  const [ty, tm, td] = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()]
  let age = ty - y
  if (tm < m || (tm === m && td < d)) age -= 1
  return age
}

/** Mirrors `dobSchema` in the worker: real date, in the past, adult (V-002). */
function dobError(dob: string, now = new Date()): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 'Formato YYYY-MM-DD'
  const [y, m, d] = dob.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'Data inexistente no calendário'
  const today = now.toISOString().slice(0, 10)
  if (dob > today) return 'Data no futuro'
  const age = calendarAge(dob, now)
  if (age < 18) return 'O consumidor precisa ter 18 anos ou mais'
  if (age > 120) return 'Idade implausível (>120 anos)'
  return undefined
}

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {}
  if (!f.firstName.trim()) e.firstName = 'Obrigatório'
  if (!f.lastName.trim()) e.lastName = 'Obrigatório'
  e.dob = dobError(f.dob)
  if (!e.dob) delete e.dob
  if (f.ssn.replace(/\D/g, '').length !== 9) e.ssn = '9 dígitos (use um SSN de teste 666…)'
  if (f.street.trim().length < 3) e.street = 'Rua obrigatória'
  if (f.city.trim().length < 2) e.city = 'Cidade obrigatória'
  if (!/^[A-Za-z]{2}$/.test(f.state)) e.state = 'UF de 2 letras (ex.: TX)'
  if (!/^\d{5}(-\d{4})?$/.test(f.zip)) e.zip = 'ZIP de 5 ou 9 dígitos'
  return e
}

export function Enrollment() {
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const { patch, status } = useSession()
  const nav = useNavigate()
  const req = useAsync<{ clientKey: string; appKey: string }>()

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length) return
    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      dob: form.dob,
      ssn: form.ssn,
      address: { street: form.street.trim(), city: form.city.trim(), state: form.state.toUpperCase(), zip: form.zip },
    }
    const res = await req.run(() => api.createUser(payload))
    if (res?.clientKey)
      patch({
        clientKey: res.clientKey,
        userToken: '',
        authToken: '',
        kbaAuthenticatedAt: '',
        userTokenMintedAt: '',
        componentMountedAt: '',
        componentTag: '',
        userTokenSource: '',
      })
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Enrollment</h1>
          <p>
            <code>POST /api/array/user</code> → <code>POST {status?.baseUrl ?? '{base}'}/user/v2</code>. Retorna o{' '}
            <code>clientKey</code>, identificador usado por todas as chamadas seguintes.
            {status?.mode === 'mock' && ' Em modo mock nada sai pela rede — essa base é só a que seria usada.'}
          </p>
        </div>
        <button className="ghost" onClick={() => setForm(DEMO)}>Preencher identidade de teste</button>
      </div>

      <div className="grid cols-2">
        <Card title="Consumidor">
          <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <Field label="Nome" value={form.firstName} onChange={set('firstName')} error={errors.firstName} placeholder="BANKER" />
              <Field label="Sobrenome" value={form.lastName} onChange={set('lastName')} error={errors.lastName} placeholder="COLDIRON" />
              <Field label="Data de nascimento" value={form.dob} onChange={set('dob')} error={errors.dob} placeholder="1974-04-18" />
              <Field label="SSN" value={form.ssn} onChange={set('ssn')} error={errors.ssn} placeholder="666230560" hint="Só os últimos 4 dígitos são gravados no D1." />
            </div>
            <Field label="Rua" value={form.street} onChange={set('street')} error={errors.street} placeholder="3627 CALIFORNIA ST" />
            <div className="grid cols-3" style={{ gap: 12 }}>
              <Field label="Cidade" value={form.city} onChange={set('city')} error={errors.city} placeholder="GRAND PRAIRIE" />
              <Field label="Estado" value={form.state} onChange={set('state')} error={errors.state} placeholder="TX" />
              <Field label="ZIP" value={form.zip} onChange={set('zip')} error={errors.zip} placeholder="75052" />
            </div>
            <div className="row">
              <button type="submit" className="primary" disabled={req.loading}>
                {req.loading ? 'Criando…' : 'Criar consumidor'}
              </button>
              <button type="button" className="ghost" onClick={() => { setForm(EMPTY); setErrors({}); req.setData(null); req.setError(null) }}>
                Limpar
              </button>
            </div>
          </form>
        </Card>

        <Card title="Resposta">
          <ErrorBox error={req.error} />
          {!req.data && !req.error && <p className="muted small">Envie o formulário para ver o <code>clientKey</code>.</p>}
          {req.data && (
            <div className="stack" style={{ gap: 12 }}>
              <div className="alert-box ok">Consumidor criado.</div>
              <dl className="kv">
                <dt>clientKey</dt>
                <dd><TokenChip value={req.data.clientKey} /></dd>
                <dt>appKey</dt>
                <dd><TokenChip value={req.data.appKey} mask /></dd>
              </dl>
              <Json data={req.data} open />
              <button className="primary" onClick={() => nav('/kba')}>Ir para KBA →</button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
