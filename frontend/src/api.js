const API_BASE_KEY = "mcp_ops_api_base";

function defaultApiBase() {
  const envBase = import.meta.env.VITE_API_BASE;
  if (envBase) return envBase.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:4000";
  }
  return "";
}

let API_BASE = localStorage.getItem(API_BASE_KEY) || defaultApiBase();
let token = localStorage.getItem("mcp_ops_token") || "";

function withAuth(headers = {}) {
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

function buildUrl(path) {
  if (!API_BASE) return path;
  return `${API_BASE}${path}`;
}

async function req(path, options = {}) {
  let res;
  try {
    res = await fetch(buildUrl(path), {
      headers: withAuth({ "Content-Type": "application/json", ...(options.headers || {}) }),
      ...options
    });
  } catch {
    throw new Error("Cannot reach backend. Set the correct Backend URL on login (example: https://your-backend.onrender.com).");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 404 && path.startsWith("/api/auth/")) {
      throw new Error("Auth API not found (404). Your Backend URL is wrong or backend is outdated.");
    }
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/csv")) return res.text();
  return res.json();
}

async function ping(base) {
  const normalized = String(base || "").replace(/\/$/, "");
  if (!normalized) return false;
  try {
    const res = await fetch(`${normalized}/api/health`);
    if (res.ok) return true;
  } catch {}
  try {
    const res = await fetch(`${normalized}/health`);
    if (res.ok) return true;
  } catch {}
  return false;
}

async function discoverApiBase() {
  const candidates = [
    localStorage.getItem(API_BASE_KEY),
    import.meta.env.VITE_API_BASE,
    "http://localhost:4000",
    typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:4000` : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await ping(candidate)) {
      API_BASE = String(candidate).replace(/\/$/, "");
      localStorage.setItem(API_BASE_KEY, API_BASE);
      return API_BASE;
    }
  }

  return API_BASE;
}

export const api = {
  getApiBase: () => API_BASE,
  setApiBase: async (base) => {
    const normalized = String(base || "").trim().replace(/\/$/, "");
    if (!normalized) throw new Error("Backend URL is required");
    const ok = await ping(normalized);
    if (!ok) throw new Error("Backend URL is not reachable. Check URL and backend deployment.");
    API_BASE = normalized;
    localStorage.setItem(API_BASE_KEY, API_BASE);
    return API_BASE;
  },
  discoverApiBase,
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
