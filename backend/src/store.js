import { nanoid } from "nanoid";
import { db } from "./db.js";

const now = () => new Date().toISOString();

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS alert_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'failed',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const userCols = db.prepare("PRAGMA table_info(users)").all();
if (!userCols.some((c) => c.name === "password_hash")) {
  db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
}
const integrationCols = db.prepare("PRAGMA table_info(user_integrations)").all();
if (!integrationCols.some((c) => c.name === "slack_user_id")) {
  db.exec("ALTER TABLE user_integrations ADD COLUMN slack_user_id TEXT");
}

export const listTasks = () => db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all();

export function createTask(input) {
  const id = nanoid();
  const ts = now();
  db.prepare(`
    INSERT INTO tasks (id, name, command, trigger_type, schedule_expr, timeout_sec, env_json, role_required, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.command,
    input.triggerType || "manual",
    input.scheduleExpr || null,
    input.timeoutSec || 600,
    JSON.stringify(input.env || {}),
    input.roleRequired || "editor",
    input.enabled === false ? 0 : 1,
    ts,
    ts
  );
  return getTask(id);
}

export const getTask = (id) => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);

export function createRun(taskId, triggerSource) {
  const id = nanoid();
  db.prepare(
    `INSERT INTO runs (id, task_id, trigger_source, status, started_at) VALUES (?, ?, ?, 'running', ?)`
  ).run(id, taskId, triggerSource, now());
  return id;
}

export function finishRun({ runId, status, output, error }) {
  db.prepare(
    `UPDATE runs SET status = ?, finished_at = ?, output = ?, error = ? WHERE id = ?`
  ).run(status, now(), output || null, error || null, runId);
}

export const listRuns = () => db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 200").all();

export function addAuditLog({ actor, action, taskId, status, metadata = {} }) {
  db.prepare(
    `INSERT INTO audit_logs (id, actor, action, task_id, status, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(nanoid(), actor, action, taskId || null, status, JSON.stringify(metadata), now());
}

export const listAuditLogs = () => db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500").all();

export function findOrCreateUser(email) {
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (user) return user;
  const id = nanoid();
  db.prepare("INSERT INTO users (id, email, role, created_at) VALUES (?, ?, 'admin', ?)").run(id, email, now());
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function createUser({ email, passwordHash, role = "admin" }) {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return null;
  const id = nanoid();
  db.prepare("INSERT INTO users (id, email, role, created_at, password_hash) VALUES (?, ?, ?, ?, ?)").run(
    id,
    email,
    role,
    now(),
    passwordHash
  );
  return db.prepare("SELECT id, email, role, created_at FROM users WHERE id = ?").get(id);
}

export function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

export function setUserPassword(userId, passwordHash) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function createSession(userId) {
  const token = nanoid(32);
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, now());
  return token;
}

export function getSession(token) {
  return db
    .prepare(
      `SELECT s.token, u.id as user_id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
}

export function createAlertSetting(input) {
  const id = nanoid();
  db.prepare(
    `INSERT INTO alert_settings (id, user_id, channel, target, severity, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.userId, input.channel, input.target, input.severity || "failed", input.enabled === false ? 0 : 1, now());
  return db.prepare("SELECT * FROM alert_settings WHERE id = ?").get(id);
}

export function listAlertSettings(userId) {
  return db.prepare("SELECT * FROM alert_settings WHERE user_id = ? ORDER BY created_at DESC").all(userId);
}

export function listAllAlertSettings() {
  return db
    .prepare(
      `SELECT a.id, a.user_id, a.channel, a.target, a.severity, a.enabled, a.created_at, u.email AS owner_email
       FROM alert_settings a
       JOIN users u ON u.id = a.user_id
       WHERE a.enabled = 1
       ORDER BY a.created_at DESC`
    )
    .all();
}

export function listUsers() {
  return db.prepare("SELECT id, email, role, created_at FROM users ORDER BY created_at DESC").all();
}

export function upsertUserIntegrations(userId, input) {
  db.prepare(
    `INSERT INTO user_integrations
      (user_id, slack_webhook_url, slack_user_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
      slack_webhook_url = excluded.slack_webhook_url,
      slack_user_id = COALESCE(excluded.slack_user_id, user_integrations.slack_user_id),
      smtp_host = excluded.smtp_host,
      smtp_port = excluded.smtp_port,
      smtp_secure = excluded.smtp_secure,
      smtp_user = excluded.smtp_user,
      smtp_pass = excluded.smtp_pass,
      smtp_from = excluded.smtp_from,
      updated_at = excluded.updated_at`
  ).run(
    userId,
    input.slackWebhookUrl || null,
    input.slackUserId || null,
    input.smtpHost || null,
    input.smtpPort || null,
    input.smtpSecure ? 1 : 0,
    input.smtpUser || null,
    input.smtpPass || null,
    input.smtpFrom || null,
    now()
  );
  return getUserIntegrations(userId);
}

export function getUserIntegrations(userId) {
  return db.prepare("SELECT * FROM user_integrations WHERE user_id = ?").get(userId);
}

export function upsertIntegrationUrl(userId, { service, url }) {
  const existing = db.prepare("SELECT id FROM integration_urls WHERE user_id = ? AND service = ?").get(userId, service);
  const id = existing?.id || nanoid();
  db.prepare(
    `INSERT INTO integration_urls (id, user_id, service, url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      updated_at = excluded.updated_at`
  ).run(id, userId, service, url, now(), now());
  return db.prepare("SELECT * FROM integration_urls WHERE id = ?").get(id);
}

export function listIntegrationUrls(userId) {
  return db.prepare("SELECT id, service, url, created_at, updated_at FROM integration_urls WHERE user_id = ? ORDER BY updated_at DESC").all(userId);
}
