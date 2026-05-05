# MCP-Ops MVP+

MCP-Ops is a self-serve DevOps automation platform with a web UI for managing reusable tasks, schedules, alerts, and audit logs.

## Implemented features

- Magic-link style login (demo token flow)
- Role-aware access (`admin`, `editor`, `viewer`)
- Task library CRUD
- Template gallery with one-click install
- Run-now execution simulation with logs + status
- Cron-based scheduled loops
- Alerts configuration (Slack/Email/Webhook targets)
- Audit trail + CSV export
- Team listing for admins
- Dockerfiles and Helm chart scaffold

## Structure

- `backend/` API, scheduler, SQLite storage, audit/alert service
- `frontend/` React dashboard (login, templates, tasks, alerts, audit)
- `infra/helm/mcp-ops/` Kubernetes chart scaffold

## Local run

### Backend

```bash
cd backend
npm install
npm run dev
```

Backend: `http://localhost:4000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`

## Human-friendly automation quick start

If you are not technical and just want to automate communication:

1. Sign in with your email in the web UI.
2. Open **Quick Setup: Send Automatic Email**.
3. Enter recipient, subject, message, and schedule.
4. Click **Create Email Automation**.

What happens:
- A scheduled task is created automatically.
- An email alert destination is created for the recipient.
- Each run is logged in **Recent Runs** and **Audit Trail** with notification records.

You can also use **Automation Templates** to one-click install common workflows:
- Slack/Teams release updates
- GitHub issue creation on failures
- Jira/Linear ticket creation
- Nightly CI pipeline triggers
- Deployment rollouts
- Backup snapshots

## Tests and checks

### Backend integration tests

```bash
cd backend
npm test
```

### Frontend production build

```bash
cd frontend
npm run build
```

### Helm lint

```bash
cd infra/helm/mcp-ops
helm lint .
```

## API overview

- `POST /api/auth/magic-link`
- `GET /api/me`
- `GET /api/templates`
- `POST /api/templates/:id/install`
- `GET /api/tasks`
- `POST /api/tasks`
- `POST /api/tasks/:id/run`
- `POST /api/tasks/:id/schedule`
- `GET /api/runs`
- `GET /api/audit`
- `GET /api/audit/export.csv`
- `POST /api/alerts`
- `GET /api/alerts`
- `GET /api/team`

## Docker

```bash
docker compose up --build
```

Note: Requires Docker daemon running.

## Deploy on Vercel (frontend)

Repository: `https://github.com/Nihar1402-iit/MCP_Startup.git`

1. Import the repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add env var `VITE_API_BASE` to your backend URL (for example, `https://your-backend.example.com`).
6. Deploy.

Important:
- This project's backend uses Express + SQLite + scheduler jobs.
- Vercel is best for the frontend here; host backend on a server platform (Render/Railway/Fly/EC2) for persistent DB + cron behavior.
