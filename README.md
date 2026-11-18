# Vantage AI — Analytics Platform

**Version 2.6.0** · Self-hosted · Multi-tenant · Provider-agnostic

Vantage AI is a production-ready analytics platform that lets organizations connect their own databases, upload files, and unlock AI-powered insights, transformation pipelines, advanced statistics, and dashboards — all within their own infrastructure. No data leaves your boundary.

---

## ✨ Feature Overview

### 🔍 AI Query Interface
Natural-language querying over your connected database. Ask questions in plain English; Vantage AI generates and executes SQL, then explains the result. Includes a query history browser and a reusable query-template library.

### 📊 Dashboards
Build, pin, and share visual dashboards from your query results. Supports multiple chart types, versioned history, embed/share links, and card-level commenting.

### 🤖 AI Transform Pipeline
A drag-and-drop data transformation pipeline with 22 operations across 6 categories:

| Category | Operations |
|---|---|
| **Cleaning** | Drop Duplicates, Clean Text, Remove Outliers |
| **Select** | Filter Rows, Drop Rows, Rename Column, Drop Column, Change Type, Fill Missing Values, Sample Rows |
| **Smart Prep** | Normalize, Encode, Feature Engineering, Text Features, Formula Column, Regex Extract |
| **Summarize** | Group By, Time-Series Resample |
| **Combine** | Join / Merge Tables, Union / Append |
| **Reshape** | Pivot, Unpivot (Melt) |

Each operation includes a plain-language description for non-technical users. Pipelines can be saved, scheduled, batch-applied across tables, and previewed before commit. The hybrid SQL + Pandas execution engine automatically picks the fastest path per operation.

### 📈 Advanced Analytics
Statistical and machine-learning analyses run server-side:

| Analysis | Method |
|---|---|
| **Forecasting** | Holt-Winters exponential smoothing (with fallback engines) |
| **Anomaly Detection** | Isolation Forest (univariate and multivariate) |
| **Correlation Matrix** | Pearson, Spearman, or Kendall Tau |
| **Clustering** | K-Means with configurable cluster count |
| **Regression** | Linear regression with performance metrics |
| **Classification** | Decision tree classifier |
| **PCA** | Principal component analysis |
| **Hypothesis Testing** | t-test, Mann-Whitney U, chi-square |
| **Cross-Analytical Intelligence** | Multi-analysis synthesis with AI-generated hypotheses |

Results are interpreted in plain language by the AI and can be saved as named snapshots.

### 🔔 Alerts
Threshold-based alert rules on any numeric column. Supports cooldown periods, webhook delivery, and email notifications via SMTP.

### 🗃️ Data Management
- Upload Excel and CSV files directly from the browser
- Browse and query any connected database schema
- Data Catalog with searchable column descriptions (AI-generated or manually entered)
- Schema diagram visualiser (entity-relationship view)
- Data Quality Monitor with per-column null-rate and type checks
- Data Profiler with histogram, top-values, and statistical summaries per column
- Row-level data permissions and column-level access control per role
- Real-time streaming via WebSocket (HTTP polling fallback)

### 📋 Reports & Export
- Scheduled reports delivered by email (daily / weekly / monthly)
- Export to PDF and PPTX
- Shareable public links for dashboards and query results

### 🔗 Integrations
- **CRM**: HubSpot and Salesforce (OAuth, field-mapped sync)
- **Google Sheets**: two-way sync
- **Cloud Storage**: S3-compatible file import/export
- **External REST APIs**: ingest data from any HTTP endpoint
- **Notebooks**: browser-based Python notebook environment

### 🛡️ Security & Auth
- JWT authentication with configurable token TTL (default 8 hours)
- Refresh tokens (default 30-day lifetime)
- TOTP two-factor authentication (TOTP-compatible apps)
- SAML/SSO integration
- Full audit trail with per-user action logging
- Role-based access control across 9 built-in roles

