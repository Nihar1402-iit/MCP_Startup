const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

let token = localStorage.getItem("mcp_ops_token") || "";

function withAuth(headers = {}) {
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

async function req(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: withAuth({ "Content-Type": "application/json", ...(options.headers || {}) }),
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/csv")) return res.text();
  return res.json();
}

export const api = {
  validateEmail: (email) => req("/api/auth/validate-email", { method: "POST", body: JSON.stringify({ email }) }),
  signup: async (email, password) => req("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: async (email, password) => {
    const result = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    token = result.token;
    localStorage.setItem("mcp_ops_token", token);
    return result;
  },
  logout: () => {
    token = "";
    localStorage.removeItem("mcp_ops_token");
  },
  me: () => req("/api/me"),
  getIntegrations: () => req("/api/integrations"),
  saveIntegrations: (payload) => req("/api/integrations", { method: "POST", body: JSON.stringify(payload) }),
  listIntegrationUrls: () => req("/api/integrations/urls"),
  saveIntegrationUrl: (payload) => req("/api/integrations/urls", { method: "POST", body: JSON.stringify(payload) }),
  getSlackOauthStart: () => req("/api/integrations/slack/oauth/start"),
  finishSlackOauth: (code) => req("/api/integrations/slack/oauth/callback", { method: "POST", body: JSON.stringify({ code }) }),
  listTemplates: () => req("/api/templates"),
  installTemplate: (id) => req(`/api/templates/${id}/install`, { method: "POST" }),
  listTasks: () => req("/api/tasks"),
  createTask: (payload) => req("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),
  runTask: (id) => req(`/api/tasks/${id}/run`, { method: "POST" }),
  scheduleTask: (id, payload) => req(`/api/tasks/${id}/schedule`, { method: "POST", body: JSON.stringify(payload) }),
  listRuns: () => req("/api/runs"),
  listAudit: () => req("/api/audit"),
  exportAudit: () => req("/api/audit/export.csv", { headers: { Accept: "text/csv" } }),
  createAlert: (payload) => req("/api/alerts", { method: "POST", body: JSON.stringify(payload) }),
  listAlerts: () => req("/api/alerts"),
  listTeam: () => req("/api/team")
};
