import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, invalidateStatusCache, type Status } from './api'

/** Cross-page state: which consumer we are working with, plus its tokens. */
export interface Session {
  clientKey: string
  userToken: string
  authToken: string
  reportKey: string
  displayToken: string
  /**
   * Timestamps of the EVENTS the Guia de Integração reports as "feito nesta
   * sessão". Deriving each step from `userToken` alone made a seeded session
   * show 4/4 without a single KBA answer or a mounted component (X-006).
   */
  /** KBA answers accepted by POST /authenticate/v2 (userToken came from there). */
  kbaAuthenticatedAt: string
  /** The browser called POST /api/array/usertoken and got a token back. */
  userTokenMintedAt: string
  /** A web component was actually mounted in the DOM (CDN reachable). */
  componentMountedAt: string
  /** Tag of that component, for the "nesta sessão" line. */
  componentTag: string
  /** How the current userToken was obtained: KBA, usertoken route or /api/seed. */
  userTokenSource: '' | 'kba' | 'usertoken' | 'seed'
  /** POST /report/v2 returned reportKey + displayToken in this session. */
  reportOrderedAt: string
  /** GET /report/v2 returned a populated report in this session. */
  reportFetchedAt: string
}

const EMPTY: Session = {
  clientKey: '',
  userToken: '',
  authToken: '',
  reportKey: '',
  displayToken: '',
  kbaAuthenticatedAt: '',
  userTokenMintedAt: '',
  componentMountedAt: '',
  componentTag: '',
  userTokenSource: '',
  reportOrderedAt: '',
  reportFetchedAt: '',
}
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
