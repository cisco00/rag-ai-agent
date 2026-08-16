# Product Requirements Document: Vantage AI

## Executive Summary

**Product Name:** Vantage AI: Commercial Analytics Portal  
**Version:** 2.6  
**Last Updated:** August 2026  
**Document Owner:** Product Team

### Vision
Vantage AI is a production-ready, RAG-powered analytics platform that democratizes data insights for organizations. By combining natural language processing with multi-database connectivity, we enable businesses to query their data using plain English and receive actionable insights with automated visualizations.

### Mission
Empower organizations to make data-driven decisions without requiring SQL expertise or data science knowledge, while maintaining enterprise-grade security and multi-tenancy.

---

## Product Overview

### What is Vantage AI?

Vantage AI is a commercial SaaS platform that allows organizations to:
- Connect their existing databases (PostgreSQL, MySQL, SQLite, SQL Server)
- Upload CSV/Excel files for instant analysis
- Query data using natural language instead of SQL
- Receive AI-generated insights with automatic visualizations
- Share reports with stakeholders via secure links
- Maintain complete data isolation in a multi-tenant environment
- Monitor and catch data anomalies via the Proactive Insight Engine
- Transform data seamlessly using an AI-guided pipeline

### Target Users

**Primary Personas:**
1. **Business Analysts** - Need quick insights without SQL knowledge
2. **Data Managers** - Require self-service analytics for their teams
3. **Product Managers** - Want to explore data trends and metrics
4. **Executives** - Need high-level insights and shareable reports

**Secondary Personas:**
1. **Data Engineers** - Setting up database connections
2. **IT Administrators** - Managing organizational access

---

## Core Features

### 1. Multi-Tenant Organization Management

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Organizations can self-register via API or UI
- Each organization receives a unique API key
- Complete data isolation between organizations
- Separate admin database for organizational metadata
- Enforce unique email addresses per organization during registration to prevent duplicate accounts
- **Advanced User Management:** Support for inviting members, revoking pending invitations, removing active users, and ownership handover.

#### User Stories
- As a **new customer**, I want to register my organization so that I can start using the platform
- As an **admin**, I want my organization's data completely isolated from other customers
- As a **developer**, I want to authenticate all API requests using an API key

#### Technical Specifications
- Admin database: SQLite (`admin.db`)
- Organizations table with fields: `id`, `name`, `email`, `api_key`, `db_connection_string`, `branding`, `created_at`
- API key generation: Secure random 256-bit tokens
- Authentication: Header-based (`x-api-key`)

#### API Endpoints
```
POST /register
  Request: {"name": "Organization Name", "email": "admin@org.com"}
  Response: {"api_key": "...", "message": "..."}
```

---

### 2. Universal Database Connectivity

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Support for major SQL databases via SQLAlchemy
- Dynamic connection string configuration per organization
- Connection validation and error handling
- Schema introspection capabilities

#### Supported Databases
- ✅ SQLite
- ✅ PostgreSQL
- ✅ MySQL
- ✅ Microsoft SQL Server
- ✅ Any SQLAlchemy-compatible database

#### User Stories
- As a **data manager**, I want to connect my PostgreSQL database so that I can analyze production data
- As an **analyst**, I want to switch between different databases without changing my workflow
- As a **developer**, I want clear error messages when database connections fail

#### Technical Specifications
- Connection strings stored encrypted in admin database
- Connection pooling for performance
- Automatic schema caching
- Support for read-only connections

#### API Endpoints
```
POST /config
  Headers: x-api-key
  Request: {"connection_string": "postgresql://..."}
  Response: {"status": "success", "message": "..."}

GET /tables
  Headers: x-api-key
  Response: {"tables": [...], "total": N}
```

---

### 3. File Import System

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Import CSV and Excel files into databases
- Support for single and batch file uploads
- Automatic data cleaning and column name normalization
- File analysis before import (Analyze Before Import feature)
- Table management (replace, append, fail modes)

#### Features
- **Single File Import:** Upload one file at a time
- **Batch Import:** Upload up to 20 files simultaneously
- **Analyze Before Import:** Pre-scan file structures to prevent import failures and show a preview of column formats
- **Temporary Upload:** Quick analysis without permanent storage
- **Multi-Sheet Excel:** Import all sheets from Excel workbooks

