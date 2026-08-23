import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, invalidateStatusCache, type Status } from './api'

/** Cross-page state: which consumer we are working with, plus its tokens. */
export interface Session {
  clientKey: string
  userToken: string
  authToken: string
  reportKey: string
  displayToken: string
}

const EMPTY: Session = { clientKey: '', userToken: '', authToken: '', reportKey: '', displayToken: '' }
const KEY = 'array-poc.session'

interface Ctx {
  session: Session
  patch: (p: Partial<Session>) => void
  reset: () => void
  status: Status | null
  statusError: string | null
  reloadStatus: () => void
}

const SessionCtx = createContext<Ctx | null>(null)

function load(): Session {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Session) } : EMPTY
  } catch {
    return EMPTY
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(load)
  const [status, setStatus] = useState<Status | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(session))
    } catch {
      /* private mode — ignore */
    }
  }, [session])

  useEffect(() => {
    let alive = true
    api
      .status()
      .then((s) => alive && (setStatus(s), setStatusError(null)))
      .catch((e: Error) => alive && setStatusError(e.message))
    return () => {
      alive = false
    }
  }, [tick])

  const patch = useCallback((p: Partial<Session>) => setSession((s) => ({ ...s, ...p })), [])
  const reset = useCallback(() => setSession(EMPTY), [])
  const reloadStatus = useCallback(() => {
    // An explicit reload must bypass the short-lived /status memo (W-014).
    invalidateStatusCache()
    setTick((t) => t + 1)
  }, [])

  const value = useMemo(
    () => ({ session, patch, reset, status, statusError, reloadStatus }),
    [session, patch, reset, status, statusError, reloadStatus],
  )
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession(): Ctx {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
