# =============================================================================
# Vantage AI — AWS Terraform Variables
# Each organization fills in these values for their isolated deployment.
# =============================================================================

# ---------------------------------------------------------------------------
# Identity & Region
# ---------------------------------------------------------------------------

variable "org_name" {
  description = "Short, slug-safe name for the organization (e.g. 'acme-corp'). Used to prefix all AWS resource names and tags."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]{2,30}$", var.org_name))
    error_message = "org_name must be 2-30 lowercase alphanumeric characters or hyphens."
  }
}

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment: staging | production"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the dedicated VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of AZs to spread resources across (min 2)."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# ---------------------------------------------------------------------------
# Domain & TLS
# ---------------------------------------------------------------------------

variable "domain_name" {
  description = "Root domain for the deployment (e.g. 'vantage.acme.com'). An ACM certificate is issued automatically."
  type        = string
}

variable "create_route53_zone" {
  description = "Set true if you want Terraform to manage the Route 53 hosted zone. Set false if DNS is managed externally."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Container Images
# ---------------------------------------------------------------------------

variable "backend_image" {
  description = "Full Docker image URI for the backend (ECR or Docker Hub). Example: 123456789.dkr.ecr.us-east-1.amazonaws.com/vantage-backend:latest"
  type        = string
}

variable "frontend_image" {
  description = "Full Docker image URI for the frontend."
  type        = string
}

# ---------------------------------------------------------------------------
# Compute / ECS
# ---------------------------------------------------------------------------

variable "backend_cpu" {
  description = "ECS task CPU units for the backend (256, 512, 1024, 2048, 4096)."
  type        = number
  default     = 1024
}

variable "backend_memory" {
  description = "ECS task memory (MiB) for the backend."
  type        = number
  default     = 2048
}

variable "frontend_cpu" {
  description = "ECS task CPU units for the frontend."
  type        = number
  default     = 256
}

variable "frontend_memory" {
  description = "ECS task memory (MiB) for the frontend."
  type        = number
  default     = 512
}

variable "backend_desired_count" {
  description = "Number of backend task replicas."
  type        = number
  default     = 2
}

variable "frontend_desired_count" {
  description = "Number of frontend task replicas."
  type        = number
  default     = 2
}

# ---------------------------------------------------------------------------
# Database (RDS)
# ---------------------------------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance type for the admin PostgreSQL database."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage for RDS in GB."
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  description = "Number of days to retain RDS automated backups."
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for the RDS instance (recommended for production)."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# LLM Provider
# ---------------------------------------------------------------------------

variable "llm_provider" {
  description = "LLM provider the organization will use: openai | azure_openai | anthropic | google"
  type        = string
  default     = "openai"

  validation {
    condition     = contains(["openai", "azure_openai", "anthropic", "google"], var.llm_provider)
    error_message = "llm_provider must be one of: openai, azure_openai, anthropic, google."
  }
}

variable "llm_model_name" {
  description = "Model name/deployment name to use. E.g. 'gpt-4o', 'claude-3-5-sonnet-20241022', 'gemini-2.0-flash'."
  type        = string
  default     = "gpt-4o"
}

variable "llm_api_key" {
  description = "API key for the chosen LLM provider. Stored in AWS Secrets Manager — never in state files."
  type        = string
  sensitive   = true
}

# Azure OpenAI specific (ignored for other providers)
variable "azure_openai_endpoint" {
  description = "(Azure OpenAI only) Your Azure OpenAI endpoint URL. E.g. https://acme.openai.azure.com/"
  type        = string
  default     = ""
}

variable "azure_openai_api_version" {
  description = "(Azure OpenAI only) API version. E.g. 2024-08-01-preview"
  type        = string
  default     = "2024-08-01-preview"
}

# ---------------------------------------------------------------------------
# Application Secrets
# ---------------------------------------------------------------------------

variable "jwt_secret" {
  description = "Secret key for JWT signing. Generate with: openssl rand -base64 32"
  type        = string
  sensitive   = true
}

variable "encryption_key" {
  description = "Fernet encryption key for data at rest. Generate with Python: from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  type        = string
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Email / SMTP
# ---------------------------------------------------------------------------

variable "smtp_host" {
  description = "SMTP server hostname."
  type        = string
  default     = ""
}

variable "smtp_port" {
  description = "SMTP server port."
  type        = number
  default     = 465
}

variable "smtp_user" {
  description = "SMTP username / from address."
  type        = string
  default     = ""
}

variable "smtp_pass" {
  description = "SMTP password. Stored in Secrets Manager."
  type        = string
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------------------
# Observability (optional)
# ---------------------------------------------------------------------------

variable "enable_monitoring" {
  description = "Deploy CloudWatch dashboards, log groups, and alarms."
  type        = bool
  default     = true
}

variable "langfuse_public_key" {
  description = "(Optional) Langfuse public key for LLM observability."
  type        = string
  default     = ""
  sensitive   = true
}

variable "langfuse_secret_key" {
  description = "(Optional) Langfuse secret key for LLM observability."
  type        = string
  default     = ""
  sensitive   = true
}

variable "langfuse_host" {
  description = "Langfuse host. Use https://cloud.langfuse.com or your self-hosted instance."
  type        = string
  default     = "https://cloud.langfuse.com"
}

# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

variable "additional_tags" {
  description = "Additional AWS resource tags to apply to all resources."
  type        = map(string)
  default     = {}
}
