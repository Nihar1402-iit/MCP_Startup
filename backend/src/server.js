import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { hasMxRecord, isValidEmailFormat, isValidUrl } from "./auth.js";
import {
  addAuditLog,
  createAlertSetting,
  createUser,
  createTask,
  getUserByEmail,
  getTask,
  getUserIntegrations,
  listAlertSettings,
  listAuditLogs,
  listIntegrationUrls,
  listRuns,
  listTasks,
  listUsers,
  setUserPassword,
  upsertIntegrationUrl,
  upsertUserIntegrations
} from "./store.js";
import { runTask, syncAllSchedules, upsertSchedule } from "./scheduler.js";
import { db } from "./db.js";

export const app = express();
const port = process.env.PORT || 4000;
const jwtSecret = process.env.JWT_SECRET || "dev-only-change-me";
const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:5173";
const slackClientId = process.env.SLACK_CLIENT_ID || "";
const slackClientSecret = process.env.SLACK_CLIENT_SECRET || "";
const slackRedirectUri = process.env.SLACK_REDIRECT_URI || `${appBaseUrl}/slack/callback`;

app.use(cors());
app.use(express.json());

const templates = [
  {
    id: "node-eslint",
    name: "Code Quality Check (Node)",
    description: "Run install, lint, and tests for a Node project.",
    typicalTrigger: "On PR opened or every morning at 9:00 AM.",
    tasks: [
      { name: "Install", command: "npm ci" },
      { name: "Lint", command: "npm run lint" },
      { name: "Test", command: "npm test" }
    ]
  },
  {
    id: "daily-email-report",
    name: "Daily Email Report",
    description: "Prepare a daily status report and notify someone by email alert.",
    typicalTrigger: "Schedule at end of day (example: 0 18 * * 1-5).",
    tasks: [
      { name: "Draft report", command: "echo 'Daily report prepared for leadership'" },
      { name: "Export CSV summary", command: "echo 'coverage,build_status,deploy_status' > report.csv" },
      { name: "Notify recipients", command: "echo 'email notification queued'" }
    ]
  },
  {
    id: "slack-release-update",
    name: "Slack / Teams Release Update",
    description: "Prepare a release note and post it to your comms channel.",
    typicalTrigger: "After deployment success.",
    tasks: [
      { name: "Build release note", command: "echo 'Release notes generated'" },
      { name: "Post to channel", command: "echo 'slack/teams message sent'" }
    ]
  },
  {
    id: "github-issue-on-failure",
    name: "Create GitHub Issue on Failure",
    description: "Open a ticket automatically when checks fail.",
    typicalTrigger: "On lint/test/security scan failure.",
    tasks: [
      { name: "Capture failure context", command: "echo 'failure context captured'" },
      { name: "Create issue", command: "echo 'github issue created'" }
    ]
  },
  {
    id: "jira-ticket-on-regression",
    name: "Create Jira/Linear Ticket",
    description: "Raise a work item with title, summary, and priority.",
    typicalTrigger: "On regression detection or sprint prep schedule.",
    tasks: [
      { name: "Generate ticket payload", command: "echo 'ticket payload created'" },
      { name: "Create ticket", command: "echo 'jira/linear ticket created'" }
    ]
  },
  {
    id: "nightly-pipeline",
    name: "Run Nightly CI Pipeline",
    description: "Kick off your CI/CD workflow every night.",
    typicalTrigger: "Schedule at midnight.",
    tasks: [
      { name: "Trigger workflow", command: "echo 'ci pipeline triggered'" },
      { name: "Summarize result", command: "echo 'pipeline summary generated'" }
    ]
  },
  {
    id: "deploy-rollout",
    name: "Deploy / Rollout Command",
    description: "Run a deployment or promote a release safely.",
    typicalTrigger: "After QA passes or when a release tag is created.",
    tasks: [
      { name: "Run rollout script", command: "echo 'deploy command executed'" },
      { name: "Post deploy status", command: "echo 'deployment status published'" }
    ]
  },
  {
    id: "backup-snapshot",
    name: "Nightly Backup Snapshot",
    description: "Create a recurring backup before risky changes.",
    typicalTrigger: "Nightly backup or pre-migration checkpoint.",
    tasks: [
      { name: "Start snapshot", command: "echo 'backup snapshot started'" },
      { name: "Verify backup", command: "echo 'backup snapshot verified'" }
    ]
  }
];