#### User Stories
- As a **business analyst**, I want to upload my Excel report so that I can query it with natural language
- As a **data manager**, I want to import multiple CSV files at once to save time
- As a **product manager**, I want to quickly analyze a file without creating permanent tables

#### Technical Specifications
- Maximum file size: 50MB per file
- Supported formats: `.csv`, `.xlsx`, `.xls`
- Automatic column cleaning: lowercase, underscore separation, special char removal
- Data validation: empty file detection, size limits, type checking

#### API Endpoints
```
POST /import
  Headers: x-api-key
  Form Data: file, table_name (optional), if_exists (optional)
  Response: {"status": "success", "rows_imported": N, "columns": [...]}

POST /analyze-file
  Headers: x-api-key
  Form Data: file
  Response: {"status": "success", "analysis": {...}}
  
POST /upload
  Headers: x-api-key
  Form Data: file
  Response: {"file_id": "...", "database_path": "..."}
```

---

### 4. Natural Language Query Engine

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Convert natural language to SQL queries
- Execute queries safely with error handling
- Return results in human-readable format
- Deliver brief, plain-English explanations with visualizations (no verbose/technical output)
- Support conversation history for context
- Automatic visualization generation

#### Capabilities
- Text-to-SQL conversion using LLM
- Multi-step reasoning with tool calling
- Automatic chart type selection based on query results
- Support for complex analytical queries
- Query result summarization

#### User Stories
- As a **business analyst**, I want to ask "What are our top 5 products?" instead of writing SQL
- As a **product manager**, I want to see trends visualized automatically
- As an **executive**, I want simple answers to complex data questions without overwhelming SQL logs

#### Technical Specifications
- LLM: HuggingFace Inference API (Qwen/Qwen2.5-Coder-32B-Instruct)
- Tool calling: Dynamic SQL execution, schema inspection
- Max iterations: Configurable (default: 10)
- Visualization types: bar, line, pie, scatter, area charts
- Response format: JSON with text + visualization data

#### API Endpoints
```
POST /query
  Headers: x-api-key
  Request: {
    "query": "What are the top 5 products by revenue?",
    "history": [...],
    "use_file": false
  }
  Response: {
    "query": "...",
    "response": "...",
    "visualization": {
      "type": "bar",
      "data": {...},
      "title": "..."
    },
    "status": "success"
  }
```

---

### 5. Proactive Insight Engine

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Automatically detect anomalies and metric changes in organizational databases
- Use the AI agent to explain *why* the metrics changed
- Surface insights proactively without requiring the user to ask a question
- Schedule check-ins to run as a background task
- Mark insights as read/unread

#### Features
- **Background Scheduler:** Periodically compares current metrics (e.g., 24-hr average) against a baseline (e.g., 7-day average) for all configured organizations.
- **AI-Driven Explanations:** When a significant shifts (>10%) is detected, asks the underlying AnalyticsAgent to analyze the tables and formulate an explanation.
- **Insights UI:** A distinct "Insights Center" that categorizes insights by severity (high, medium, low) and lists headline, explanation, and likely causes.

#### User Stories
- As a **business analyst**, I want the system to alert me if daily sales drop unexpectedly so I can investigate without explicitly running a query.
- As an **executive**, I want proactive alerts covering key performance indicators highlighted automatically for me.

#### API Endpoints
```
GET /insights
  Headers: x-api-key
  Response: {"status": "success", "insights": [...]}

POST /insights/{id}/seen
  Headers: x-api-key
  Response: {"status": "success"}

POST /insights/mark-all-seen
  Headers: x-api-key
  Response: {"status": "success"}
```

---

### 6. Data Transformation Pipeline & AI Wizard

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Provide a UI for users to clean, format, and engineer features on their data
- Allow for chaining of multiple operations (e.g., drop row, filter, rename column)
- **AI Transformation Wizard:** An input field to describe necessary transformations in plain English, which translates to correct pipeline operations.
- Dynamic fill NaN logic featuring suggested strategies based on data type (mean for numerical, mode for categorical).

