import { useEffect, useMemo, useState } from "react";
import { api } from "./api";

function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("founder@mcpops.dev");
  const [password, setPassword] = useState("");
  const [integrations, setIntegrations] = useState({
    slackWebhookUrl: "",
    smtpHost: "",
    smtpPort: "587",
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    smtpFrom: ""
  });
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await onLogin(email, password, mode, integrations);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="panel login">
      <h1>MCP-Ops</h1>
      <p>Sign in with your account to launch your automation dashboard.</p>
      <form onSubmit={submit} className="task-form one-col">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (8+ characters)"
          required
        />
        <input
          placeholder="Slack incoming webhook URL (optional)"
          value={integrations.slackWebhookUrl}
          onChange={(e) => setIntegrations({ ...integrations, slackWebhookUrl: e.target.value })}
        />
        <input
          placeholder="SMTP host (optional)"
          value={integrations.smtpHost}
          onChange={(e) => setIntegrations({ ...integrations, smtpHost: e.target.value })}
        />
        <input
          placeholder="SMTP port (optional)"
          value={integrations.smtpPort}
          onChange={(e) => setIntegrations({ ...integrations, smtpPort: e.target.value })}
        />
        <input
          placeholder="SMTP username (optional)"
          value={integrations.smtpUser}
          onChange={(e) => setIntegrations({ ...integrations, smtpUser: e.target.value })}
        />
        <input
          type="password"
          placeholder="SMTP password / app password (optional)"
          value={integrations.smtpPass}
          onChange={(e) => setIntegrations({ ...integrations, smtpPass: e.target.value })}
        />
        <input
          placeholder="SMTP from email (optional)"
          value={integrations.smtpFrom}
          onChange={(e) => setIntegrations({ ...integrations, smtpFrom: e.target.value })}
        />
        <label>
          <input
            type="checkbox"
            checked={Boolean(integrations.smtpSecure)}
            onChange={(e) => setIntegrations({ ...integrations, smtpSecure: e.target.checked })}
          />{" "}
          Use secure SMTP (SSL/TLS)
        </label>
        <button type="submit">{mode === "login" ? "Log In" : "Create Account"}</button>
      </form>
      <div className="actions">
        <button className="ghost" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </div>
      {error ? <small className="danger">{error}</small> : null}
    </section>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [runs, setRuns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [team, setTeam] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", command: "", scheduleExpr: "", roleRequired: "editor" });
  const [alertForm, setAlertForm] = useState({ channel: "slack", target: "", severity: "failed" });
  const [integrations, setIntegrations] = useState({
    slackWebhookUrl: "",
    smtpHost: "",
    smtpPort: "587",
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    smtpFrom: ""
  });
  const [emailAutomation, setEmailAutomation] = useState({
    recipient: "",
    subject: "Daily startup update",
    message: "Hi team, here is today's update.",
    scheduleExpr: "0 18 * * 1-5"
  });

  const isAdmin = useMemo(() => user?.role === "admin", [user]);

  async function login(email, password, mode, onboardingIntegrations) {
    if (mode === "signup") await api.signup(email, password);
    await api.login(email, password);
    const hasIntegrations = Object.values(onboardingIntegrations || {}).some((v) => {
      if (typeof v === "boolean") return v;
      return String(v || "").trim() !== "";
    });
    if (hasIntegrations) {
      await api.saveIntegrations({
        ...onboardingIntegrations,
        smtpPort: Number(onboardingIntegrations.smtpPort || 0)
      });
    }
    await load();
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const me = await api.me();
      setUser(me.user);
      const [tplRes, tasksRes, runsRes, logsRes, alertsRes, integrationsRes] = await Promise.all([
        api.listTemplates(),
        api.listTasks(),
        api.listRuns(),
        api.listAudit(),
        api.listAlerts(),
        api.getIntegrations()
      ]);
      setTemplates(tplRes.templates || []);
      setTasks(tasksRes.tasks || []);
      setRuns(runsRes.runs || []);
      setLogs(logsRes.logs || []);
      setAlerts(alertsRes.alerts || []);
      setIntegrations(integrationsRes.integrations || {});
      if (me.user.role === "admin") {
        const teamRes = await api.listTeam();
        setTeam(teamRes.users || []);
      }
    } catch (err) {
      setUser(null);
      if (!String(err.message).toLowerCase().includes("missing auth token")) setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createTask(e) {
    e.preventDefault();
    try {
      await api.createTask({
        name: form.name,
        command: form.command,
        scheduleExpr: form.scheduleExpr || undefined,
        triggerType: form.scheduleExpr ? "schedule" : "manual",
        roleRequired: form.roleRequired
      });
      setForm({ name: "", command: "", scheduleExpr: "", roleRequired: "editor" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function runTask(id) {
    try {
      await api.runTask(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addSchedule(id) {
    const scheduleExpr = window.prompt("Cron expression (example: */30 * * * *)");
    if (!scheduleExpr) return;
    try {
      await api.scheduleTask(id, { scheduleExpr, enabled: true });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function installTemplate(id) {
    try {
      await api.installTemplate(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createAlert(e) {
    e.preventDefault();
    try {
      await api.createAlert(alertForm);
      setAlertForm({ channel: "slack", target: "", severity: "failed" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createEmailAutomation(e) {
    e.preventDefault();
    try {
      const taskName = `Email: ${emailAutomation.subject}`;
      const command = `echo "${emailAutomation.message.replaceAll('"', "'")}"`;
      await api.createTask({
        name: taskName,
        command,
        scheduleExpr: emailAutomation.scheduleExpr || undefined,
        triggerType: emailAutomation.scheduleExpr ? "schedule" : "manual",
        roleRequired: "editor"
      });
      await api.createAlert({
        channel: "email",
        target: emailAutomation.recipient,
        severity: "all"
      });
      setEmailAutomation({
        recipient: "",
        subject: "Daily startup update",
        message: "Hi team, here is today's update.",
        scheduleExpr: "0 18 * * 1-5"
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function exportAudit() {
    const csv = await api.exportAudit();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mcp-ops-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveIntegrations(e) {
    e.preventDefault();
    try {
      await api.saveIntegrations({
        ...integrations,
        smtpPort: Number(integrations.smtpPort || 0)
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function logout() {
    api.logout();
    setUser(null);
  }

  if (!user && !loading) return <Login onLogin={login} />;

  return (
    <div className="app">
      <header className="hero">
        <h1>MCP-Ops</h1>
        <p>
          Signed in as <strong>{user?.email}</strong> ({user?.role})
        </p>
        <p>Set up human-friendly automations: emails, alerts, tickets, reports, and scheduled ops.</p>
        <button className="ghost" onClick={logout}>Log out</button>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <h2>Connect Slack and Email</h2>
        <p>Add your Slack webhook and SMTP login so alerts are delivered for real.</p>
        <form onSubmit={saveIntegrations} className="task-form one-col">
          <input
            placeholder="Slack incoming webhook URL"
            value={integrations.slackWebhookUrl || ""}
            onChange={(e) => setIntegrations({ ...integrations, slackWebhookUrl: e.target.value })}
          />
          <input
            placeholder="SMTP host (example: smtp.gmail.com)"
            value={integrations.smtpHost || ""}
            onChange={(e) => setIntegrations({ ...integrations, smtpHost: e.target.value })}
          />
          <input
            placeholder="SMTP port (example: 587)"
            value={integrations.smtpPort || ""}
            onChange={(e) => setIntegrations({ ...integrations, smtpPort: e.target.value })}
          />
          <label>
            <input
              type="checkbox"
              checked={Boolean(integrations.smtpSecure)}
              onChange={(e) => setIntegrations({ ...integrations, smtpSecure: e.target.checked })}
            />{" "}
            Use TLS/SSL (`secure`)
          </label>
          <input
            placeholder="SMTP username"
            value={integrations.smtpUser || ""}
            onChange={(e) => setIntegrations({ ...integrations, smtpUser: e.target.value })}
          />
          <input
            type="password"
            placeholder="SMTP password / app password"
            value={integrations.smtpPass || ""}
            onChange={(e) => setIntegrations({ ...integrations, smtpPass: e.target.value })}
          />
          <input
            placeholder="From email (optional)"
            value={integrations.smtpFrom || ""}
            onChange={(e) => setIntegrations({ ...integrations, smtpFrom: e.target.value })}
          />
          <button type="submit">Save Integrations</button>
        </form>
      </section>

      <section className="panel">
        <h2>Quick Setup: Send Automatic Email</h2>
        <p>Create a scheduled email-style automation in one form. No scripting required.</p>
        <form onSubmit={createEmailAutomation} className="task-form one-col">
          <input
            placeholder="Recipient email (example: team@company.com)"
            value={emailAutomation.recipient}
            onChange={(e) => setEmailAutomation({ ...emailAutomation, recipient: e.target.value })}
            required
          />
          <input
            placeholder="Subject"
            value={emailAutomation.subject}
            onChange={(e) => setEmailAutomation({ ...emailAutomation, subject: e.target.value })}
            required
          />
          <input
            placeholder="Message"
            value={emailAutomation.message}
            onChange={(e) => setEmailAutomation({ ...emailAutomation, message: e.target.value })}
            required
          />
          <input
            placeholder="Schedule (cron, example: 0 18 * * 1-5)"
            value={emailAutomation.scheduleExpr}
            onChange={(e) => setEmailAutomation({ ...emailAutomation, scheduleExpr: e.target.value })}
          />
          <button type="submit">Create Email Automation</button>
        </form>
      </section>

      <section className="panel">
        <h2>Automation Templates</h2>
        <div className="cards">
          {templates.map((tpl) => (
            <div key={tpl.id} className="card">
              <strong>{tpl.name}</strong>
              <p>{tpl.description || `${tpl.tasks.length} starter tasks`}</p>
              {tpl.typicalTrigger ? <small>Typical trigger: {tpl.typicalTrigger}</small> : null}
              <button onClick={() => installTemplate(tpl.id)}>Use This</button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Create Task</h2>
        <form className="task-form" onSubmit={createTask}>
          <input placeholder="Task name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input
            placeholder="Command (example: npm run lint)"
            value={form.command}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
            required
          />
          <input
            placeholder="Optional cron schedule"
            value={form.scheduleExpr}
            onChange={(e) => setForm({ ...form, scheduleExpr: e.target.value })}
          />
          <select value={form.roleRequired} onChange={(e) => setForm({ ...form, roleRequired: e.target.value })}>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button type="submit">Create</button>
        </form>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Task Library</h2>
          <ul className="list">
            {tasks.map((task) => (
              <li key={task.id}>
                <strong>{task.name}</strong>
                <p>{task.command}</p>
                <small>schedule: {task.schedule_expr || "manual"}</small>
                <div className="actions">
                  <button onClick={() => runTask(task.id)}>Run now</button>
                  <button className="ghost" onClick={() => addSchedule(task.id)}>
                    Set schedule
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Alerts</h2>
          <form onSubmit={createAlert} className="task-form one-col">
            <select value={alertForm.channel} onChange={(e) => setAlertForm({ ...alertForm, channel: e.target.value })}>
              <option value="slack">Slack</option>
              <option value="email">Email</option>
              <option value="webhook">Webhook</option>
            </select>
            <input
              placeholder="#devops-alerts or user@example.com"
              value={alertForm.target}
              onChange={(e) => setAlertForm({ ...alertForm, target: e.target.value })}
              required
            />
            <select value={alertForm.severity} onChange={(e) => setAlertForm({ ...alertForm, severity: e.target.value })}>
              <option value="failed">Failed only</option>
              <option value="all">All runs</option>
            </select>
            <button type="submit">Add Alert</button>
          </form>
          <ul className="list">
            {alerts.map((a) => (
              <li key={a.id}>
                <strong>{a.channel}</strong>
                <p>{a.target}</p>
                <small>severity: {a.severity}</small>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Recent Runs</h2>
          <ul className="list">
            {runs.map((run) => (
              <li key={run.id}>
                <strong>{run.status}</strong>
                <p>task: {run.task_id}</p>
                <small>{run.started_at}</small>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Audit Trail</h2>
          <button onClick={exportAudit}>Export CSV</button>
          <ul className="list">
            {logs.map((log) => (
              <li key={log.id}>
                <strong>{log.action}</strong>
                <p>
                  {log.actor} | {log.status}
                </p>
                <small>{log.created_at}</small>
              </li>
            ))}
          </ul>
        </div>

        {isAdmin ? (
          <div className="panel">
            <h2>Team</h2>
            <ul className="list">
              {team.map((member) => (
                <li key={member.id}>
                  <strong>{member.email}</strong>
                  <small>{member.role}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default App;
