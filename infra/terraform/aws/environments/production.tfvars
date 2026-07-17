# =============================================================================
# Production environment values — fill in before running terraform apply
# =============================================================================

# --- Identity ---
org_name    = "acme-corp"           # Replace with your org slug
aws_region  = "us-east-1"
environment = "production"

# --- Domain ---
domain_name          = "vantage.acme.com"   # Your domain
create_route53_zone  = false                # true if Terraform should manage DNS

# --- Container Images (push to ECR first) ---
backend_image  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/vantage-backend:latest"
frontend_image = "123456789012.dkr.ecr.us-east-1.amazonaws.com/vantage-frontend:latest"

# --- Compute ---
backend_cpu            = 1024
backend_memory         = 2048
frontend_cpu           = 256
frontend_memory        = 512
backend_desired_count  = 2
frontend_desired_count = 2

# --- Database ---
db_instance_class        = "db.t3.small"
db_allocated_storage     = 50
db_backup_retention_days = 14
db_multi_az              = true

# --- LLM Provider ---
# Options: openai | azure_openai | anthropic | google
llm_provider   = "openai"
llm_model_name = "gpt-4o"

# azure_openai_endpoint    = "https://YOUR_ORG.openai.azure.com/"
# azure_openai_api_version = "2024-08-01-preview"

# --- Secrets (use -var-file or environment variables, NOT committed to git) ---
# llm_api_key    = "sk-..."
# jwt_secret     = "..."
# encryption_key = "..."
# smtp_pass      = "..."

# --- Email ---
smtp_host = "smtp.gmail.com"
smtp_port = 465
smtp_user = "noreply@acme.com"

# --- Observability ---
enable_monitoring = true
langfuse_host     = "https://cloud.langfuse.com"

# --- Networking ---
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]