#### Operations Supported
- **Cleaning:** Drop Duplicates, Clean Text, Remove Outliers
- **Transform:** Filter Rows, Rename Column, Drop Column, Change Type, Fill Missing Values
- **Advanced/Aggregation:** Normalize, Encode, Group By, Resample Time Series

#### User Stories
- As a **data manager**, I want to drop columns that have mostly null values or impute them rapidly.
- As a **business user**, I want to tell the AI to "make the date column a datetime format" simply by typing it out.

#### API Endpoints
```
POST /transform
  Headers: x-api-key
  Request: {"table_name": "...", "operations": [...]}
  Response: {"status": "success", "message": "...", "rows_affected": N}

POST /transform/suggest
  Headers: x-api-key
  Request: {"table_name": "...", "prompt": "..."}
  Response: {"status": "success", "operations": [...]}
```

---

### 7. Visualization System

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Supported Chart Types
- **Bar Chart:** Comparisons, rankings
- **Line Chart:** Trends over time
- **Pie Chart:** Proportions, distributions
- **Scatter Plot:** Correlations, relationships
- **Area Chart:** Cumulative trends

#### User Stories
- As a **business analyst**, I want to see sales trends as a line chart automatically
- As a **product manager**, I want market share shown as a pie chart
- As a **developer**, I want consistent visualization data format for rendering

#### Technical Specifications
- Visualization parser validates chart structure
- Data format: `{type, data: {labels, values}, title, description}`
- Automatic type selection based on query intent
- Fallback to table format if visualization fails

---

### 8. Report Sharing and Export

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Generate shareable links for analysis results (Public access without authentication)
- Export analysis results to PDF format
- Export analysis results to PowerPoint (PPTX) format
- Include query, response text, and rendered charts

#### User Stories
- As a **business analyst**, I want to download my report as a PDF for offline viewing or share my findings with stakeholders via a link
- As a **product manager**, I want to export my findings to PowerPoint for presentations

#### Technical Specifications
- Shared reports have unique secure random hashes and file-based JSON storage
- Output generation libraries: `reportlab` (PDF), `python-pptx` (PPTX), `matplotlib` (chart rendering server-side)

---

### 9. Advanced Analytics

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Time-series forecasting using Holt-Winters Exponential Smoothing
- Anomaly detection using Isolation Forest
- Correlation matrix analysis
- Dropdown-based table and column selection in UI (to prevent manually typing column names)
- Automatic column detection from connected database
- Data downsampling for large tables (>10,000 rows) to prevent browser timeouts

#### Features
- **Time Series Forecast:** Select a date column and value column using dynamic dropdowns. Uses **Holt-Winters Exponential Smoothing** with configurable forecast horizons (7–90 periods) and frequencies (Daily, Hourly, Weekly, Monthly).
- **Anomaly Detection:** Identify outliers in numeric columns using the **Isolation Forest** algorithm. Features a configurable contamination rate (default 0.05) to tune sensitivity.
- **Correlation Matrix:** Heatmap-style correlation analysis (Pearson or Spearman) for multiple numeric columns to identify relationship strengths.
- **Dynamic Selectors:** Automatic column type detection and dropdown-based selection in the UI to prevent manual syntax errors.
- **Performance Optimization:** Automatic data downsampling for large tables (>10,000 rows) to ensure responsive browser interactions.

#### User Stories
- As a **data analyst**, I want to forecast future values of a metric without writing any code
- As a **business analyst**, I want to see which columns are correlated to identify patterns
- As a **manager**, I want to detect unusual spikes or drops in data using AI anomaly detection.

---

### 10. Real-Time Data Streaming

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Live monitoring of database table data via WebSocket
- Hybrid WebSocket + HTTP polling fallback for maximum compatibility
- Dynamic table and column selection
- Live line chart with configurable buffer size
- Connection status indicator

#### Features
- **Live Streaming:** True real-time monitoring via WebSocket (`/ws/stream/{table}`) for tables with active data writers.
- **Replay Mode (HTTP Polling):** For historical or static tables, the system simulates a live stream via HTTP polling at 1.5-second intervals, cycling through rows to visualize patterns.
- **Cloud-Ready UI:** Real-time line chart with a sliding window (configurable buffer) and a live connection status indicator (Connected/Disconnected).
- **Dynamic Mapping:** On-the-fly column mapping for the streaming axis (X=Time, Y=Value).