### 🏢 Multi-Tenant & Admin
- Org-scoped data isolation — each organisation has its own database connection and credentials
- Admin panel: manage organisations, users, and API keys
- White-labelling: custom logo, colours, and domain branding
- Usage analytics per org
- In-app update notifications with changelog

---

## 👥 Roles & Permissions

| Role | Description |
|---|---|
| `owner` | Full access including org settings and billing |
| `admin` | Full access except billing |
| `business_owner` | Dashboards, reports, exports, org settings |
| `product_manager` | Dashboards, reports, exports |
| `operation_manager` | Dashboards, alerts, reports, exports |
| `analyst` | Full data access, transforms, queries, dashboards |
| `sales_team` | Reports and exports |
| `marketing_team` | Reports and exports |
| `viewer` | Read-only query and dashboard access |

---

## 🏗️ Deployment Options

Vantage AI is designed for **self-hosted, fully isolated deployments**. Each organisation runs its own stack — its own compute, network, and secrets.

| Option | Best For | Guide |
|---|---|---|
| **Desktop App** | Single-user, no server required | [desktop/README.md](desktop/README.md) |
| **On-Prem (Docker Compose)** | Self-hosted / air-gapped / on-premise servers | [DEPLOYMENT.md](DEPLOYMENT.md#option-b--on-prem--docker-compose) |
| **AWS (Terraform)** | Enterprise cloud with full IaC automation | [DEPLOYMENT.md](DEPLOYMENT.md#option-a--aws-terraform) |
| **Local Dev** | Development and testing | See below |

### Desktop App
A standalone Tauri v2 desktop application. The React frontend runs in a native WebView; the Python backend runs as a sidecar process (compiled to a single binary with PyInstaller). No Docker or terminal required.

Build it from `desktop/`:
```bash
cd desktop
npm install
npm run tauri build
```

### LLM Provider Support

Vantage AI is **provider-agnostic**. Configure your own LLM in `backend/.env`:

| Provider | Models |
|---|---|
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5 |
| **Azure OpenAI** | Bring your own endpoint |
| **Anthropic Claude** | Claude 3.5 Sonnet, Opus, Haiku |
| **Google Gemini** | Gemini 2.0 Flash, Pro |
| **HuggingFace** | Any Inference API model |

---

## 🚀 Local Development

### 1. Configure Environment

```bash
cp backend/.env.template backend/.env
# Fill in LLM_API_KEY, JWT_SECRET, ENCRYPTION_KEY at minimum
```

### 2. Start Services

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8080 |

### 3. Monitoring (optional)

```bash
docker compose -f docker-compose.monitoring.yml up -d
```

| Service | URL |
|---|---|
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 |

---

## 📁 Project Structure

```text
rag-ai-agent/
├── backend/                        # Python FastAPI backend
│   ├── api.py                      # App factory — mounts all routers
│   ├── main.py                     # Multi-tenant agent logic (RAG query pipeline)
│   ├── auth.py                     # JWT issue, verify, refresh
│   ├── totp_auth.py                # TOTP two-factor authentication
│   ├── sso.py                      # SAML/SSO integration
│   ├── llm_client.py               # Multi-provider LLM abstraction
│   ├── models.py                   # SQLAlchemy models (orgs, users, pipelines…)
│   ├── database.py                 # DatabaseManager — per-org connection pooling
│   ├── dependencies.py             # Shared FastAPI deps, JWT config, RBAC roles
│   ├── transformations.py          # Pandas transformation engine (22 operations)
│   ├── sql_transformer.py          # SQL CTE compiler for transform operations
│   ├── pipeline_executor.py        # DAG/canvas pipeline runner
│   ├── analytics.py                # Statistical & ML analysis helpers
│   ├── scheduler.py                # Background job scheduler
│   ├── workers.py                  # Async task worker pool
│   ├── validators.py               # Input validators (table names, columns…)
│   ├── alerts.py                   # Alert rule evaluation engine
│   ├── email_service.py            # SMTP email delivery
│   ├── export_manager.py           # PDF / PPTX export
│   ├── profiler.py                 # Column-level data profiling
│   ├── insight_engine.py           # AI insight generation
│   ├── audit_log.py                # Audit event logging
│   ├── usage_tracker.py            # Per-org usage metering
│   ├── update_checker.py           # In-app version checking
│   ├── connectors/
│   │   ├── hubspot.py              # HubSpot OAuth + field sync
│   │   └── salesforce.py          # Salesforce OAuth + field sync
│   ├── routers/                    # One FastAPI router per domain
│   │   ├── auth.py                 # /auth — login, register, refresh, 2FA
│   │   ├── data.py                 # /tables — schema, preview, upload, delete
│   │   ├── transformations.py      # /transform — pipeline CRUD + execution
│   │   ├── analytics.py            # /analytics — forecast, anomaly, correlation…
│   │   ├── dashboards.py           # /dashboards — CRUD + publish/share
│   │   ├── alerts.py               # /alerts — rule CRUD + history
│   │   ├── insights.py             # /insights — AI-generated data insights
│   │   ├── sessions.py             # /sessions — query history
│   │   ├── admin.py                # /admin — org and user management
│   │   ├── audit.py                # /audit — event log
│   │   ├── billing.py              # /billing — usage and plan info
│   │   ├── branding.py             # /branding — white-label settings
│   │   ├── integrations.py         # /integrations — CRM, REST API ingestion
│   │   ├── sheets.py               # /sheets — Google Sheets sync
│   │   ├── cloud_storage.py        # /storage — S3-compatible import/export
│   │   ├── notebooks.py            # /notebooks — Python notebook CRUD
│   │   ├── data_permissions.py     # /permissions — row/column access rules
│   │   ├── data_quality.py         # /quality — schema and null-rate checks
│   │   ├── schema_diagram.py       # /schema-diagram — ER diagram data
│   │   ├── cross_analysis.py       # /analytics/cross — multi-analysis synthesis
│   │   └── …                       # (sso, totp, query_templates, impact, …)
│   ├── alembic/                    # Database migrations
│   ├── .env.template               # Environment variable reference
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                       # React 18 + TypeScript + Vite
│   └── src/app/
│       ├── components/
│       │   ├── QueryInterface.tsx       # Natural-language query UI
│       │   ├── DataTransformation.tsx   # AI transform pipeline builder
│       │   ├── PipelineCanvas.tsx       # DAG canvas (drag-and-drop pipeline)
│       │   ├── AdvancedAnalytics.tsx    # Statistical & ML analysis UI
│       │   ├── Dashboard.tsx            # Dashboard builder & viewer
│       │   ├── DashboardsView.tsx       # Dashboard gallery
│       │   ├── DataManagement.tsx       # Table browser & file upload
│       │   ├── DataProfiler.tsx         # Column statistics & histograms
│       │   ├── DataQualityMonitor.tsx   # Schema and quality checks
│       │   ├── DataCatalog.tsx          # Column descriptions catalog
│       │   ├── SchemaDiagram.tsx        # ER diagram view
│       │   ├── AlertsManager.tsx        # Alert rule builder
│       │   ├── Insights.tsx             # AI insight cards
│       │   ├── Reports.tsx              # Scheduled report manager
│       │   ├── NotebookView.tsx         # In-browser Python notebooks
│       │   ├── Integrations.tsx         # CRM, Sheets, Storage, API connectors
│       │   ├── AdminPanel.tsx           # Org and user administration
│       │   ├── AuditTrail.tsx           # Audit event log
│       │   ├── UsageAnalytics.tsx       # Usage metrics per org
│       │   ├── SetupWizard.tsx          # First-run configuration wizard
│       │   ├── AuthPage.tsx             # Login / register / 2FA
│       │   └── …                        # (branding, SSO, embeddings, sharing…)
│       └── lib/
│           └── api.ts                  # Typed API client
├── desktop/                        # Tauri v2 desktop app
│   ├── src-tauri/                  # Rust core
│   ├── build-backend.py            # PyInstaller backend bundler
│   └── README.md
├── infra/
│   ├── terraform/aws/              # AWS ECS Fargate + RDS (Terraform)
│   │   ├── modules/networking/     # VPC, subnets, security groups
│   │   ├── modules/compute/        # ECS Fargate, ALB, ACM
│   │   ├── modules/database/       # RDS PostgreSQL
│   │   ├── modules/secrets/        # Secrets Manager + IAM
│   │   └── modules/monitoring/     # CloudWatch dashboards + alarms
│   └── on-prem/                    # Docker Compose production stack
│       ├── docker-compose.prod.yml # Traefik + TLS + all services
│       ├── setup.sh                # One-command bootstrap
│       └── update.sh               # Safe rolling update with backup
├── tests/                          # Pytest test suite
├── notebooks/                      # Sample notebooks
├── docker-compose.yml              # Local dev orchestration
├── docker-compose.monitoring.yml   # Prometheus + Grafana
├── DEPLOYMENT.md                   # Full deployment guide (AWS + On-Prem)
├── CHANGELOG.md                    # Release history
├── VERSION                         # Current version (2.6.0)
└── README.md
```

---

## ⚙️ Key Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | ✅ | `openai` / `azure_openai` / `anthropic` / `google` / `huggingface` |
| `LLM_MODEL_NAME` | ✅ | e.g. `gpt-4o`, `claude-3-5-sonnet-20241022` |
| `LLM_API_KEY` | ✅ | Your LLM provider API key |
| `JWT_SECRET` | ✅ | Random secret for signing JWTs (`openssl rand -hex 32`) |
| `ENCRYPTION_KEY` | ✅ | Fernet key for encrypting stored credentials |
| `DATABASE_URL` | — | Postgres admin DB (SQLite used automatically for local dev) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | — | Required for alert emails and scheduled reports |
| `ACCESS_TOKEN_TTL_MINUTES` | — | JWT access token lifetime (default: `480`) |
| `REFRESH_TOKEN_TTL_DAYS` | — | Refresh token lifetime (default: `30`) |
| `LANGFUSE_PUBLIC_KEY` | — | Optional LLM observability via Langfuse |
| `ENVIRONMENT` | — | `development` (default) or `production` |

See `backend/.env.template` for the full reference.

---

## 🧪 Running Tests

```bash
cd backend
pip install -r requirements.txt --break-system-packages
pytest tests/ -v
```

---

## 📡 Core API Endpoints

All endpoints (except `/auth/login`, `/auth/register`, and `/health`) require a `Bearer` JWT token in the `Authorization` header.

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create a new account |
| `POST` | `/auth/login` | Log in, receive access + refresh tokens |
| `POST` | `/auth/refresh` | Exchange refresh token for new access token |
| `GET` | `/tables` | List tables in the connected database |
| `GET` | `/tables/{table}/preview` | Preview rows and column metadata |
| `POST` | `/query` | Natural-language query → SQL → results |
| `POST` | `/transform/preview` | Preview a transformation pipeline |
| `POST` | `/transform` | Apply and save a transformation |
| `GET` | `/transform/pipelines` | List saved pipelines |
| `POST` | `/analytics/forecast` | Run time-series forecast |
| `POST` | `/analytics/anomaly` | Run anomaly detection |
| `POST` | `/analytics/correlation` | Run correlation matrix |
| `POST` | `/analytics/cluster` | Run K-Means clustering |
| `GET` | `/dashboards` | List dashboards |
| `POST` | `/dashboards` | Create a dashboard |
| `GET` | `/alerts` | List alert rules |
| `POST` | `/alerts` | Create an alert rule |

---

## 🛠️ Requirements

### Local Development
- Docker and Docker Compose v2.20+
- API key for your chosen LLM provider

### Desktop App
- Rust (latest stable), Node.js 18+, Python 3.11+

### Production — AWS
- Terraform ≥ 1.6, AWS CLI, ECR repositories

### Production — On-Prem
- Docker 24.0+, Docker Compose v2.20+, a domain with DNS pointed at your server

See [DEPLOYMENT.md](DEPLOYMENT.md) for full step-by-step guides.
