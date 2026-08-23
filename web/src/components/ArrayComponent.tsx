import { useEffect, useRef, useState } from 'react'

/**
 * Loads Array's web-component runtime + one per-component bundle from the CDN,
 * then mounts the custom element with the given attributes.
 *
 * The CDN (embed[.sandbox].array.io) is unreachable from locked-down networks —
 * in that case we render an explicit placeholder, never a blank box.
 */

type LoadState = 'idle' | 'loading' | 'ready' | 'failed'

const RUNTIME = 'array-web-component.js'
const LOAD_TIMEOUT_MS = 8000

const scriptCache = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
  const cached = scriptCache.get(src)
  if (cached) return cached
  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-array-src="${src}"]`)
    if (existing?.dataset.loaded === 'true') return resolve()
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.dataset.arraySrc = src
    const timer = setTimeout(() => reject(new Error(`Timeout ao carregar ${src}`)), LOAD_TIMEOUT_MS)
    el.onload = () => {
      clearTimeout(timer)
      el.dataset.loaded = 'true'
      resolve()
    }
    el.onerror = () => {
      clearTimeout(timer)
      reject(new Error(`Falha de rede ao carregar ${src}`))
    }
    document.head.appendChild(el)
  })
  scriptCache.set(src, p)
  // A failed load must not be cached as a permanent success/failure promise.
  p.catch(() => scriptCache.delete(src))
  return p
}

/** Placeholder used when we have no real 36-char appKey to put in the snippet. */
export const APP_KEY_PLACEHOLDER = '<SEU_APP_KEY_36_CHARS>'

/** Placeholder used when the session has no userToken to put in the snippet. */
export const USER_TOKEN_PLACEHOLDER = '<TOKEN_DO_SEU_BACKEND>'

/** Array's embed loader validates `appKey.length === 36`. */
export function isValidAppKey(appKey: string): boolean {
  return appKey.length === 36
}

/**
 * HTML attribute names are not free text: an invalid name cannot be emitted as
 * an attribute at all, so it is dropped instead of producing broken markup.
 */
const ATTR_NAME_RE = /^[A-Za-z][A-Za-z0-9_:.-]*$/
export function isValidAttrName(name: string): boolean {
  return ATTR_NAME_RE.test(name)
}

/**
 * Escape a value for a double-quoted HTML attribute. Without this, typing
 * `true" onload="alert(1)` into an attribute field emitted TWO attributes, one
 * of them an executable event handler in whatever page the dev pasted the
 * snippet into (W-002).
 */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape text going into an HTML comment (`--` would close it early). */
export function escapeComment(value: string): string {
  return value.replace(/--+/g, '-').replace(/[<>]/g, '')
}

export interface SnippetOptions {
  /**
   * Component reads consumer data and therefore needs a `userToken`. The
   * snippet then ALWAYS carries the attribute (placeholder when the session has
   * none) plus where the token comes from and how long it lives (W-003).
   */
  needsUserToken?: boolean
  /** TTL of the token in the current session, for the explanatory comment. */
  userTokenTtlMinutes?: number
  /** Endpoint of the POC that mints the token, quoted in the comment. */
  tokenEndpoint?: string
}

/**
 * Builds a snippet that can be pasted into a blank HTML file and work as-is
 * (on a network that reaches embed.array.io).
 *
 * Rules that the snippet has to respect — see docs/ARRAY_API_RESEARCH.md §4:
 *  - load order: the shared runtime `array-web-component.js` FIRST, then one
 *    bundle per component carrying `?appKey=` as a query param;
 *  - custom elements are NOT void elements: `<array-x />` is invalid HTML and
 *    would swallow the rest of the page. Always emit an explicit closing tag;
 *  - every component takes `appKey`; data components take `userToken`;
 *  - all components emit a single `array-event` on `window`;
 *  - every attribute name is validated and every value escaped (W-002);
 *  - the `userToken` is never emitted silently: the snippet says who mints it,
 *    that it is server-side work and that it expires (W-003).
 */
export function buildSnippet(
  cdn: string,
  tag: string,
  attrs: Record<string, string>,
  appKey: string,
  opts: SnippetOptions = {},
): string {
  const key = isValidAppKey(appKey) ? appKey : APP_KEY_PLACEHOLDER
  const ttl = opts.userTokenTtlMinutes ?? 60
  const endpoint = opts.tokenEndpoint ?? 'POST /authenticate/v2/usertoken'

  const hasTokenAttr = Object.prototype.hasOwnProperty.call(attrs, 'userToken')
  const needsToken = opts.needsUserToken ?? hasTokenAttr
  const sessionToken = attrs.userToken ?? ''

  const entries = Object.entries(attrs)
    .filter(([k]) => isValidAttrName(k))
    .filter(([k, v]) => v !== '' || (k === 'userToken' && needsToken))

  const attrText = entries
    .map(([k, v]) => {
      const raw = k === 'appKey' ? key : k === 'userToken' && v === '' ? USER_TOKEN_PLACEHOLDER : v
      return `\n  ${k}="${escapeAttr(raw)}"`
    })
    .join('')

  const dropped = Object.keys(attrs).filter((k) => !isValidAttrName(k))

  const appKeyNote = isValidAppKey(appKey)
    ? `<!-- appKey de exemplo (modo MOCK, 36 chars). Troque pelo appKey da sua conta Array. -->`
    : `<!-- Troque ${APP_KEY_PLACEHOLDER} pelo appKey da sua conta Array (UUID de 36 caracteres). -->`

  const tokenNote = needsToken
    ? [
        '',
        '<!-- userToken: quem emite, quanto vive e por que ele NÃO fica no HTML -->',
        `<!-- 1) o SEU backend chama ${escapeComment(endpoint)} usando o client token`,
        '        (segredo — nunca vai ao browser) e devolve o userToken ao seu frontend. -->',
        sessionToken
          ? `<!-- 2) o valor abaixo é o token DESTA sessão da POC e expira em ~${ttl} min\n` +
            '        (campo expiresAt da resposta) — não versione nem publique esse valor. -->'
          : `<!-- 2) esta sessão da POC não tem userToken: o atributo sai com o placeholder\n` +
            `        ${escapeComment(USER_TOKEN_PLACEHOLDER)}. Sem token o componente não busca dados. -->`,
        '<!-- 3) injete o atributo a cada render (server-side render ou',
        "        el.setAttribute('userToken', token)); um token expirado = componente vazio. -->",
      ].join('\n')
    : ''

  const droppedNote = dropped.length
    ? `\n<!-- atributo(s) ignorado(s) por nome inválido em HTML: ${escapeComment(dropped.join(', '))} -->`
    : ''

  return [
    appKeyNote + droppedNote + tokenNote,
    '',
    '<!-- 1. runtime compartilhado (sempre primeiro, sem appKey) -->',
    `<script src="${escapeAttr(cdn + RUNTIME)}"></script>`,
    '',
    '<!-- 2. bundle do componente, com o appKey como query param -->',
    `<script src="${escapeAttr(`${cdn}${tag}.js?appKey=${key}`)}"></script>`,
    '',
    '<!-- 3. o elemento: custom element PRECISA de tag de fechamento -->',
    `<${tag}${attrText}\n></${tag}>`,
    '',
    '<!-- 4. todos os componentes emitem um único evento no window -->',
    '<script>',
    "  window.addEventListener('array-event', (e) => {",
    "    console.log('array-event', e.detail)",
    '  })',
    '</script>',
  ].join('\n')
}

export interface ArrayComponentProps {
  cdn: string
  tag: string
  attrs: Record<string, string>
  appKey: string
  /** What the component would render — shown when the CDN is unreachable. */
  describe?: string
  expects?: string[]
}

export function ArrayComponent({ cdn, tag, attrs, appKey, describe, expects }: ArrayComponentProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<LoadState>('idle')
  const [error, setError] = useState<string>('')
  const [attempt, setAttempt] = useState(0)
  const attrKey = JSON.stringify(attrs)

  useEffect(() => {
    let alive = true
    setState('loading')
    setError('')
    const bundle = `${cdn}${tag}.js${appKey ? `?appKey=${encodeURIComponent(appKey)}` : ''}`
    Promise.all([loadScript(`${cdn}${RUNTIME}`), loadScript(bundle)])
      .then(() => alive && setState('ready'))
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
        setState('failed')
      })
    return () => {
      alive = false
    }
  }, [cdn, tag, appKey, attempt])

  // Custom elements are mounted imperatively: React 18 does not set arbitrary
  // camelCase attributes (appKey, userToken) on unknown tags reliably.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.replaceChildren()
    if (state !== 'ready') return
    const el = document.createElement(tag)
    // An invalid attribute name makes setAttribute throw (InvalidCharacterError)
    // and would blank the whole page — skip it, like the snippet does (W-002).
    for (const [k, v] of Object.entries(attrs)) {
      if (v === '' || !isValidAttrName(k)) continue
      try {
        el.setAttribute(k, v)
      } catch {
        /* ignore attribute names the DOM refuses */
      }
    }
    host.appendChild(el)
    return () => host.replaceChildren()
  }, [state, tag, attrKey, attrs])

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row small">
        <span className={`badge ${state === 'ready' ? 'ok' : state === 'failed' ? 'danger' : 'neutral'}`}>
          {state === 'ready' ? 'runtime carregado' : state === 'failed' ? 'CDN inacessível' : 'carregando runtime…'}
        </span>
        <span className="muted mono">{cdn}{tag}.js</span>
        {state === 'failed' && (
          <button type="button" className="tiny" onClick={() => setAttempt((a) => a + 1)}>
            Tentar de novo
          </button>
        )}
      </div>

      <div className="component-host">
        {state === 'failed' ? (
          <div className="placeholder">
            <h4>{`<${tag}>`} não pôde ser carregado</h4>
            <p style={{ marginBottom: 8 }}>{error}</p>
            <p>
              O CDN da Array (<code>{cdn}</code>) está bloqueado pelo proxy de egresso deste ambiente. Em uma rede com
              acesso liberado, o snippet abaixo renderiza o componente real da Array aqui.
            </p>
            {describe && <p><strong>O que apareceria:</strong> {describe}</p>}
            {expects?.length ? (
              <ul>
                {expects.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : state === 'ready' ? (
          <div ref={hostRef} />
        ) : (
          <div className="placeholder">Carregando {tag}…</div>
        )}
      </div>
    </div>
  )
}

export interface ArrayEventLog {
  at: string
  detail: unknown
}

/** Subscribes to the single `array-event` all Array components emit on window. */
export function useArrayEvents(): { events: ArrayEventLog[]; clear: () => void } {
  const [events, setEvents] = useState<ArrayEventLog[]>([])
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setEvents((prev) => [{ at: new Date().toISOString(), detail }, ...prev].slice(0, 50))
    }
    window.addEventListener('array-event', handler)
    return () => window.removeEventListener('array-event', handler)
  }, [])
  return { events, clear: () => setEvents([]) }
}
