-- Array POC — schema inicial (D1 / SQLite).
-- Nada de PII sensível bruta: SSN é guardado apenas como últimos 4 dígitos.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  client_key  TEXT NOT NULL UNIQUE,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  dob         TEXT NOT NULL,
  ssn_last4   TEXT NOT NULL,
  address     TEXT NOT NULL,           -- JSON {street,city,state,zip}
  mode        TEXT NOT NULL DEFAULT 'mock',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);

-- Tokens de usuário (curta duração) usados pelos Web Components.
CREATE TABLE IF NOT EXISTS user_tokens (
  id          TEXT PRIMARY KEY,
  client_key  TEXT NOT NULL,
  user_token  TEXT NOT NULL,
  auth_token  TEXT,
  ttl_minutes INTEGER,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_tokens_client_key ON user_tokens (client_key, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  client_key    TEXT NOT NULL,
  report_key    TEXT NOT NULL,
  display_token TEXT NOT NULL,
  product_code  TEXT NOT NULL,
  payload       TEXT,                  -- JSON do relatório (quando já buscado)
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_client_key ON reports (client_key, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_report_key ON reports (report_key);

CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  alert_id    TEXT NOT NULL,
  client_key  TEXT NOT NULL,
  bureau      TEXT,
  type        TEXT,
  severity    TEXT,
  title       TEXT,
  description TEXT,
  payload     TEXT,                    -- JSON cru do alerta
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_alert_id ON alerts (alert_id);
CREATE INDEX IF NOT EXISTS idx_alerts_client_key ON alerts (client_key, created_at DESC);

-- Auditoria de TODAS as chamadas à nossa API (com segredos redigidos).
CREATE TABLE IF NOT EXISTS api_calls (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  request     TEXT,                    -- JSON redigido
  response    TEXT,                    -- JSON redigido
  mode        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_calls_ts ON api_calls (ts DESC);
