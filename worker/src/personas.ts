/**
 * Personas de teste do sandbox da Array (`ARRAY_IDENTITY`).
 *
 * A pesquisa (docs/ARRAY_ENV_VARS.md §5, docs/ARRAY_API_RESEARCH.md §5) fecha
 * dois pontos:
 *  - as identidades de sandbox são **personas nomeadas** publicadas pela Array
 *    (nome, DOB, SSN e endereço) — VERIFICADO;
 *  - o **nome** `ARRAY_IDENTITY` e o **formato** do valor são convenção local —
 *    // UNVERIFIED. Aqui aceitamos slug de persona OU JSON inline.
 *
 * Honestidade dos dados: só BANKER COLDIRON tem o pareamento
 * nome↔DOB↔SSN↔endereço capturado de fonte de primeira mão. Os outros três
 * nomes vêm de `docs.array.com/docs/sandbox-identities` (página parcialmente
 * gated): o NOME é verificado, os demais campos são placeholders desta POC, na
 * faixa de SSN `666…` (bloco inválido na SSA). Cada persona carrega esse selo,
 * e a UI o mostra.
 *
 * Alerta operacional (VERIFICADO): identidades de sandbox NÃO são canned —
 * autenticar uma delas puxa KBA real de bureau real. Sandbox não é offline.
 */
import type { Address } from './array/types'

export type PersonaConfidence = 'verified' | 'unverified'

export interface Persona {
  /** Slug canônico, usado em `ARRAY_IDENTITY`. */
  slug: string
  label: string
  firstName: string
  lastName: string
  dob: string
  ssn: string
  address: Address
  /** Selo dos CAMPOS (o nome é verificado em todas). */
  confidence: PersonaConfidence
  note: string
}

export const PERSONAS: Persona[] = [
  {
    slug: 'banker-coldiron',
    label: 'BANKER COLDIRON',
    firstName: 'BANKER',
    lastName: 'COLDIRON',
    dob: '1974-04-18',
    ssn: '666230560',
    address: { street: '3627 CALIFORNIA ST', city: 'GRAND PRAIRIE', state: 'TX', zip: '75052' },
    confidence: 'verified',
    note: 'Persona com nome, DOB, SSN e endereço capturados de fonte de primeira mão (§5).',
  },
  {
    slug: 'dalton-lot',
    label: 'DALTON LOT',
    firstName: 'DALTON',
    lastName: 'LOT',
    dob: '1981-07-09',
    ssn: '666451203',
    address: { street: '112 W COMMERCE ST', city: 'DALLAS', state: 'TX', zip: '75202' },
    confidence: 'unverified',
    // UNVERIFIED: DOB/SSN/endereço não publicados — placeholder desta POC.
    note: 'Nome verificado na lista de sandbox identities; DOB/SSN/endereço são placeholder desta POC (// UNVERIFIED) — troque pelos da sua conta.',
  },
  {
    slug: 'denise-hennessy',
    label: 'DENISE HENNESSY',
    firstName: 'DENISE',
    lastName: 'HENNESSY',
    dob: '1969-11-23',
    ssn: '666778914',
    address: { street: '4400 N CENTRAL EXPY', city: 'AUSTIN', state: 'TX', zip: '78751' },
    confidence: 'unverified',
    // UNVERIFIED: DOB/SSN/endereço não publicados — placeholder desta POC.
    note: 'Nome verificado na lista de sandbox identities; DOB/SSN/endereço são placeholder desta POC (// UNVERIFIED) — troque pelos da sua conta.',
  },
  {
    slug: 'donald-blair',
    label: 'DONALD BLAIR',
    firstName: 'DONALD',
    lastName: 'BLAIR',
    dob: '1957-02-14',
    ssn: '666092337',
    address: { street: '900 S MAIN ST', city: 'FORT WORTH', state: 'TX', zip: '76104' },
    confidence: 'unverified',
    // UNVERIFIED: DOB/SSN/endereço não publicados — placeholder desta POC.
    note: 'Nome verificado na lista de sandbox identities; DOB/SSN/endereço são placeholder desta POC (// UNVERIFIED) — troque pelos da sua conta.',
  },
]

