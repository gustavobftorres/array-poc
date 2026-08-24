/**
 * Faz o `.env` da raiz ter uso REAL (Z-004).
 *
 * O `wrangler dev` só carrega variáveis de `worker/.dev.vars`; ele não lê o
 * `.env` da raiz. Como a raiz é onde o usuário espera colar as credenciais,
 * este script roda antes do `npm run dev` e **gera `worker/.dev.vars` a partir
 * do `.env` da raiz**, que passa a ser a fonte única.
 *
 * Regras (conservadoras de propósito — nunca apagar credencial de ninguém):
 *  - sem `.env` na raiz: não faz nada (a POC sobe em modo MOCK, ou usa o
 *    `worker/.dev.vars` que já existir);
 *  - com `.env` preenchido: reescreve `worker/.dev.vars` com o que está nele;
 *  - com `.env` existente mas **sem nenhum valor** e um `worker/.dev.vars` já
 *    preenchido: mantém o `.dev.vars` e avisa, em vez de zerar as chaves.
 *
 * Uso: node scripts/sync-env.mjs   (roda automaticamente no `npm run dev`)
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const ENV = path.join(root, '.env')
const DEV_VARS = path.join(root, 'worker/.dev.vars')
/**
 * Contrato canônico (docs/ARRAY_ENV_VARS.md) + aliases. A ordem é a que o
 * `.dev.vars` gerado usa; `SMARTY_*` só continua na lista para não quebrar quem
 * ainda tem o nome antigo no `.env` — o worker avisa que estão DEPRECADOS.
 */
const CANONICAL = [
  'ARRAY_APP_KEY',
  'ARRAY_SERVER_TOKEN',
  'ARRAY_BASE_URL',
  'ARRAY_ENV',
  'ARRAY_AUTH_MODE',
  'ARRAY_IDENTITY',
  'ARRAY_PRODUCT_CODE',
  'ARRAY_POLL_INTERVAL',
  'ARRAY_POLL_TIMEOUT',
  'ARRAY_LISTENER_URL',
  'ARRAY_WEBHOOK_TOKEN',
]
const ALIASES = ['ARRAY_CLIENT_TOKEN']
const DEPRECATED = ['SMARTY_AUTH_ID', 'SMARTY_AUTH_TOKEN']
const KEYS = [...CANONICAL, ...ALIASES, ...DEPRECATED]
/** As que decidem se a POC sai do modo mock. */
const CREDENTIAL_KEYS = ['ARRAY_APP_KEY', 'ARRAY_SERVER_TOKEN', 'ARRAY_CLIENT_TOKEN', ...DEPRECATED]

const log = (m) => console.log(`[sync-env] ${m}`)

function parse(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue // comentário ou linha vazia
    // Comentário no fim da linha (` # …`) não faz parte do valor; um valor
    // entre quotes é preservado inteiro.
    const raw = m[2].trim()
    const value = /^['"]/.test(raw) ? raw.replace(/^(['"])(.*)\1.*$/, '$2') : raw.split(/\s+#/)[0].trim()
    out[m[1]] = value
  }
  return out
}

if (!fs.existsSync(ENV)) {
  log('sem .env na raiz — nada a fazer (modo MOCK, ou worker/.dev.vars existente é usado como está)')
  process.exit(0)
}

const env = parse(ENV)
const filled = CREDENTIAL_KEYS.filter((k) => env[k])
const existing = parse(DEV_VARS)
const existingFilled = CREDENTIAL_KEYS.filter((k) => existing[k])

for (const k of DEPRECATED) {
  if (env[k]) {
    log(
      `${k} está DEPRECADO (nome errado): renomeie para ${k === 'SMARTY_AUTH_ID' ? 'ARRAY_APP_KEY' : 'ARRAY_SERVER_TOKEN'} no .env`,
    )
  }
}

if (filled.length === 0 && existingFilled.length > 0) {
  log('.env na raiz está sem credenciais e worker/.dev.vars já tem — mantendo o .dev.vars intacto')
  process.exit(0)
}

const body = [
  '# GERADO por scripts/sync-env.mjs a partir do .env da raiz. Não edite aqui:',
  '# edite o .env da raiz e rode `npm run dev` (ou `node scripts/sync-env.mjs`).',
  ...KEYS.filter((k) => env[k] !== undefined).map((k) => `${k}=${env[k]}`),
].join('\n') + '\n'

fs.mkdirSync(path.dirname(DEV_VARS), { recursive: true })
fs.writeFileSync(DEV_VARS, body)
log(
  filled.length
    ? `worker/.dev.vars gerado do .env da raiz (${filled.join(', ')} preenchido(s)) — modo ${env.ARRAY_ENV || 'sandbox'}`
    : 'worker/.dev.vars gerado do .env da raiz (sem credenciais: a POC sobe em modo MOCK)',
)
