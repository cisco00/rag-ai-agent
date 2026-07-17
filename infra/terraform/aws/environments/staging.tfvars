# =============================================================================
# Staging environment — lower-cost settings for testing
# =============================================================================

org_name    = "acme-corp"
aws_region  = "us-east-1"
environment = "staging"

domain_name         = "staging-vantage.acme.com"
create_route53_zone = false

backend_image  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/vantage-backend:staging"
frontend_image = "123456789012.dkr.ecr.us-east-1.amazonaws.com/vantage-frontend:staging"

# Cheaper compute for staging
backend_cpu            = 512
backend_memory         = 1024
frontend_cpu           = 256
frontend_memory        = 512
backend_desired_count  = 1
frontend_desired_count = 1

# Smaller DB for staging
db_instance_class        = "db.t3.micro"
db_allocated_storage     = 20
db_backup_retention_days = 3
db_multi_az              = false    # No Multi-AZ needed for staging

llm_provider   = "openai"
llm_model_name = "gpt-4o-mini"     # Cheaper model for staging

enable_monitoring = true
langfuse_host     = "https://cloud.langfuse.com"

vpc_cidr           = "10.1.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

smtp_host = "smtp.gmail.com"
smtp_port = 465
smtp_user = "noreply@acme.com"
