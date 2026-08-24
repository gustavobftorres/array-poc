/**
 * Escolha de porta livre para os scripts de QA (W2-014, ciclo 15).
 *
 * Antes, `verify-guide-ciclo7.mjs` e `regression-ciclo9.mjs` abriam portas
 * FIXAS (8899 e 8931). Com qualquer outro processo ocupando uma delas, o
 * upstream falso não subia, as requisições não chegavam e o script culpava o
 * PRODUTO — 5 e 8 "achados" falsos, e uma hora de QA perdida. Agora:
 *
 *  - `freePort(preferida)` usa a porta preferida se ela estiver livre e, se
 *    não, pede uma efêmera ao sistema;
 *  - `waitForPort(porta)` confirma que o upstream realmente subiu, e quem
 *    chama falha com "porta ocupada / upstream não subiu" em vez de acusar a
 *    aplicação.
 */
import net from 'node:net'

/** `true` se dá para escutar em `port` agora. */
export function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

/** Porta preferida se livre; senão uma efêmera atribuída pelo SO. */
export async function freePort(preferred) {
  if (preferred && (await portIsFree(preferred))) return preferred
  if (preferred) console.log(`[porta] ${preferred} está ocupada — usando uma porta efêmera livre.`)
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** Espera até `port` aceitar conexão. Devolve `false` no timeout. */
export async function waitForPort(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ok = await new Promise((resolve) => {
      const s = net.connect({ port, host: '127.0.0.1' })
      s.once('connect', () => s.destroy(void resolve(true)))
      s.once('error', () => resolve(false))
    })
    if (ok) return true
    if (Date.now() > deadline) return false
    await new Promise((r) => setTimeout(r, 100))
  }
}
