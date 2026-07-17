# =============================================================================
# Vantage AI — AWS Root Module
# Wires together all sub-modules for a single org's isolated deployment.
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  # ---------------------------------------------------------------------------
  # Remote State — uncomment and configure before first apply.
  # The S3 bucket and DynamoDB table must exist before running terraform init.
  # See: infra/terraform/aws/bootstrap/ for a one-time setup script.
  # ---------------------------------------------------------------------------
  # backend "s3" {
  #   bucket         = "vantage-tfstate-<org_name>"
  #   key            = "vantage/<environment>/terraform.tfstate"
  #   region         = "<aws_region>"
  #   dynamodb_table = "vantage-tfstate-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project     = "vantage-ai"
        OrgName     = var.org_name
        Environment = var.environment
        ManagedBy   = "terraform"
      },
      var.additional_tags
    )
  }
}

# ---------------------------------------------------------------------------
# Local computed values
# ---------------------------------------------------------------------------

locals {
  prefix = "${var.org_name}-${var.environment}"

  common_env_vars = {
    ENVIRONMENT      = var.environment
    LLM_PROVIDER     = var.llm_provider
    LLM_MODEL_NAME   = var.llm_model_name
    AZURE_OPENAI_ENDPOINT     = var.azure_openai_endpoint
    AZURE_OPENAI_API_VERSION  = var.azure_openai_api_version
    LANGFUSE_HOST    = var.langfuse_host
    CORS_ORIGINS     = "https://${var.domain_name}"
    APP_URL          = "https://${var.domain_name}"
    FRONTEND_URL     = "https://${var.domain_name}"
    BACKEND_URL      = "https://api.${var.domain_name}"
  }
}

# ---------------------------------------------------------------------------
# Module: Networking
# ---------------------------------------------------------------------------

module "networking" {
  source = "./modules/networking"

  prefix             = local.prefix
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

# ---------------------------------------------------------------------------
# Module: Secrets Manager
# ---------------------------------------------------------------------------

module "secrets" {
  source = "./modules/secrets"

  prefix              = local.prefix
  llm_api_key         = var.llm_api_key
  jwt_secret          = var.jwt_secret
  encryption_key      = var.encryption_key
  smtp_pass           = var.smtp_pass
  db_password         = module.database.db_password
  langfuse_public_key = var.langfuse_public_key
  langfuse_secret_key = var.langfuse_secret_key

  depends_on = [module.database]
}

# ---------------------------------------------------------------------------
# Module: Database (RDS PostgreSQL — admin DB)
# ---------------------------------------------------------------------------

module "database" {
  source = "./modules/database"

  prefix                   = local.prefix
  vpc_id                   = module.networking.vpc_id
  private_subnet_ids       = module.networking.private_subnet_ids
  db_security_group_id     = module.networking.db_security_group_id
  db_instance_class        = var.db_instance_class
  db_allocated_storage     = var.db_allocated_storage
  db_backup_retention_days = var.db_backup_retention_days
  db_multi_az              = var.db_multi_az

  depends_on = [module.networking]
}

# ---------------------------------------------------------------------------
# Module: Compute (ECS Fargate — backend + frontend)
# ---------------------------------------------------------------------------

module "compute" {
  source = "./modules/compute"

  prefix                 = local.prefix
  vpc_id                 = module.networking.vpc_id
  public_subnet_ids      = module.networking.public_subnet_ids
  private_subnet_ids     = module.networking.private_subnet_ids
  alb_security_group_id  = module.networking.alb_security_group_id
  ecs_security_group_id  = module.networking.ecs_security_group_id
  domain_name            = var.domain_name
  create_route53_zone    = var.create_route53_zone
  backend_image          = var.backend_image
  frontend_image         = var.frontend_image
  backend_cpu            = var.backend_cpu
  backend_memory         = var.backend_memory
  frontend_cpu           = var.frontend_cpu
  frontend_memory        = var.frontend_memory
  backend_desired_count  = var.backend_desired_count
  frontend_desired_count = var.frontend_desired_count
  secrets_arn            = module.secrets.secrets_bundle_arn
  ecs_task_role_arn      = module.secrets.ecs_task_role_arn
  ecs_execution_role_arn = module.secrets.ecs_execution_role_arn
  db_host                = module.database.db_endpoint
  db_name                = module.database.db_name
  common_env_vars        = local.common_env_vars
  smtp_host              = var.smtp_host
  smtp_port              = var.smtp_port
  smtp_user              = var.smtp_user

  depends_on = [module.networking, module.secrets, module.database]
}

# ---------------------------------------------------------------------------
# Module: Monitoring (optional CloudWatch)
# ---------------------------------------------------------------------------

module "monitoring" {
  source = "./modules/monitoring"
  count  = var.enable_monitoring ? 1 : 0

  prefix          = local.prefix
  ecs_cluster_name = module.compute.ecs_cluster_name
  alb_arn_suffix  = module.compute.alb_arn_suffix
  rds_identifier  = module.database.db_identifier
  aws_region      = var.aws_region

  depends_on = [module.compute, module.database]
}
