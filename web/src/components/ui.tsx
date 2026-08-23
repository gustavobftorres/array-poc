import { useEffect, useId, useState, type ReactNode } from 'react'
import { HttpError, type ApiError } from '../lib/api'

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <h3>
          <span>{title}</span>
          {actions}
        </h3>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, badge }: { label: string; value: ReactNode; badge?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {badge}
    </div>
  )
}

export function Json({ data, label = 'JSON cru', open = false }: { data: unknown; label?: string; open?: boolean }) {
  const [show, setShow] = useState(open)
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button type="button" className="tiny ghost" onClick={() => setShow((s) => !s)}>
          {show ? 'Esconder' : 'Ver'} {label}
        </button>
        <CopyButton text={JSON.stringify(data, null, 2)} label="Copiar JSON" />
      </div>
      {show && <pre className="json">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1400)
    return () => clearTimeout(t)
  }, [done])
  return (
    <button
      type="button"
      className="tiny"
      onClick={() => {
        // Clipboard API can be unavailable (insecure context) — degrade quietly.
        navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => setDone(false),
        )
      }}
    >
      {done ? 'Copiado' : label}
    </button>
  )
}

/** Renders any thrown error, including zod field details returned by the worker. */
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  const payload: ApiError | null = error instanceof HttpError ? error.payload : null
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="alert-box err">
      <strong>{message}</strong>
      {payload?.hint && <div style={{ marginTop: 6 }}>{payload.hint}</div>}
      {payload?.error?.length ? (
        <ul style={{ margin: '8px 0 0 18px' }}>
          {payload.error.map((e, i) => (
            <li key={i}>
              <code>{e.param}</code> ({e.location}): {e.message}
            </li>
          ))}
        </ul>
      ) : null}
      {payload?.upstream ? <pre>{JSON.stringify(payload.upstream, null, 2)}</pre> : null}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted small" style={{ margin: 0 }}>{children}</p>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row small muted" style={{ gap: 6 }}>
      <span className="spinner" /> {label ?? 'Carregando…'}
    </span>
  )
}

export function TokenChip({ value, mask = false }: { value: string; mask?: boolean }) {
  if (!value) return <span className="muted small">—</span>
  const shown = mask && value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
  return (
    <span className="token">
      {shown}
      <CopyButton text={value} label="⧉" />
    </span>
  )
}

export function Field({
  label,
  value,
  onChange,
  error,
  placeholder,
  hint,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  placeholder?: string
  hint?: string
  type?: string
}) {
  // Generated id keeps label/input associated for pointer, keyboard and AT.
  const id = useId()
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <div className="field-error" id={`${id}-err`}>{error}</div>
      ) : hint ? (
        <div className="hint" id={`${id}-hint`}>{hint}</div>
      ) : null}
    </div>
  )
}

export function useAsync<T>() {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const run = async (fn: () => Promise<T>) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fn()
      setData(res)
      return res
    } catch (e) {
      setError(e)
      return null
    } finally {
      setLoading(false)
    }
  }
  return { data, setData, error, setError, loading, run }
}
