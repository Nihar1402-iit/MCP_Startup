import cron from "node-cron";
import nodemailer from "nodemailer";
import { addAuditLog, createRun, finishRun, getTask, getUserIntegrations, listAllAlertSettings, listTasks } from "./store.js";

const jobs = new Map();

function simulateCommand(task) {
  const started = new Date();
  const output = [
    `[${started.toISOString()}] Starting task: ${task.name}`,
    `[command] ${task.command}`,
    "Running checks...",
    "Completed successfully"
  ].join("\n");
  return { status: "success", output };
}

async function sendSlack(webhook, text) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error(`slack webhook failed (${res.status})`);
}

async function sendEmail(cfg, to, subject, text) {
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: Number(cfg.smtp_port),
    secure: Boolean(cfg.smtp_secure),
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined
  });
  await transporter.sendMail({
    from: cfg.smtp_from || cfg.smtp_user,
    to,
    subject,
    text
  });
}

async function dispatchNotifications({ task, actor, runId, status }) {
  const alertSettings = listAllAlertSettings();
  const sent = [];

  for (const alert of alertSettings) {
    if (alert.severity === "failed" && status !== "failed") continue;
    const message = `[MCP-Ops] ${task.name} is ${status}. Triggered by ${actor}. Run ID: ${runId}`;
    const cfg = getUserIntegrations(alert.user_id);
    try {
      if (alert.channel === "slack") {
        if (!cfg?.slack_webhook_url) throw new Error("missing slack webhook in integrations");
        await sendSlack(cfg.slack_webhook_url, message);
      }
      if (alert.channel === "email") {
        if (!cfg?.smtp_host || !cfg?.smtp_port || !cfg?.smtp_user || !cfg?.smtp_pass) {
          throw new Error("missing smtp credentials in integrations");
        }
        await sendEmail(cfg, alert.target, `[MCP-Ops] ${task.name} ${status}`, message);
      }

      addAuditLog({
        actor: "notifier",
        action: `notify.${alert.channel}`,
        taskId: task.id,
        status: "success",
        metadata: {
          target: alert.target,
          owner: alert.owner_email,
          message
        }
      });
      sent.push(`${alert.channel}:${alert.target}`);
    } catch (err) {
      addAuditLog({
        actor: "notifier",
        action: `notify.${alert.channel}`,
        taskId: task.id,
        status: "failed",
        metadata: {
          target: alert.target,
          owner: alert.owner_email,
          message,
          error: err.message
        }
      });
    }
  }

  return sent;
}

export async function runTask(taskId, triggerSource = "manual", actor = "system") {
  const task = getTask(taskId);
  if (!task) {
    return { ok: false, error: "Task not found" };
  }

  const runId = createRun(task.id, triggerSource);

  try {
    const result = simulateCommand(task);
    const sentNotifications = await dispatchNotifications({ task, actor, runId, status: result.status });
    finishRun({ runId, status: result.status, output: result.output });
    addAuditLog({
      actor,
      action: "task.run",
      taskId: task.id,
      status: result.status,
      metadata: { triggerSource, runId, sentNotifications }
    });
    return { ok: true, runId, status: result.status };
  } catch (err) {
    finishRun({ runId, status: "failed", error: err.message });
    addAuditLog({
      actor,
      action: "task.run",
      taskId: task.id,
      status: "failed",
      metadata: { triggerSource, runId, error: err.message }
    });
    return { ok: false, runId, error: err.message };
  }
}

function syncTask(task) {
  if (jobs.has(task.id)) {
    jobs.get(task.id).stop();
    jobs.delete(task.id);
  }

  if (!task.enabled || !task.schedule_expr) {
    return;
  }

  if (!cron.validate(task.schedule_expr)) {
    addAuditLog({
      actor: "system",
      action: "task.schedule.invalid",
      taskId: task.id,
      status: "failed",
      metadata: { scheduleExpr: task.schedule_expr }
    });
    return;
  }

  const job = cron.schedule(task.schedule_expr, () => {
    runTask(task.id, "schedule", "scheduler");
  });

  jobs.set(task.id, job);
}

export function syncAllSchedules() {
  for (const task of listTasks()) {
    syncTask(task);
  }
}

export function upsertSchedule(task) {
  syncTask(task);
}
