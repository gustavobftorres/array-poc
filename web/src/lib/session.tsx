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
  /**
   * Which browser TAB mounted it (Z-001). `componentMountedAt` lives in
   * localStorage, which is shared by every tab of the origin, so a mount in one
   * tab used to light up step 4 in a brand-new tab where the CDN is blocked and
   * nothing ever mounted. The id below comes from `sessionStorage` (per tab,
   * survives reload), so step 4 only counts a mount that happened HERE.
   */
  componentMountedTab: string
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
  componentMountedTab: '',
  userTokenSource: '',
  reportOrderedAt: '',
  reportFetchedAt: '',
}
const KEY = 'array-poc.session'
const TAB_KEY = 'array-poc.tab'

/**
 * Stable id for THIS tab: written once into `sessionStorage` (per tab, kept
 * across reloads, never shared with another tab). Used by the Guia to decide
 * whether the mounted-component event happened in the tab being looked at.
 */
export function tabId(): string {
  try {
    const cached = sessionStorage.getItem(TAB_KEY)
    if (cached) return cached
    const id = `tab-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    sessionStorage.setItem(TAB_KEY, id)
    return id
  } catch {
    return 'tab-nostorage'
  }
}

/** The event fields of step 4, cleared together (unmount / failed CDN load). */
export const NO_COMPONENT_MOUNTED = {
  componentMountedAt: '',
  componentTag: '',
  componentMountedTab: '',
} as const

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