export const DEFAULT_PERSONA_SLUG = 'banker-coldiron'

/** `BANKER_COLDIRON`, `Banker Coldiron`, `banker-coldiron` → `banker-coldiron`. */
export function personaSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export function findPersona(raw: string): Persona | undefined {
  const slug = personaSlug(raw)
  if (!slug) return undefined
  return PERSONAS.find((p) => p.slug === slug)
}

export interface ResolvedIdentity {
  firstName: string
  lastName: string
  dob: string
  ssn: string
  address: Address
  /** De onde a identidade veio. */
  source: 'default' | 'persona' | 'json'
  slug?: string
  label: string
  confidence: PersonaConfidence
  note: string
}

export function personaToIdentity(p: Persona, source: 'default' | 'persona'): ResolvedIdentity {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    dob: p.dob,
    ssn: p.ssn,
    address: p.address,
    source,
    slug: p.slug,
    label: p.label,
    confidence: p.confidence,
    note: p.note,
  }
}

export const DEFAULT_IDENTITY: ResolvedIdentity = personaToIdentity(
  PERSONAS.find((p) => p.slug === DEFAULT_PERSONA_SLUG)!,
  'default',
)

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Resolve `ARRAY_IDENTITY`. Aceita:
 *  - slug/nome de persona conhecida (`banker-coldiron`, `BANKER_COLDIRON`, …);
 *  - JSON inline `{firstName,lastName,dob,ssn,address:{street,city,state,zip}}`.
 *
 * Valor inválido NUNCA derruba o boot: cai no default e devolve um aviso.
 */
export function resolveIdentity(raw: string | undefined): {
  identity: ResolvedIdentity
  warning?: string
} {
  const value = str(raw)
  if (!value) return { identity: DEFAULT_IDENTITY }

  if (value.startsWith('{')) {
    try {
      const j = JSON.parse(value) as Record<string, unknown>
      const addr = (j.address ?? {}) as Record<string, unknown>
      const identity: ResolvedIdentity = {
        firstName: str(j.firstName) || DEFAULT_IDENTITY.firstName,
        lastName: str(j.lastName) || DEFAULT_IDENTITY.lastName,
        dob: str(j.dob) || DEFAULT_IDENTITY.dob,
        ssn: str(j.ssn).replace(/\D/g, '') || DEFAULT_IDENTITY.ssn,
        address: {
          street: str(addr.street) || DEFAULT_IDENTITY.address.street,
          city: str(addr.city) || DEFAULT_IDENTITY.address.city,
          state: (str(addr.state) || DEFAULT_IDENTITY.address.state).toUpperCase().slice(0, 2),
          zip: str(addr.zip) || DEFAULT_IDENTITY.address.zip,
        },
        source: 'json',
        label: `${str(j.firstName) || '?'} ${str(j.lastName) || '?'}`.trim().toUpperCase(),
        confidence: 'unverified',
        note: 'Identidade vinda de JSON inline em ARRAY_IDENTITY — a POC não valida se ela existe no sandbox da Array.',
      }
      return { identity }
    } catch {
      return {
        identity: DEFAULT_IDENTITY,
        warning: 'ARRAY_IDENTITY parece JSON mas não é JSON válido — usando a persona default (BANKER COLDIRON).',
      }
    }
  }

  const persona = findPersona(value)
  if (persona) return { identity: personaToIdentity(persona, 'persona') }
  return {
    identity: DEFAULT_IDENTITY,
    warning: `ARRAY_IDENTITY="${value}" não é uma persona conhecida (${PERSONAS.map((p) => p.slug).join(', ')}) nem um JSON — usando a persona default (BANKER COLDIRON).`,
  }
}
