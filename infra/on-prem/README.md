# Vantage AI — On-Premise Deployment Guide

Deploy Vantage AI on your own infrastructure using Docker Compose. All data stays within your network boundary.

---

## Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| Docker | 24.0+ | Latest stable |
| Docker Compose | v2.20+ | Latest stable |
| RAM | 4 GB | 8 GB+ |
| CPU | 2 cores | 4 cores+ |
| Disk | 20 GB | 50 GB+ (depends on data volume) |
| OS | Any Linux with Docker | Ubuntu 22.04 LTS / Debian 12 |

**Network**: Ports 80 and 443 must be open for inbound HTTPS traffic. The server needs outbound access to your chosen LLM provider API (unless using a self-hosted model).

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/your-org/rag-ai-agent.git
cd rag-ai-agent/infra/on-prem

# 2. Run the setup script
bash setup.sh
# → First run copies .env.template to .env and stops.

# 3. Edit .env with your values
nano .env

# 4. Run setup again to build and start
bash setup.sh
```

The setup script will:
1. ✅ Check Docker is installed and running
2. ✅ Create `.env` from template (if missing)
3. ✅ Validate all required secrets are set
4. ✅ Build container images
5. ✅ Start all services
6. ✅ Run health checks and print the access URL

---

## Architecture

```
                         ┌───────────────────────────────────────────┐
                         │           Your Server / VM                │
                         │                                           │
  Users ──HTTPS (443)──► │  Traefik ──► Frontend (Nginx/Vite)       │
                         │     │                                     │
                         │     └──► Backend (FastAPI)                │
                         │              │                            │
                         │              ├── PostgreSQL (admin DB)    │
                         │              │                            │
                         │              └── Your DB (MySQL/PG/etc)   │
                         │                                           │
                         │  [optional] Prometheus + Grafana          │
                         └───────────────────────────────────────────┘
                                          │
                                  LLM API call (outbound)
                                          │
                              ┌───────────────────────┐
                              │  OpenAI / Azure /      │
                              │  Anthropic / Gemini    │
                              └───────────────────────┘
```

### Key Design Decisions

- **Traefik reverse proxy** — handles TLS certificates (Let's Encrypt), routing, rate limiting, and security headers. No backend/frontend ports are directly exposed.
- **No port exposure** — PostgreSQL, backend, and frontend are only reachable through the Traefik proxy on the internal Docker network.
- **Monitoring is opt-in** — Prometheus, Grafana, and Node Exporter are behind a Docker Compose profile. Enable with `--profile monitoring`.

---

## Configuration Reference

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `DOMAIN_NAME` | Your domain (DNS must point to this server) | `vantage.acme.com` |
| `LLM_PROVIDER` | LLM provider to use | `openai` |
| `LLM_API_KEY` | API key for your LLM provider | `sk-...` |
| `POSTGRES_SYS_ADMIN_PASSWORD` | Admin DB password | (generate a strong password) |
| `JWT_SECRET` | JWT signing secret | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Fernet encryption key | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |

### LLM Providers

| Provider | `LLM_PROVIDER` | Key Variable | Extra Config |
|---|---|---|---|
| OpenAI | `openai` | `LLM_API_KEY` | — |
| Azure OpenAI | `azure_openai` | `LLM_API_KEY` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION` |
| Anthropic Claude | `anthropic` | `LLM_API_KEY` | — |
| Google Gemini | `google` | `GOOGLE_API_KEY` | — |
| HuggingFace | `huggingface` | `HF_TOKEN` | — |

### Optional Variables

See [.env.template](.env.template) for all available options with descriptions.

---

## Operations

### Start / Stop

```bash
# Start all services
docker compose -f docker-compose.prod.yml up -d

# Start with monitoring
docker compose -f docker-compose.prod.yml --profile monitoring up -d

# Stop (preserves data)
docker compose -f docker-compose.prod.yml down

# Stop and remove volumes (⚠ DESTROYS DATA)
docker compose -f docker-compose.prod.yml down -v
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f vantage-backend

# Last 100 lines
docker compose -f docker-compose.prod.yml logs --tail=100 vantage-backend
```

### Health Check

```bash
# Service status
docker compose -f docker-compose.prod.yml ps

# Backend health
curl -s https://your-domain.com/api/health | jq .
```

### Updating

```bash
# Pull latest code
git pull origin main

# Rebuild and restart (zero-downtime with health checks)
docker compose -f docker-compose.prod.yml build --parallel
docker compose -f docker-compose.prod.yml up -d
```

### Database Backup

```bash
# Backup admin database
docker compose -f docker-compose.prod.yml exec vantage-db \
  pg_dump -U postgres vantage_admin > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore
docker compose -f docker-compose.prod.yml exec -i vantage-db \
  psql -U postgres vantage_admin < backup_20260722_120000.sql
```

---

## Firewall Rules

| Port | Direction | Protocol | Purpose |
|---|---|---|---|
| 443 | Inbound | TCP | HTTPS (user access) |
| 80 | Inbound | TCP | HTTP → HTTPS redirect |
| 443 | Outbound | TCP | LLM API calls |
| 5432 | Outbound | TCP | Only if connecting to an external database |

All inter-service communication happens on the internal Docker bridge network — no host ports are exposed for PostgreSQL, backend, or frontend.

---

## Troubleshooting

### Services won't start

```bash
# Check for configuration errors
docker compose -f docker-compose.prod.yml config

# Check individual container logs
docker compose -f docker-compose.prod.yml logs vantage-backend
docker compose -f docker-compose.prod.yml logs vantage-db
docker compose -f docker-compose.prod.yml logs traefik
```

### TLS certificate issues

- Ensure your domain's DNS A record points to this server's public IP
- Ensure ports 80 and 443 are open
- Check Traefik logs: `docker compose -f docker-compose.prod.yml logs traefik`
- Let's Encrypt has rate limits — use staging for testing:
  ```bash
  # Add to Traefik command in docker-compose.prod.yml:
  - "--certificatesresolvers.letsencrypt.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory"
  ```

### Backend can't reach the database

```bash
# Verify database is healthy
docker compose -f docker-compose.prod.yml exec vantage-db pg_isready -U postgres

# Test connectivity from backend
docker compose -f docker-compose.prod.yml exec vantage-backend \
  python -c "import psycopg2; psycopg2.connect(host='vantage-db', user='postgres', password='YOUR_PASS')"
```

### Resource issues

Adjust limits in `.env`:
```env
BACKEND_MEMORY_LIMIT=4G
BACKEND_CPU_LIMIT=4.0
```

---

## Security Checklist

- [ ] All secrets in `.env` are strong, randomly generated values
- [ ] `.env` file permissions are restricted: `chmod 600 .env`
- [ ] Firewall allows only ports 80 and 443 inbound
- [ ] Docker socket is not exposed to containers (except Traefik, read-only)
- [ ] Regular database backups are configured
- [ ] TLS certificates are auto-renewed (Let's Encrypt handles this)
- [ ] `CRM_MOCK_MODE=false` in production
