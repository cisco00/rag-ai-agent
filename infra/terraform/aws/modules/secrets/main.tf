# =============================================================================
# Module: Secrets
# Stores all sensitive values in AWS Secrets Manager and creates the IAM
# roles that allow ECS tasks to read them at startup.
# =============================================================================

variable "prefix"              { type = string }
variable "llm_api_key"         { type = string; sensitive = true }
variable "jwt_secret"          { type = string; sensitive = true }
variable "encryption_key"      { type = string; sensitive = true }
variable "smtp_pass"           { type = string; sensitive = true; default = "" }
variable "db_password"         { type = string; sensitive = true }
variable "langfuse_public_key" { type = string; sensitive = true; default = "" }
variable "langfuse_secret_key" { type = string; sensitive = true; default = "" }

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# Secrets Manager — single bundle secret (JSON)
# All app secrets are stored as a single JSON blob for atomic versioning.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "vantage_bundle" {
  name                    = "${var.prefix}/vantage-ai/app-secrets"
  description             = "All Vantage AI application secrets for ${var.prefix}"
  recovery_window_in_days = 7

  tags = { Name = "${var.prefix}-app-secrets" }
}

resource "aws_secretsmanager_secret_version" "vantage_bundle" {
  secret_id = aws_secretsmanager_secret.vantage_bundle.id

  secret_string = jsonencode({
    LLM_API_KEY         = var.llm_api_key
    JWT_SECRET          = var.jwt_secret
    ENCRYPTION_KEY      = var.encryption_key
    SMTP_PASS           = var.smtp_pass
    DB_PASSWORD         = var.db_password
    LANGFUSE_PUBLIC_KEY = var.langfuse_public_key
    LANGFUSE_SECRET_KEY = var.langfuse_secret_key
  })
}

# ---------------------------------------------------------------------------
# IAM — ECS Execution Role (pulls images + reads secrets at task start)
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${var.prefix}-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to read the secrets bundle
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.prefix}-ecs-secrets-read"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = aws_secretsmanager_secret.vantage_bundle.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "secretsmanager.${data.aws_region.current.name}.amazonaws.com"
          }
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# IAM — ECS Task Role (runtime permissions — CloudWatch logs, etc.)
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task" {
  name               = "${var.prefix}-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy" "ecs_task_cloudwatch" {
  name = "${var.prefix}-ecs-task-cw"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/vantage/${var.prefix}/*"
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "secrets_bundle_arn"    { value = aws_secretsmanager_secret.vantage_bundle.arn }
output "ecs_execution_role_arn" { value = aws_iam_role.ecs_execution.arn }
output "ecs_task_role_arn"      { value = aws_iam_role.ecs_task.arn }