---

### 11. Data Management

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- View and browse all tables in the connected database
- Paginated table preview with inline editing
- Add, edit, and delete rows
- Fill missing values with AI-suggested imputation strategies

#### User Stories
- As a **data manager**, I want to fix incorrect values in my database directly from the UI
- As a **data analyst**, I want to fill missing values with sensible defaults before running analysis

---

### 12. Scheduled Reports

**Priority:** P2 (Medium)  
**Status:** ✅ Implemented

#### Requirements
- Schedule recurring queries to run automatically
- Configurable frequency (hourly, daily, weekly, monthly)
- View and manage existing scheduled reports

#### User Stories
- As a **manager**, I want a daily sales summary delivered automatically

### 13. Dashboards (Pinned Boards)

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Users can create named dashboard boards to collect and organise AI query results
- Any AI response (text + chart) can be pinned to a dashboard directly from the Query page using a 📌 Pin button
- Dashboards support one-click public sharing via a unique URL (publish/unpublish toggle)
- Individual cards can be refreshed (re-run the original query) or removed at any time
- Dashboard list, card grid, and share state are all persisted per organization

#### Features
- **Create / Delete Boards:** Named boards with an optional description
- **Pin Cards:** Save any query response (chart + analysis text) to a chosen board
- **Publish / Unpublish:** Generate a public share URL for read-only board access; revoke at any time
- **Card Refresh:** Re-execute the original query to update the card's data and visualization
- **Mixed Card Types:** Cards may contain a chart, analysis text, or both

#### User Stories
- As a **business analyst**, I want to pin my most important charts to a board so I can revisit them without re-running queries
- As an **executive**, I want to publish a dashboard board so stakeholders can view live results without logging in

#### API Endpoints
```
GET  /dashboards                          → list all boards
POST /dashboards                          → create a board
GET  /dashboards/{id}                     → get board + cards
DELETE /dashboards/{id}                   → delete board
POST /dashboards/{id}/publish             → make public, returns share_url
POST /dashboards/{id}/unpublish           → revoke public access
POST /dashboards/{id}/cards/{cid}/refresh → re-run card query
DELETE /dashboards/{id}/cards/{cid}       → remove card
```

---

### 14. Alerts Manager

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Users can define threshold-based alert rules on any table column without writing code
- Rules are evaluated on a configurable lookback window and support standard numeric operators as well as percentage-change operators
- Notifications are delivered via email and/or webhook
- A cooldown period prevents alert spam
- Full trigger history is persisted and shown in the UI

#### Features
- **Rule Builder:** Name, table, column, aggregate function (AVG / SUM / COUNT / MIN / MAX), operator, threshold, lookback hours
- **Operators:** `>`, `<`, `>=`, `<=`, `==`, `!=`, `pct_change_gt`, `pct_change_lt`
- **Notifications:** Email address and/or webhook URL per rule
- **Cooldown:** Configurable minimum minutes between repeated triggers
- **Enable / Disable:** Toggle rules on or off without deleting them
- **Test Now:** Manually evaluate a rule immediately to verify configuration
- **Alert History:** Collapsible log of past trigger events with delivery status

#### User Stories
- As a **data manager**, I want to be notified by email when daily revenue drops more than 10% so I can react quickly
- As a **developer**, I want to receive webhook calls when anomalies are detected so downstream systems can respond automatically

#### API Endpoints
```
GET    /alerts              → list all rules
POST   /alerts              → create a rule
DELETE /alerts/{id}         → delete a rule
POST   /alerts/{id}/toggle  → activate / deactivate
POST   /alerts/{id}/test    → evaluate rule now and return result
GET    /alerts/history      → full trigger log
```

---

### 15. Data Profiler

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Provide column-level statistical profiling for any table in the connected database
- Results are cached and can be force-refreshed on demand
- Profiles help users understand data quality before analysis or transformation

#### Features
- **Table Summary:** Row count, column count, average null percentage
- **Per-Column Stats:**
  - Data type, total count, null count, null percentage (with colour-coded bar: green / amber / red)
  - Distinct value count
  - For **numeric columns:** min, P25, median, mean, max, standard deviation
  - For **categorical columns:** top-5 value frequency distribution with inline bar chart
  - Sample values (up to 8) for any column type
