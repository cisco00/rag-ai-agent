# Vantage AI — Deployment Guide

Vantage AI is designed for **self-hosted, fully isolated deployments**. Each client organization runs their own stack — their own compute, their own network, their own secrets. No data leaves their infrastructure boundary.

---

## LLM Provider Options

Vantage AI is provider-agnostic. Set `LLM_PROVIDER` to one of:

| Provider | Value | Key Required |
|---|---|---|
| OpenAI | `openai` | `LLM_API_KEY` (or `OPENAI_API_KEY`) |
| Azure OpenAI | `azure_openai` | `LLM_API_KEY` + `AZURE_OPENAI_ENDPOINT` |
| Anthropic Claude | `anthropic` | `LLM_API_KEY` (or `ANTHROPIC_API_KEY`) |
| Google Gemini | `google` | `LLM_API_KEY` (or `GOOGLE_API_KEY`) |
| HuggingFace | `huggingface` | `HF_TOKEN` |

For Azure OpenAI, also set `AZURE_OPENAI_API_VERSION` (default: `2024-08-01-preview`). The `LLM_MODEL_NAME` for Azure should match your **deployment name** in Azure, not the base model name.

---

## Option A — AWS (Terraform)

### Prerequisites
- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.6
- AWS CLI configured (`aws configure`)
- Docker images pushed to ECR (see below)
- A domain you control

### Step 1 — Push Container Images to ECR

```bash
# Create ECR repositories
aws ecr create-repository --repository-name vantage-backend --region us-east-1
aws ecr create-repository --repository-name vantage-frontend --region us-east-1

# Authenticate Docker
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and push backend
docker build -t vantage-backend ./backend
docker tag vantage-backend:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/vantage-backend:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/vantage-backend:latest

# Build and push frontend
docker build -t vantage-frontend ./frontend
docker tag vantage-frontend:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/vantage-frontend:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/vantage-frontend:latest
```

### Step 2 — Configure tfvars

```bash
cp infra/terraform/aws/environments/production.tfvars infra/terraform/aws/my-org.tfvars
# Edit my-org.tfvars with your values
```

### Step 3 — Create Secrets File (never committed to git)

Create `infra/terraform/aws/secrets.tfvars`:
```hcl
llm_api_key    = "sk-..."         # Your LLM provider API key
jwt_secret     = "..."            # openssl rand -base64 32
encryption_key = "..."            # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
smtp_pass      = "..."            # Your SMTP password
```

### Step 4 — Deploy

```bash
cd infra/terraform/aws

terraform init
terraform plan -var-file="my-org.tfvars" -var-file="secrets.tfvars"
terraform apply -var-file="my-org.tfvars" -var-file="secrets.tfvars"
```

Terraform will output:
```
app_url             = "https://vantage.acme.com"
api_url             = "https://api.vantage.acme.com"
alb_dns_name        = "acme-prod-alb-xxxxxx.us-east-1.elb.amazonaws.com"
deployment_summary  = ...
```

### Step 5 — DNS

If `create_route53_zone = false` (default), create a CNAME record in your DNS provider:
```
vantage.acme.com → <alb_dns_name>
```

### Updating

```bash
# Update images in ECR, then:
terraform apply -var-file="my-org.tfvars" -var-file="secrets.tfvars"
# ECS will perform a rolling deployment with zero downtime
```

### Tearing Down

```bash
terraform destroy -var-file="my-org.tfvars" -var-file="secrets.tfvars"
# Note: RDS has deletion_protection=true — disable manually in AWS console first
```

---

## Option B — On-Prem / Docker Compose

Coming soon — see `infra/on-prem/`.

---

## Data Privacy FAQ

**Does Vantage AI send our data to a third party?**

Only to your chosen LLM provider. Query context is sent to the provider you configure (OpenAI, Anthropic, Azure OpenAI, or Google). If you use Azure OpenAI, data stays within your Azure tenant. For full air-gap requirements, a self-hosted Ollama integration is on the roadmap.

**Who has access to our database credentials?**

Only your AWS Secrets Manager, which only your ECS tasks can read. The credentials are never in the Terraform state file (they're generated randomly) and never in environment variable logs.

**Can Vantage AI access our source databases directly?**

Yes — that is its purpose. Vantage AI reads your connected databases to run analysis. It does **not** write to or modify them. All connections are read-only by design.

**What data is stored persistently?**

- Insight results and query history in the admin RDS database (in your AWS account)
- Uploaded files in ECS ephemeral storage (not persisted after task restart)
- No data is sent to or stored on Vantage AI's infrastructure

---

## Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │           Org's AWS Account              │
                    │                                          │
   Users ──HTTPS──► │  ALB ──► ECS Frontend ──► ECS Backend  │
                    │                   │              │       │
                    │                   │         Secrets Mgr  │
                    │                   │              │       │
                    │                   └──────────► RDS       │
                    │                                          │
                    │  Org's DB (MySQL/PG/etc) ◄── Backend     │
                    └─────────────────────────────────────────┘
                                      │
                              LLM API call
                                      │
                          ┌─────────────────────┐
                          │  OpenAI / Azure /    │
                          │  Anthropic / Gemini  │
                          └─────────────────────┘
```
