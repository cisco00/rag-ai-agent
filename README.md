# Vantage AI: Commercial Analytics Portal

This project is a production-ready, RAG-powered analytics tool for organizations. It allows companies to register, connect their own databases (SQL Server, PostgreSQL, MySQL, SQLite), upload Excel/CSV files, and leverage AI-powered insights via a secure, authenticated API.

---

## 🏗️ Deployment Options

Vantage AI is designed for **self-hosted, fully isolated deployments**. Each organization runs their own stack — their own compute, network, and secrets. No data leaves their infrastructure boundary.

| Option | Best For | Guide |
|---|---|---|
| **AWS (Terraform)** | Enterprise cloud with full IaC automation | [DEPLOYMENT.md — Option A](DEPLOYMENT.md#option-a--aws-terraform) |
| **On-Prem (Docker Compose)** | Self-hosted / air-gapped / on-premise servers | [DEPLOYMENT.md — Option B](DEPLOYMENT.md#option-b--on-prem--docker-compose) |
| **Local Dev (Docker Compose)** | Development and testing | See below |

### LLM Provider Support

Vantage AI is **provider-agnostic**. Organizations choose their own LLM:

| Provider | Support |
|---|---|
| OpenAI | ✅ GPT-4o, GPT-4, GPT-3.5 |
| Azure OpenAI | ✅ Bring your own endpoint |
| Anthropic Claude | ✅ Claude 3.5 Sonnet, Opus, Haiku |
| Google Gemini | ✅ Gemini 2.0 Flash, Pro |
| HuggingFace | ✅ Any Inference API model |

---

## 🚀 Local Development

### 1. Configure Environment

```bash
cp backend/.env.template backend/.env
# Edit backend/.env with your API keys
```

### 2. Start Services

```bash
docker compose up --build
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8080

### 3. Monitoring (optional)

```bash
docker compose -f docker-compose.monitoring.yml up -d
```

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000

---

## 📁 Project Structure

```text
rag-ai-agent/
├── backend/                    # Python FastAPI backend
│   ├── api.py                  # FastAPI server (commercial endpoints)
│   ├── llm_client.py           # Multi-provider LLM abstraction
│   ├── models.py               # Admin DB models (orgs, API keys)
│   ├── main.py                 # Multi-tenant agent logic
│   ├── database.py             # SQLAlchemy database manager
│   ├── .env.template           # Environment variable template
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                   # React + Vite frontend
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── infra/                      # Infrastructure-as-Code
│   ├── terraform/aws/          # AWS ECS Fargate + RDS deployment
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   ├── modules/
│   │   │   ├── networking/     # VPC, subnets, security groups
│   │   │   ├── compute/        # ECS Fargate, ALB, ACM
│   │   │   ├── database/       # RDS PostgreSQL
│   │   │   ├── secrets/        # Secrets Manager + IAM
│   │   │   └── monitoring/     # CloudWatch dashboards + alarms
│   │   └── environments/       # staging.tfvars, production.tfvars
│   └── on-prem/                # Docker Compose production deployment
│       ├── docker-compose.prod.yml
│       ├── .env.template
│       ├── setup.sh            # One-command bootstrap
│       └── README.md
├── docker-compose.yml          # Local dev orchestration
├── DEPLOYMENT.md               # Full deployment guide
└── README.md
```

---

## 📡 API Reference

### Auth Header
All endpoints (except `/register` and `/health`) require:
`X-API-KEY: <your_secret_key>`

### Endpoints
- **`POST /register`**: Create a new organization.
- **`POST /config`**: Set the connection string for your organization's database.
- **`GET /tables`**: Explore the schema of your connected database.
- **`POST /query`**: Ask questions about your data.

---

## 🛠️ Requirements

### Local Development
- Docker and Docker Compose
- API Keys for your chosen LLM provider (see `backend/.env.template`)

### Production Deployment
- **AWS**: Terraform ≥ 1.6, AWS CLI, ECR repositories
- **On-Prem**: Docker 24.0+, Docker Compose v2.20+, a domain with DNS
- See [DEPLOYMENT.md](DEPLOYMENT.md) for full details
