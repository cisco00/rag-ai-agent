# Changelog

All notable changes to Vantage AI will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

---

## [2.6.0] — 2026-07-30

### Added
- **On-Premise Deployment** — Production-ready Docker Compose stack with Traefik reverse proxy, automatic TLS (Let's Encrypt), and one-command bootstrap (`bash setup.sh`)
- **AWS Cloud Deployment** — Modular Terraform configuration (VPC, ECS Fargate, RDS, Secrets Manager, CloudWatch)
- **Automated Update Script** (`infra/on-prem/update.sh`) — Pre-flight checks, automatic database backup, safe rollback on failure, and health verification
- **Version Tracking** — `VERSION` file as single source of truth; version exposed in `/` health endpoint and startup logs
- **CHANGELOG.md** — This file; tracks all release changes for self-hosted customers
- **Multi-provider LLM Support** — OpenAI, Azure OpenAI, Anthropic, Google Gemini, HuggingFace (configurable via `.env`)
- **Opt-in Monitoring Stack** — Prometheus, Grafana, and Node Exporter via `--profile monitoring`

### Fixed
- Backend Docker container now runs database migrations (Alembic) on startup — previously skipped in production Docker deployments

### Changed
- PRD updated to v2.6 with Feature #23 (On-Premise & Cloud Deployment)
- Backend `/` endpoint now reads version from `VERSION` file instead of hardcoded string

---

## [2.5.0] — 2026-04-01

### Added
- CRM Integration Suite (HubSpot & Salesforce) with OAuth provisioning
- Alerts Manager with threshold-based rules, cooldowns, and webhook/email notifications
- Dashboards (Pinned Boards) with publish/unpublish sharing
- Data Profiler with per-column statistics and null-rate analysis
- Scheduled Reports with configurable frequency
- White-labeling & Custom Branding
- External REST API Data Ingestion
- Context-Aware Organizational Learning (feedback loop)
- AI Transparency & Thinking Process logs
- Remote Database Auto-Provisioning
- Langfuse Observability & Monitoring
- Real-time Data Streaming (WebSocket + HTTP polling fallback)
- Advanced Analytics (Holt-Winters forecasting, Isolation Forest anomaly detection, correlation matrix)
- Report Export (PDF, PPTX) and shareable links
