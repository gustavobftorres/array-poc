-- Ciclo 13 — eventos de webhook recebidos no listener local.
--
-- A Array NÃO assina os webhooks e não manda header nem query param
-- (VERIFICADO: docs.array.com/docs/how-to-receive-webhooks). O segredo vive no
-- PATH da URL de listener (// UNVERIFIED: interpretação desta POC) e NUNCA é
-- gravado aqui — nem o path completo é: a auditoria mascara o token.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  client_key  TEXT,
  report_key  TEXT,
  -- 'array' = chegou no listener; 'simulated' = botão "simular" da POC
  source      TEXT NOT NULL DEFAULT 'array',
  payload     TEXT,                    -- JSON cru do evento, redigido
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events (received_at DESC);
