# =============================================================================
# Vantage AI — Terraform Outputs
# =============================================================================

output "app_url" {
  description = "The public HTTPS URL of the Vantage AI frontend."
  value       = "https://${var.domain_name}"
}

output "api_url" {
  description = "The public HTTPS URL of the Vantage AI backend API."
  value       = "https://api.${var.domain_name}"
}

output "alb_dns_name" {
  description = "ALB DNS name — use this for your CNAME record if not using Route 53."
  value       = module.compute.alb_dns_name
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster."
  value       = module.compute.ecs_cluster_name
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)."
  value       = module.database.db_endpoint
  sensitive   = true
}

output "secrets_bundle_arn" {
  description = "ARN of the AWS Secrets Manager secret bundle used by ECS tasks."
  value       = module.secrets.secrets_bundle_arn
}

output "vpc_id" {
  description = "VPC ID for this deployment."
  value       = module.networking.vpc_id
}

output "deployment_summary" {
  description = "Human-readable deployment summary."
  value = <<-EOT
    ============================================================
    Vantage AI — ${var.org_name} (${var.environment})
    ============================================================
    App URL  : https://${var.domain_name}
    API URL  : https://api.${var.domain_name}
    Region   : ${var.aws_region}
    LLM      : ${var.llm_provider} / ${var.llm_model_name}
    ECS      : ${module.compute.ecs_cluster_name}
    RDS      : ${module.database.db_identifier}
    ============================================================
  EOT
}
