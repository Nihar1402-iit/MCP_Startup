import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import request from "supertest";

process.env.DB_PATH = `${process.cwd()}/data/mcp_ops_test.db`;
try {
  fs.unlinkSync(process.env.DB_PATH);
} catch {}
try {
  fs.unlinkSync(`${process.env.DB_PATH}-wal`);
  fs.unlinkSync(`${process.env.DB_PATH}-shm`);
} catch {}

const { app } = await import("../src/server.js");

let token = "";
let taskId = "";

test("login and get session", async () => {
  const signup = await request(app).post("/api/auth/signup").send({ email: "test@gmail.com", password: "testpass123" });
  assert.equal(signup.status, 201);

  const login = await request(app).post("/api/auth/login").send({ email: "test@gmail.com", password: "testpass123" });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  token = login.body.token;

  const me = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "test@gmail.com");
});

test("install template and list tasks", async () => {
  const install = await request(app)
    .post("/api/templates/node-eslint/install")
    .set("Authorization", `Bearer ${token}`)
    .send();
  assert.equal(install.status, 201);

  const tasks = await request(app).get("/api/tasks").set("Authorization", `Bearer ${token}`);
  assert.equal(tasks.status, 200);
  assert.ok(tasks.body.tasks.length >= 3);
  taskId = tasks.body.tasks[0].id;
});

test("run task, add schedule, add alert", async () => {
  const integrations = await request(app)
    .post("/api/integrations")
    .set("Authorization", `Bearer ${token}`)
    .send({
      slackWebhookUrl: "https://hooks.slack.com/services/demo",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "bot@example.com",
      smtpPass: "secret"
    });
  assert.equal(integrations.status, 200);

  const run = await request(app).post(`/api/tasks/${taskId}/run`).set("Authorization", `Bearer ${token}`).send();
  assert.equal(run.status, 200);

  const schedule = await request(app)
    .post(`/api/tasks/${taskId}/schedule`)
    .set("Authorization", `Bearer ${token}`)
    .send({ scheduleExpr: "*/15 * * * *" });
  assert.equal(schedule.status, 200);

  const alert = await request(app)
    .post("/api/alerts")
    .set("Authorization", `Bearer ${token}`)
    .send({ channel: "slack", target: "#alerts", severity: "failed" });
  assert.equal(alert.status, 201);
});

test("audit csv export", async () => {
  const csv = await request(app).get("/api/audit/export.csv").set("Authorization", `Bearer ${token}`);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /created_at,actor,action/);
});