- **Expandable Rows:** Column details are collapsed by default for a clean overview; click to expand
- **Force Refresh:** Bypass cache to re-profile a table after data changes

#### User Stories
- As a **data analyst**, I want to see the null rate and value distribution for every column before I start querying so I know the data quality
- As a **data manager**, I want to identify high-null columns quickly so I can decide which ones to drop or impute

#### API Endpoints
```
GET /tables/{table_name}/profile           → get cached profile
GET /tables/{table_name}/profile?force=true → force re-profile
```

---

---

### 17. White-labeling & Custom Branding

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Customize the platform UI to match organizational brand identity.
- Persist branding settings per organization.
- Support for logos, themes, and localized messaging.

#### Features
- **Logo Management:** Upload custom PNG/JPG/SVG logos with automatic server-side storage and static serving.
- **Theme Customization:** Define primary brand colors and UI accent colors.
- **Localized Messaging:** Custom organization name and tagline displayed throughout the application.

#### API Endpoints
```
GET  /branding      → fetch current settings
PUT  /branding      → update name, colors, tagline
POST /logo          → upload and link brand logo
```

---

### 18. External Data Ingestion (REST APIs)

**Priority:** P2 (Medium)  
**Status:** ✅ Implemented

#### Requirements
- Ingest data from external JSON/REST endpoints into the organization's database.
- Support for various authentication headers and query parameters.
- Automatic tabular parsing of API responses.

#### Features
- **API Connector:** Configure URL, Method (GET/POST), Headers, and Params.
- **Tabular Mapping:** Heuristic-based parsing of nested JSON objects into flat database tables.
- **Metadata Persistence:** Track API sources as registered data sources.

#### API Endpoints
```
GET  /data/sources   → list all registered APIs/databases
POST /import/api     → fetch, parse, and import API data to a table
```

---

### 19. Context-Aware Organizational Learning

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Capture user feedback on AI-generated queries and insights.
- Record corrections to improve the RAG performance for specific organizations.
- Create an organization-specific "knowledge layer" over time.

#### Features
- **Feedback Loop:** Inline voting (Up/Down) and text-based corrections on every AI response.
- **Correction Recording:** Automatically persists the original query, response, and user correction to a dedicated organizational context manager.
- **Refinement Engine:** Uses past corrections to weight future SQL generation and reasoning steps.

---

### 20. AI Transparency & "Thinking Process"

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Expose the AI agent's internal reasoning and tool-calling steps to the user.
- Improve user trust and debugging of complex multi-step queries.

#### Features
- **Thinking Process Logs:** Real-time visibility into the steps the agent takes (e.g., "Scanning schema...", "Generating SQL...", "Executing query...").
- **Multi-Session History:** Persistent storage of chat logs including full thinking steps and visualization data.

---

### 21. Remote Database Auto-Provisioning

**Priority:** P2 (Medium)  
**Status:** ✅ Implemented

#### Requirements
- Automatically provision new databases and users for organizations right from the portal.
- Onboard new customers with "Instant-DB" capabilities without manual DBA intervention.

#### Features
- **Instant PostgreSQL:** Logic to create new Postgres databases and dedicated owner-users with secure credentials.
- **Automated Onboarding:** Automatically sends connection details to the organization administrator via email.
- **Auto-Switching:** Instantly configures the AI agent's connection string to the new provisioned database.

---

### 22. CRM Integration Suite & Provisioning

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- One-click native connectivity for HubSpot and Salesforce.
- **Organization Provisioning:** Allow organizations to securely provide their own `Client ID` and `Client Secret` to use their private Developer Apps.
- **Deduplicated Sync:** Automated background synchronization with intelligent cleaning and deduplication.
- **Integrated UX:** Popup-based OAuth flow to keep users within the Vantage dashboard.

