-- Ciclo 15 (W2-009) — idempotência dos eventos de webhook.
--
-- A Array não assina os webhooks e pode reentregar a mesma notificação (é o
-- comportamento normal de qualquer entregador at-least-once), então o listener
-- precisa de uma chave de deduplicação. Ela é derivada do corpo:
-- `id`/`eventId` quando existe, senão `eventType + reportKey + clientKey`.
-- Nunca contém o ARRAY_WEBHOOK_TOKEN — o segredo vive no path e é mascarado
-- antes de qualquer gravação.
ALTER TABLE webhook_events ADD COLUMN dedupe_key TEXT;
CREATE INDEX IF NOT EXISTS idx_webhook_events_dedupe ON webhook_events (dedupe_key);
