import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { Card, ErrorBox, Json, TokenChip, useAsync } from '../components/ui'

type Questions = Awaited<ReturnType<typeof api.kbaQuestions>>
type AuthResult = Awaited<ReturnType<typeof api.answerKba>>

export function Kba() {
  const { session, patch, status } = useSession()
  const [clientKey, setClientKey] = useState(session.clientKey)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const questions = useAsync<Questions>()
  const auth = useAsync<AuthResult>()
  const token = useAsync<Awaited<ReturnType<typeof api.userToken>>>()
  const nav = useNavigate()

  const fetchQuestions = async () => {
    setAnswers({})
    auth.setData(null)
    const res = await questions.run(() => api.kbaQuestions(clientKey.trim()))
    if (res) patch({ clientKey: clientKey.trim(), authToken: res.authToken })
  }

  const submit = async () => {
    if (!questions.data) return
    const res = await auth.run(() =>
      api.answerKba({ clientKey: clientKey.trim(), authToken: questions.data!.authToken, answers }),
    )
    if (res?.userToken) patch({ userToken: res.userToken })
  }

  const mint = async () => {
    const res = await token.run(() => api.userToken({ clientKey: clientKey.trim(), ttlInMinutes: 60 }))
    if (res?.userToken) patch({ userToken: res.userToken })
  }

  const answered = questions.data ? Object.keys(answers).length : 0
  const total = questions.data?.questions.length ?? 0

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Identity / KBA</h1>
          <p>
            <code>GET /authenticate/v2</code> traz as perguntas + <code>authToken</code>;{' '}
            <code>POST /authenticate/v2</code> devolve o <code>userToken</code> do consumidor — o que alimenta os web
            components. Em modo mock a resposta correta é sempre a primeira opção (exceto Q3, que é a segunda).
          </p>
        </div>
      </div>

      <Card title="Consumidor">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 320px' }}>
            <label>clientKey</label>
            <input value={clientKey} onChange={(e) => setClientKey(e.target.value)} placeholder="cole o clientKey do enrollment" />
          </div>
          <button className="primary" onClick={fetchQuestions} disabled={!clientKey.trim() || questions.loading}>
            {questions.loading ? 'Buscando…' : 'Buscar perguntas'}
          </button>
          <button onClick={mint} disabled={!clientKey.trim() || token.loading}>
            {token.loading ? 'Gerando…' : 'Gerar userToken direto (server-side)'}
          </button>
        </div>
        <p className="hint">Base: <code>{status?.baseUrl}</code></p>
        <ErrorBox error={questions.error} />
        <ErrorBox error={token.error} />
      </Card>

      {token.data && (
        <Card title="userToken emitido via POST /authenticate/v2/usertoken">
          <dl className="kv">
            <dt>userToken</dt>
            <dd><TokenChip value={token.data.userToken} /></dd>
            <dt>ttlInMinutes</dt>
            <dd>{token.data.ttlInMinutes}</dd>
            <dt>expira em</dt>
            <dd>{token.data.expiresAt}</dd>
          </dl>
          <Json data={token.data} />
        </Card>
      )}

      {questions.data && (
        <Card
          title={`Perguntas (${answered}/${total} respondidas)`}
          actions={<span className="badge info">authToken {questions.data.authToken.slice(0, 8)}…</span>}
        >
          <div className="stack">
            {questions.data.questions.map((q, qi) => (
              <fieldset key={q.questionId} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <legend className="small muted">{qi + 1}. {q.questionId}</legend>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{q.question}</div>
                <div className="stack" style={{ gap: 6 }}>
                  {q.answers.map((a) => (
                    <label key={a.answerId} className="checkbox-row" style={{ fontWeight: 400, color: 'var(--text)', marginBottom: 0 }}>
                      <input
                        type="radio"
                        name={q.questionId}
                        checked={answers[q.questionId] === a.answerId}
                        onChange={() => setAnswers((s) => ({ ...s, [q.questionId]: a.answerId }))}
                      />
                      {a.answer}
                      <span className="badge neutral">{a.answerId}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="row">
              <button className="primary" onClick={submit} disabled={answered < total || auth.loading}>
                {auth.loading ? 'Enviando…' : 'Enviar respostas'}
              </button>
              <button
                className="ghost"
                onClick={() =>
                  setAnswers(
                    Object.fromEntries(
                      questions.data!.questions.map((q) => [q.questionId, q.questionId === 'Q3' ? q.answers[1].answerId : q.answers[0].answerId]),
                    ),
                  )
                }
              >
                Preencher respostas corretas (mock)
              </button>
            </div>
            <Json data={{ clientKey, authToken: questions.data.authToken, answers }} label="payload que será enviado" />
          </div>
        </Card>
      )}

      <ErrorBox error={auth.error} />
      {auth.data && (
        <Card title="Autenticado">
          <div className="alert-box ok">Status: {auth.data.status}</div>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>userToken</dt>
            <dd><TokenChip value={auth.data.userToken} /></dd>
            <dt>ttlInMinutes</dt>
            <dd>{auth.data.ttlInMinutes ?? '—'}</dd>
          </dl>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => nav('/report')}>Pedir relatório →</button>
            <button onClick={() => nav('/playground')}>Usar nos componentes →</button>
          </div>
          <div style={{ marginTop: 12 }}>
            <Json data={auth.data} />
          </div>
        </Card>
      )}
    </div>
  )
}