#### Features
- **HubSpot Connector:** Automated sync of Contacts, Companies, and Deals using HubSpot CRM API v3.
- **Salesforce Connector:** Automated sync of Leads, Contacts, and Opportunities via SOQL and REST API.
- **Provisioning UI:** A dedicated tab in the integration settings to manage custom app credentials (encrypted at rest).
- **Data Landing:** CRM data is automatically normalized and landed into organization-specific SQL tables (e.g., `hubspot_contacts`), making it immediately queryable via natural language.

#### User Stories
- As a **Sales Manager**, I want to connect my Salesforce account and ask "Who are my top leads from the last 7 days?" in plain English.
- As an **IT Admin**, I want to use my own HubSpot Developer App so that I have full control over API scopes and data access.

#### API Endpoints
```
GET  /integrations/available         → list CRM providers
GET  /integrations/{p}/auth-url      → get OAuth initiation URL
POST /integrations/{p}/credentials   → save Client ID/Secret
POST /integrations/import/{p}        → trigger manual data sync
```

---

### 23. On-Premise & Cloud Deployment

**Priority:** P0 (Critical)  
**Status:** ✅ Implemented

#### Requirements
- Fully self-hosted, isolated deployment — all data stays within the customer's network boundary
- One-command bootstrap for on-premise Linux servers
- Infrastructure-as-Code cloud deployment (AWS) via Terraform
- Automatic TLS certificate provisioning (Let's Encrypt)
- Optional monitoring stack (Prometheus + Grafana)
- Provider-agnostic LLM configuration (OpenAI, Azure OpenAI, Anthropic, Google Gemini, HuggingFace)

#### Features
- **On-Prem (Docker Compose):** Production-hardened `docker-compose.prod.yml` with Traefik reverse proxy, PostgreSQL admin DB, backend, and frontend — no ports exposed except 80/443. Automated `setup.sh` script handles prerequisite checks, `.env` templating, secret validation, image builds, service startup, and health checks.
- **AWS (Terraform):** Modular Terraform configuration with dedicated modules for networking (VPC, subnets, ALB), compute (ECS Fargate), database (RDS PostgreSQL), secrets (Secrets Manager), and monitoring (CloudWatch). Supports ECR-hosted container images and zero-downtime rolling deployments.
- **Security Hardening:** All inter-service communication on an internal Docker bridge network, database credentials never exposed to the host, rate limiting and security headers via Traefik middleware, HTTP→HTTPS redirect enforced.
- **Monitoring (opt-in):** Prometheus, Grafana, and Node Exporter enabled via `--profile monitoring` with Grafana served at `/grafana`.

#### User Stories
- As an **IT administrator**, I want to deploy Vantage AI on our own servers with a single script so that no data leaves our infrastructure
- As a **DevOps engineer**, I want a Terraform module for AWS so I can provision production infrastructure reproducibly
- As a **security officer**, I want all traffic encrypted with automatic TLS and no internal ports exposed to the host

#### Deployment Options
| Option | Method | Prerequisites |
|---|---|---|
| On-Premise | `bash infra/on-prem/setup.sh` | Docker 24.0+, Docker Compose v2.20+, domain with DNS |
| AWS Cloud | `terraform apply` in `infra/terraform/aws/` | Terraform ≥ 1.6, AWS CLI, ECR repos, domain |

#### Key Files
```
infra/on-prem/docker-compose.prod.yml   — production Docker Compose
infra/on-prem/setup.sh                  — one-command bootstrap script
infra/on-prem/.env.template             — environment template (secrets)
infra/on-prem/README.md                 — operations & troubleshooting guide
infra/terraform/aws/main.tf             — Terraform root module
infra/terraform/aws/variables.tf        — configurable deployment variables
infra/terraform/aws/modules/            — networking, compute, database, secrets, monitoring
DEPLOYMENT.md                           — unified deployment guide (both options)
```

---

### 24. In-App Update Notifications (On-Premise)

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Automatically detect when a newer version of Vantage AI is available for on-premise deployments
- Notify superuser administrators via a non-intrusive in-app banner
- Provide version details, changelog link, and upgrade command in the admin panel
- Allow administrators to dismiss notifications per version
- Run checks on a configurable schedule without impacting application performance

#### Features
- **Background Version Checker:** APScheduler job runs every N hours (default 6), fetching the latest `VERSION` file from the configured URL (default: GitHub raw). Compares remote semver against local `VERSION` using tuple-based comparison.
- **Update Banner:** Animated amber-gradient banner shown only to superusers. Displays latest vs. current version, a link to the changelog, a one-click copy button for the upgrade command (`bash update.sh`), and a dismiss button.
- **Admin Panel System Tab:** Dedicated "System" tab showing current version, latest available version with status pill ("Update Available" / "Up to date"), last-checked timestamp, "Check Now" button for on-demand checks, upgrade command block, and full changelog link.
- **Sidebar Indicator:** Pulsing `UPDATE` pill in the sidebar footer and a `!` badge on the Admin Console menu item when an update is available.
- **Version Dismissal:** Server-side and client-side (`sessionStorage`) dismissal prevents repeated notifications for a version the admin has already acknowledged.
- **Configurable:** All behaviour controlled via environment variables — can be fully disabled for air-gapped environments.

#### User Stories
- As an **on-premise admin**, I want to be notified when a new version of Vantage AI is available so I can plan an upgrade window
- As a **security officer**, I want to ensure we are running the latest version with security patches
- As an **IT administrator**, I want to disable update checks in air-gapped environments where outbound internet is not available

#### Environment Variables
| Variable | Default | Description |
|---|---|---|
| `UPDATE_CHECK_ENABLED` | `true` | Enable/disable automatic version checking |
| `UPDATE_CHECK_URL` | GitHub raw `VERSION` URL | URL returning the latest version string (plain text) |
| `UPDATE_CHECK_INTERVAL_HOURS` | `6` | Hours between automatic checks |
| `CHANGELOG_URL` | GitHub `CHANGELOG.md` URL | URL shown in admin UI to view release notes |
| `GITHUB_TOKEN` | *(empty)* | Optional token for private repository access |

#### API Endpoints
```
GET  /admin/updates/status   → cached update status (version, available, timestamp)
POST /admin/updates/check    → trigger immediate version check
POST /admin/updates/dismiss  → dismiss notification for a specific version
```

#### Key Files
```
backend/update_checker.py              — version check logic & in-memory cache
backend/routers/admin.py               — /admin/updates/* endpoints (superuser-only)
backend/api.py                         — lifespan integration (APScheduler job)
frontend/src/app/components/UpdateBanner.tsx  — dismissible notification banner
frontend/src/app/components/AdminPanel.tsx    — System tab with version details
frontend/src/app/components/Sidebar.tsx       — version label + update dot
```

---

### 16. Observability & Monitoring (Langfuse)

**Priority:** P1 (High)  
**Status:** ✅ Implemented

#### Requirements
- Trace LLM generations, tool calls, and agent reasoning steps
- Monitor API latency, token usage, and costs
- Enable debugging of complex RAG chains
- Persist traces for audit and performance tuning

#### Features
- **Langfuse Integration:** Deep integration with the AnalyticsAgent via the Langfuse SDK.
- **Trace Visualization:** Capture prompt templates, variable injections, and multi-step tool execution.
- **Cost Tracking:** Automatic token counting and provider-specific pricing integration.
- **Session Linking:** Group traces by organization and chat session for easier troubleshooting.

#### Technical Specifications
- **Provider:** Langfuse (Cloud or Self-Hosted via Docker)
- **SDK:** `langfuse-python`
- **Instrumentation Points:** `AnalyticsAgent`, `LLMClient`, and key router endpoints.

## Technical Architecture

### Technology Stack

**Backend:**
- **Framework:** FastAPI (Python 3.10+)
- **Database ORM:** SQLAlchemy
- **LLM:** HuggingFace Inference API
- **Server:** Uvicorn (ASGI)

**Data Processing:**
- **File Parsing:** pandas
- **Database Drivers:** psycopg2, pymysql, pyodbc

**Security:**
- **Authentication:** API Key (Header-based `x-api-key`)
- **Secrets Management:** Environment variables (.env)

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                     FastAPI Server                       │
│                        (api.py)                          │
└─────────────────────────────────────────────────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │   Models     │    │ Analytics    │    │  Database    │
  │  (models.py) │    │   Agent      │    │   Manager    │
  │              │    │  (main.py)   │    │(database.py) │
  └──────────────┘    └──────────────┘    └──────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │  Admin DB    │    │ CRM Sync &   │    │  Customer    │
  │ (admin.db)   │    │ Connectors   │    │  Databases   │
  │              │    │ (crm_sync.py)│    │              │
  └──────────────┘    └──────────────┘    └──────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │   LLMs &     │    │ External CRM │    │   Internal   │
  │ Observability│    │ (HubSpot/SF) │    │   Scheduler  │
  │ (Langfuse)   │    │     APIs     │    │ (scheduler.py)│
  └──────────────┘    └──────────────┘    └──────────────┘
          │
          ▼
  ┌──────────────┐
  │ Update       │
  │ Checker      │
  │(update_      │
  │ checker.py)  │
  └──────────────┘
```

---

## Security & Compliance

### Authentication & RBAC
- ✅ **API Key-based auth** for machine-to-machine.
- ✅ **JWT-based auth** with secure cookies for web access.
- ✅ **Role-Based Access Control (RBAC):**
  - **Owner**: Full system access, organization billing, and ownership handover.
  - **Admin**: User management (excluding owners), database configuration, and data modification.
  - **Analyst**: Natural language querying, advanced analytics, and dashboard viewing.
- ✅ **Secure Password Hashing** (bcrypt with 12 rounds).
- ✅ **Prevent duplicate accounts** globally and per-org.

### Audit & Compliance
- ✅ **Global Activity Logs:** Centralized `activity_logs` table tracking critical actions (logins, imports, db changes, role updates) with user/org context.
- ✅ **Data Isolation:** Enforced separate databases (PostgreSQL schemas or SQLite files) per tenant.
- ✅ **Connection Encryption:** All database credentials stored encrypted at rest.
- ✅ **Input Sanitization:** Parameterized SQL and regex-based table/column name validation.

---

## Future Roadmap

### Phase 3 — High-Performance Analytics (Completed Q2 2026)
- ✅ Advanced visualizations (heatmaps, treemaps, candlestick)
- ✅ Custom branding per organization (White-labeling)
- ✅ Organization-level RBAC & User Management
- ✅ Langfuse Observability & Monitoring
- ✅ AI Thinking Process Transparency
- ✅ External API Data Ingestion
- ✅ Email notifications for critical alerts and onboarding
- ✅ Holt-Winters Time-Series Forecasting
- ✅ Real-time Data Streaming (WebSocket + HTTP fallback)
- ✅ **CRM Integration Suite** (HubSpot & Salesforce)
- ✅ **CRM Provisioning Protocol** (Custom Credentials)

### Phase 4 — Enterprise Scaling (Q3–Q4 2026)
- 🔲 Mobile app (iOS/Android) for proactive alerts
- 🔲 Slack / Microsoft Teams integration (AI Query via Chat)
- 🔲 Multi-language support (LLM localization)
- ✅ **On-Premise & Cloud Deployment** (Docker Compose + AWS Terraform)
- ✅ **In-App Update Notifications** (On-Premise version checker with admin banner)
- 🔲 Organization-wide usage analytics and cost reporting

---

## Success Metrics

### Product Metrics
- **Adoption:** Number of registered organizations
- **Engagement:** Queries per organization per week
- **Performance:** Average query response time

### Business Metrics
- **Revenue:** MRR/ARR growth
- **Customer Satisfaction:** NPS score

### Technical Metrics
- **Uptime:** 99.9% availability
- **Error Rate:** < 1% of requests
- **Query Success Rate:** > 95%
- **Visualization Success Rate:** > 80%

---

## Appendix

### Glossary
- **RAG:** Retrieval-Augmented Generation
- **LLM:** Large Language Model
- **API Key:** Authentication token for API access
- **Multi-tenancy:** Single instance serving multiple organizations
- **Tool Calling:** LLM invoking functions to perform tasks

### Related Documents
- [README.md](README.md) - Quick start guide
- [FILE_IMPORT_GUIDE.md](FILE_IMPORT_GUIDE.md) - File import documentation
- [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md) - Code quality guidelines
- [DEPLOYMENT.md](DEPLOYMENT.md) - On-premise & AWS deployment guide

**Document Version:** 2.7  
**Last Updated:** August 2026  
**Next Review:** October 2026
