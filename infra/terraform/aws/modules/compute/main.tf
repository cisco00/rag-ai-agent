# =============================================================================
# Module: Compute
# ECS Fargate cluster running backend + frontend containers behind an ALB.
# ACM certificate for HTTPS. Optional Route 53 record creation.
# =============================================================================

variable "prefix"                 { type = string }
variable "vpc_id"                 { type = string }
variable "public_subnet_ids"      { type = list(string) }
variable "private_subnet_ids"     { type = list(string) }
variable "alb_security_group_id"  { type = string }
variable "ecs_security_group_id"  { type = string }
variable "domain_name"            { type = string }
variable "create_route53_zone"    { type = bool }
variable "backend_image"          { type = string }
variable "frontend_image"         { type = string }
variable "backend_cpu"            { type = number }
variable "backend_memory"         { type = number }
variable "frontend_cpu"           { type = number }
variable "frontend_memory"        { type = number }
variable "backend_desired_count"  { type = number }
variable "frontend_desired_count" { type = number }
variable "secrets_arn"            { type = string }
variable "ecs_task_role_arn"      { type = string }
variable "ecs_execution_role_arn" { type = string }
variable "db_host"                { type = string; sensitive = true }
variable "db_name"                { type = string }
variable "common_env_vars"        { type = map(string) }
variable "smtp_host"              { type = string; default = "" }
variable "smtp_port"              { type = number; default = 465 }
variable "smtp_user"              { type = string; default = "" }

data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# ACM Certificate
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${var.prefix}-cert" }
}

# ---------------------------------------------------------------------------
# Route 53 (optional)
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "main" {
  count = var.create_route53_zone ? 1 : 0
  name  = var.domain_name
  tags  = { Name = "${var.prefix}-zone" }
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.create_route53_zone ? {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.main[0].zone_id
}

resource "aws_acm_certificate_validation" "main" {
  count                   = var.create_route53_zone ? 1 : 0
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ---------------------------------------------------------------------------
# CloudWatch Log Groups
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/vantage/${var.prefix}/backend"
  retention_in_days = 30
  tags              = { Name = "${var.prefix}-backend-logs" }
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/vantage/${var.prefix}/frontend"
  retention_in_days = 14
  tags              = { Name = "${var.prefix}-frontend-logs" }
}

# ---------------------------------------------------------------------------
# ECS Cluster
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "${var.prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${var.prefix}-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ---------------------------------------------------------------------------
# ALB
# ---------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${var.prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = true

  tags = { Name = "${var.prefix}-alb" }
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.prefix}-backend-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }

  tags = { Name = "${var.prefix}-backend-tg" }
}

resource "aws_lb_target_group" "frontend" {
  name        = "${var.prefix}-frontend-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }

  tags = { Name = "${var.prefix}-frontend-tg" }
}

# HTTP → HTTPS redirect
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS listener — routes /api/* → backend, everything else → frontend
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.main.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/api/*", "/health", "/docs", "/openapi.json"]
    }
  }
}

# ---------------------------------------------------------------------------
# ECS Task Definitions
# ---------------------------------------------------------------------------

locals {
  backend_env = [
    for k, v in var.common_env_vars : { name = k, value = v }
  ]

  backend_secrets = [
    { name = "LLM_API_KEY",         valueFrom = "${var.secrets_arn}:LLM_API_KEY::" },
    { name = "JWT_SECRET",          valueFrom = "${var.secrets_arn}:JWT_SECRET::" },
    { name = "ENCRYPTION_KEY",      valueFrom = "${var.secrets_arn}:ENCRYPTION_KEY::" },
    { name = "SMTP_PASS",           valueFrom = "${var.secrets_arn}:SMTP_PASS::" },
    { name = "LANGFUSE_PUBLIC_KEY", valueFrom = "${var.secrets_arn}:LANGFUSE_PUBLIC_KEY::" },
    { name = "LANGFUSE_SECRET_KEY", valueFrom = "${var.secrets_arn}:LANGFUSE_SECRET_KEY::" },
    { name = "DB_PASSWORD",         valueFrom = "${var.secrets_arn}:DB_PASSWORD::" },
  ]
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.prefix}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.backend_cpu
  memory                   = var.backend_memory
  task_role_arn            = var.ecs_task_role_arn
  execution_role_arn       = var.ecs_execution_role_arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.backend_image
      essential = true

      portMappings = [{ containerPort = 8000, protocol = "tcp" }]

      environment = concat(local.backend_env, [
        { name = "DB_HOST",    value = var.db_host },
        { name = "DB_NAME",    value = var.db_name },
        { name = "SMTP_HOST",  value = var.smtp_host },
        { name = "SMTP_PORT",  value = tostring(var.smtp_port) },
        { name = "SMTP_USER",  value = var.smtp_user },
        { name = "ADMIN_DB_URL", value = "postgresql://vantage_admin:$(DB_PASSWORD)@${var.db_host}/${var.db_name}" }
      ])

      secrets = local.backend_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = { Name = "${var.prefix}-backend-task" }
}

resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.prefix}-frontend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.frontend_cpu
  memory                   = var.frontend_memory
  task_role_arn            = var.ecs_task_role_arn
  execution_role_arn       = var.ecs_execution_role_arn

  container_definitions = jsonencode([
    {
      name      = "frontend"
      image     = var.frontend_image
      essential = true

      portMappings = [{ containerPort = 80, protocol = "tcp" }]

      environment = [
        { name = "VITE_API_URL", value = "https://${var.domain_name}" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.frontend.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = { Name = "${var.prefix}-frontend-task" }
}

# ---------------------------------------------------------------------------
# ECS Services
# ---------------------------------------------------------------------------

resource "aws_ecs_service" "backend" {
  name            = "${var.prefix}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.backend_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 8000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  tags = { Name = "${var.prefix}-backend-svc" }
}

resource "aws_ecs_service" "frontend" {
  name            = "${var.prefix}-frontend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = var.frontend_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = 80
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = { Name = "${var.prefix}-frontend-svc" }
}

# ---------------------------------------------------------------------------
# Auto-scaling (backend)
# ---------------------------------------------------------------------------

resource "aws_appautoscaling_target" "backend" {
  max_capacity       = var.backend_desired_count * 4
  min_capacity       = var.backend_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${var.prefix}-backend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value = 70.0
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "alb_dns_name"      { value = aws_lb.main.dns_name }
output "alb_arn_suffix"    { value = aws_lb.main.arn_suffix }
output "ecs_cluster_name"  { value = aws_ecs_cluster.main.name }
