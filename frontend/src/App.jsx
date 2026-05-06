import { useEffect, useMemo, useState } from "react";
import { api } from "./api";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card panel">
        <div className="actions">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("founder@mcpops.dev");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");

    if (!emailRegex.test(email)) {
      setError("Please enter a valid email format.");
      return;
    }

    try {
      setChecking(true);
      const check = await api.validateEmail(email);
      if (!check.validFormat || !check.hasMx) {
        setError("This email domain does not look valid for receiving mail.");
        return;
      }
      await onLogin(email, password, mode);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="panel login">
      <h1>MCP-Ops</h1>
      <p>Log in with your email and password.</p>
      <form onSubmit={submit} className="task-form one-col">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (8+ characters)"
          required
        />
        <button type="submit" disabled={checking}>{checking ? "Checking email..." : mode === "login" ? "Log In" : "Create Account"}</button>
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
  const [integrationUrls, setIntegrationUrls] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", command: "", scheduleExpr: "", roleRequired: "editor" });
  const [alertForm, setAlertForm] = useState({ channel: "slack", target: "", severity: "failed" });
  const [integrations, setIntegrations] = useState({ slackWebhookUrl: "", slackUserId: "" });
  const [modal, setModal] = useState(null);
  const [serviceForm, setServiceForm] = useState({ service: "", url: "" });

  const isAdmin = useMemo(() => user?.role === "admin", [user]);

  async function login(email, password, mode) {
    if (mode === "signup") await api.signup(email, password);
    await api.login(email, password);
    await load();
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const me = await api.me();
      setUser(me.user);
      const [tplRes, tasksRes, runsRes, logsRes, alertsRes, integrationsRes, urlsRes] = await Promise.all([
        api.listTemplates(),
        api.listTasks(),
        api.listRuns(),
        api.listAudit(),
        api.listAlerts(),
        api.getIntegrations(),
        api.listIntegrationUrls()
      ]);
      setTemplates(tplRes.templates || []);
      setTasks(tasksRes.tasks || []);
      setRuns(runsRes.runs || []);
      setLogs(logsRes.logs || []);
      setAlerts(alertsRes.alerts || []);
      setIntegrations(integrationsRes.integrations || { slackWebhookUrl: "", slackUserId: "" });
      setIntegrationUrls(urlsRes.urls || []);
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

  useEffect(() => {
    async function finishSlackOauth() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (!code || !user) return;
      try {
        await api.finishSlackOauth(code);
        window.history.replaceState({}, "", window.location.pathname);
        await load();
      } catch (err) {
        setError(err.message);
      }
    }
    finishSlackOauth();
  }, [user]);

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

  async function saveSlackWebhook(e) {
    e.preventDefault();
    try {
      await api.saveIntegrations({ slackWebhookUrl: integrations.slackWebhookUrl });
      await load();
      setModal(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function startSlackOauth() {
    try {
      const { authUrl } = await api.getSlackOauthStart();
      window.location.href = authUrl;
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveServiceUrl(e) {
    e.preventDefault();
    try {
      await api.saveIntegrationUrl(serviceForm);
      setServiceForm({ service: "", url: "" });
      setModal(null);
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
        <p>Signed in as <strong>{user?.email}</strong> ({user?.role})</p>
        <p>Enable optional features only when you need them.</p>
        <button className="ghost" onClick={logout}>Log out</button>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <h2>Feature Integrations</h2>
        <p>When you enable a feature, we ask for required URL/credentials in a pop-up.</p>
        <div className="actions">
          <button onClick={() => setModal("slack")}>Do you want to integrate Slack?</button>
          <button className="ghost" onClick={() => setModal("service-url")}>Enter additional service URLs</button>
        </div>
        <ul className="list">
          {integrations.slackWebhookUrl ? <li><strong>Slack Webhook:</strong><p>{integrations.slackWebhookUrl}</p></li> : null}
          {integrations.slackUserId ? <li><strong>Slack User ID:</strong><p>{integrations.slackUserId}</p></li> : null}
          {integrationUrls.map((u) => (
            <li key={u.id}><strong>{u.service}</strong><p>{u.url}</p></li>
          ))}
        </ul>
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
          <input placeholder="Command (example: npm run lint)" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} required />
          <input placeholder="Optional cron schedule" value={form.scheduleExpr} onChange={(e) => setForm({ ...form, scheduleExpr: e.target.value })} />
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
                  <button className="ghost" onClick={() => addSchedule(task.id)}>Set schedule</button>
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
            <input placeholder="#devops-alerts or user@example.com" value={alertForm.target} onChange={(e) => setAlertForm({ ...alertForm, target: e.target.value })} required />
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
                <p>{log.actor} | {log.status}</p>
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

      {modal === "slack" ? (
        <Modal title="Integrate Slack" onClose={() => setModal(null)}>
          <p>Do you want to integrate Slack? You can paste a webhook URL or use Slack OAuth.</p>
          <form onSubmit={saveSlackWebhook} className="task-form one-col">
            <input
              placeholder="Slack webhook URL"
              value={integrations.slackWebhookUrl || ""}
              onChange={(e) => setIntegrations({ ...integrations, slackWebhookUrl: e.target.value })}
            />
            <button type="submit">Save Webhook</button>
          </form>
          <button onClick={startSlackOauth}>Log in with Slack (OAuth)</button>
        </Modal>
      ) : null}

      {modal === "service-url" ? (
        <Modal title="Additional Service URLs" onClose={() => setModal(null)}>
          <p>Enter any extra integration URL you want to use later.</p>
          <form onSubmit={saveServiceUrl} className="task-form one-col">
            <input placeholder="Service name (example: GitHub Webhook)" value={serviceForm.service} onChange={(e) => setServiceForm({ ...serviceForm, service: e.target.value })} required />
            <input placeholder="https://..." value={serviceForm.url} onChange={(e) => setServiceForm({ ...serviceForm, url: e.target.value })} required />
            <button type="submit">Save URL</button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

export default App;