function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    next();
  };
}

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "mcp-ops-backend", timestamp: new Date().toISOString() });
});
app.get("/api/health", (_, res) => {
  res.json({ ok: true, service: "mcp-ops-backend", timestamp: new Date().toISOString() });
});

app.post("/api/auth/validate-email", async (req, res) => {
  const { email } = req.body || {};
  const validFormat = isValidEmailFormat(email);
  if (!validFormat) return res.json({ validFormat, hasMx: false });
  const hasMx = await hasMxRecord(email);
  return res.json({ validFormat, hasMx });
});

app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  if (String(password).length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
  if (!isValidEmailFormat(email)) return res.status(400).json({ error: "Invalid email format" });
  const mx = await hasMxRecord(email);
  if (!mx) return res.status(400).json({ error: "Email domain does not look deliverable (MX check failed)" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = createUser({ email, passwordHash });
  if (!user) {
    const existing = getUserByEmail(email);
    if (!existing) return res.status(500).json({ error: "Could not create account" });
    if (existing.password_hash) return res.status(409).json({ error: "Account already exists" });
    setUserPassword(existing.id, passwordHash);
  }

  addAuditLog({ actor: email, action: "auth.signup", status: "success", metadata: { method: "password" } });
  res.status(201).json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const user = getUserByEmail(email);
  if (!user || !user.password_hash) return res.status(401).json({ error: "Invalid email or password" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  const token = jwt.sign({ user_id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: "7d" });
  addAuditLog({ actor: email, action: "auth.login", status: "success", metadata: { method: "password" } });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));
app.get("/api/integrations", auth, (req, res) => {
  const cfg = getUserIntegrations(req.user.user_id) || {};
  res.json({
    integrations: {
      slackWebhookUrl: cfg.slack_webhook_url || "",
      slackUserId: cfg.slack_user_id || "",
      smtpHost: cfg.smtp_host || "",
      smtpPort: cfg.smtp_port || "",
      smtpSecure: Boolean(cfg.smtp_secure),
      smtpUser: cfg.smtp_user || "",
      smtpPass: cfg.smtp_pass || "",
      smtpFrom: cfg.smtp_from || ""
    }
  });
});
app.post("/api/integrations", auth, requireRole(["admin", "editor"]), (req, res) => {
  if (req.body?.slackWebhookUrl && !isValidUrl(req.body.slackWebhookUrl)) {
    return res.status(400).json({ error: "Slack webhook URL must be a valid URL" });
  }
  const row = upsertUserIntegrations(req.user.user_id, req.body || {});
  addAuditLog({ actor: req.user.email, action: "integrations.update", status: "success" });
  res.json({ integrations: row });
});
app.get("/api/integrations/urls", auth, (req, res) => res.json({ urls: listIntegrationUrls(req.user.user_id) }));
app.post("/api/integrations/urls", auth, requireRole(["admin", "editor"]), (req, res) => {
  const { service, url } = req.body || {};
  if (!service || !url) return res.status(400).json({ error: "service and url are required" });
  if (!isValidUrl(url)) return res.status(400).json({ error: "Please provide a valid http/https URL" });
  const row = upsertIntegrationUrl(req.user.user_id, { service, url });
  addAuditLog({ actor: req.user.email, action: "integrations.url.upsert", status: "success", metadata: { service } });
  res.json({ item: row });
});

app.get("/api/integrations/slack/oauth/start", auth, (req, res) => {
  if (!slackClientId || !slackClientSecret) {
    return res.status(400).json({ error: "Slack OAuth not configured on server (missing SLACK_CLIENT_ID/SECRET)" });
  }
  const state = crypto.randomBytes(12).toString("hex");
  const scope = encodeURIComponent("incoming-webhook,chat:write");
  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(slackClientId)}&scope=${scope}&redirect_uri=${encodeURIComponent(slackRedirectUri)}&state=${state}`;
  res.json({ authUrl, state });
});

app.post("/api/integrations/slack/oauth/callback", auth, requireRole(["admin", "editor"]), async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Missing OAuth code" });
  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: slackClientId,
      client_secret: slackClientSecret,
      code,
      redirect_uri: slackRedirectUri
    })
  });
  const tokenBody = await tokenRes.json();
  if (!tokenBody.ok) return res.status(400).json({ error: `Slack OAuth failed: ${tokenBody.error || "unknown"}` });
  const slackUserId = tokenBody.authed_user?.id || tokenBody.bot_user_id || "";
  const webhook = tokenBody.incoming_webhook?.url || "";
  const integrations = upsertUserIntegrations(req.user.user_id, {
    ...(getUserIntegrations(req.user.user_id) || {}),
    slackUserId,
    slackWebhookUrl: webhook
  });
  addAuditLog({ actor: req.user.email, action: "integrations.slack.oauth", status: "success", metadata: { slackUserId } });
  res.json({ integrations });
});
app.get("/api/templates", auth, (_, res) => res.json({ templates }));

app.post("/api/templates/:id/install", auth, requireRole(["admin", "editor"]), (req, res) => {
  const tpl = templates.find((t) => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: "Template not found" });
  const created = tpl.tasks.map((t) =>
    createTask({ name: `${tpl.name} - ${t.name}`, command: t.command, triggerType: "manual", roleRequired: "editor" })
  );
  created.forEach((task) => upsertSchedule(task));
  addAuditLog({ actor: req.user.email, action: "template.install", status: "success", metadata: { templateId: tpl.id } });
  res.status(201).json({ tasks: created });
});

app.get("/api/tasks", auth, (_, res) => res.json({ tasks: listTasks() }));

app.post("/api/tasks", auth, requireRole(["admin", "editor"]), (req, res) => {
  const { name, command, triggerType, scheduleExpr, timeoutSec, env, roleRequired, enabled } = req.body || {};
  if (!name || !command) return res.status(400).json({ error: "name and command are required" });
  const task = createTask({ name, command, triggerType, scheduleExpr, timeoutSec, env, roleRequired, enabled });
  upsertSchedule(task);
  addAuditLog({ actor: req.user.email, action: "task.create", taskId: task.id, status: "success" });
  res.status(201).json({ task });
});

app.post("/api/tasks/:id/run", auth, requireRole(["admin", "editor"]), async (req, res) => {
  const result = await runTask(req.params.id, "manual", req.user.email);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

app.post("/api/tasks/:id/schedule", auth, requireRole(["admin", "editor"]), (req, res) => {
  const { scheduleExpr, enabled = true } = req.body || {};
  if (!scheduleExpr) return res.status(400).json({ error: "scheduleExpr is required" });
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  db.prepare("UPDATE tasks SET schedule_expr = ?, enabled = ?, updated_at = ? WHERE id = ?").run(
    scheduleExpr,
    enabled ? 1 : 0,
    new Date().toISOString(),
    req.params.id
  );

  const updated = getTask(req.params.id);
  upsertSchedule(updated);
  addAuditLog({
    actor: req.user.email,
    action: "task.schedule.update",
    taskId: updated.id,
    status: "success",
    metadata: { scheduleExpr, enabled }
  });

  res.json({ task: updated });
});

app.get("/api/runs", auth, (_, res) => res.json({ runs: listRuns() }));
app.get("/api/audit", auth, (_, res) => res.json({ logs: listAuditLogs() }));

app.get("/api/audit/export.csv", auth, (_, res) => {
  const logs = listAuditLogs();
  const head = "created_at,actor,action,task_id,status,metadata";
  const rows = logs.map((l) => {
    const safe = String(l.metadata_json || "{}").replaceAll('"', '""');
    return `${l.created_at},${l.actor},${l.action},${l.task_id || ""},${l.status},"${safe}"`;
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=audit.csv");
  res.send([head, ...rows].join("\n"));
});

app.get("/api/team", auth, requireRole(["admin"]), (_, res) => res.json({ users: listUsers() }));

app.post("/api/alerts", auth, requireRole(["admin", "editor"]), (req, res) => {
  const { channel, target, severity } = req.body || {};
  if (!channel || !target) return res.status(400).json({ error: "channel and target required" });
  const row = createAlertSetting({ userId: req.user.user_id, channel, target, severity });
  addAuditLog({ actor: req.user.email, action: "alert.create", status: "success", metadata: { channel, target } });
  res.status(201).json({ alert: row });
});

app.get("/api/alerts", auth, (req, res) => res.json({ alerts: listAlertSettings(req.user.user_id) }));

export function startServer() {
  syncAllSchedules();
  return app.listen(port, () => {
    console.log(`MCP-Ops backend listening on :${port}`);
  });
}
