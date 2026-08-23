import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useSession } from '../lib/session'

const NAV = [
  { to: '/', label: 'Dashboard', ico: '◧' },
  { to: '/enrollment', label: 'Enrollment', ico: '＋' },
  { to: '/kba', label: 'Identity / KBA', ico: '⛨' },
  { to: '/report', label: 'Credit Report', ico: '▤' },
  { to: '/alerts', label: 'Alerts / Monitoring', ico: '⚑' },
  { to: '/playground', label: 'Web Components', ico: '◈' },
  { to: '/inspector', label: 'API Inspector', ico: '⟲' },
]

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('array-poc.theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch {
      /* ignore */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('array-poc.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}

function ModeBanner() {
  const { status, statusError, reloadStatus } = useSession()
  if (statusError) {
    return (
      <div className="banner error">
        <strong>WORKER OFFLINE</strong>
        <span>Não consegui falar com o worker em /api ({statusError}). Rode <code>npm run dev</code> na raiz.</span>
        <span className="spacer" />
        <button className="tiny" onClick={reloadStatus}>Tentar de novo</button>
      </div>
    )
  }
  if (!status) return <div className="banner">Verificando modo…</div>
  return (
    <div className={`banner ${status.mode}`}>
      <strong>MODO {status.mode.toUpperCase()}</strong>
      {status.mode === 'mock' ? (
        <span>
          Rodando com fixtures locais. Para chamar o sandbox da Array, preencha <code>SMARTY_AUTH_ID</code> e{' '}
          <code>SMARTY_AUTH_TOKEN</code> em <code>worker/.dev.vars</code> e reinicie o worker.
        </span>
      ) : (
        <span>
          Chamando a Array real em <code>{status.baseUrl}</code>.
        </span>
      )}
      <span className="spacer" />
      <button className="tiny" onClick={reloadStatus}>Recarregar status</button>
    </div>
  )
}

export function Layout() {
  const { theme, toggle } = useTheme()
  const { session, reset, status } = useSession()
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          <span>
            Array POC
            <small>{status ? `${status.arrayEnv} · ${status.mode}` : '…'}</small>
          </span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ico">{n.ico}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            <div className="label small muted">Sessão atual</div>
            <div className="small mono" style={{ wordBreak: 'break-all' }}>
              clientKey: {session.clientKey || '—'}
            </div>
            <div className="small mono" style={{ wordBreak: 'break-all' }}>
              userToken: {session.userToken ? `${session.userToken.slice(0, 10)}…` : '—'}
            </div>
          </div>
          <div className="row">
            <button className="tiny" onClick={toggle}>{theme === 'dark' ? '☀ Claro' : '☾ Escuro'}</button>
            <button className="tiny ghost" onClick={reset}>Limpar sessão</button>
          </div>
        </div>
      </aside>
      <main className="main">
        <ModeBanner />
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export function PageHead({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {children}
      </div>
      {actions}
    </div>
  )
}
