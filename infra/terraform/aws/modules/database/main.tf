# =============================================================================
# Module: Database
# RDS PostgreSQL instance for the Vantage AI admin database.
# Deployed in private subnets, encrypted at rest, automated backups enabled.
# =============================================================================

variable "prefix"                   { type = string }
variable "vpc_id"                   { type = string }
variable "private_subnet_ids"       { type = list(string) }
variable "db_security_group_id"     { type = string }
variable "db_instance_class"        { type = string }
variable "db_allocated_storage"     { type = number }
variable "db_backup_retention_days" { type = number }
variable "db_multi_az"              { type = bool }

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}:?"
}

# ---------------------------------------------------------------------------
# Subnet Group
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "${var.prefix}-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = { Name = "${var.prefix}-db-subnet-group" }
}

# ---------------------------------------------------------------------------
# Parameter Group (enable SSL, performance settings)
# ---------------------------------------------------------------------------

resource "aws_db_parameter_group" "main" {
  name   = "${var.prefix}-pg15"
  family = "postgres15"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = { Name = "${var.prefix}-pg15-params" }
}

# ---------------------------------------------------------------------------
# RDS Instance
# ---------------------------------------------------------------------------

resource "aws_db_instance" "main" {
  identifier = "${var.prefix}-admin-db"

  engine         = "postgres"
  engine_version = "15.6"
  instance_class = var.db_instance_class

  db_name  = "vantage_admin"
  username = "vantage_admin"
  password = random_password.db.result

  # Storage
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 3 # Auto-scaling up to 3x
  storage_type          = "gp3"
  storage_encrypted     = true

  # Network
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.db_security_group_id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  # Maintenance
  parameter_group_name    = aws_db_parameter_group.main.name
  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:00-mon:05:00"
  copy_tags_to_snapshot   = true

  # Safety
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.prefix}-admin-db-final-snapshot"

  # Performance Insights (free tier for db.t3.*)
  performance_insights_enabled = true

  tags = { Name = "${var.prefix}-admin-db" }
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "db_endpoint"   { value = aws_db_instance.main.endpoint; sensitive = true }
output "db_name"       { value = aws_db_instance.main.db_name }
output "db_username"   { value = aws_db_instance.main.username; sensitive = true }
output "db_password"   { value = random_password.db.result; sensitive = true }
output "db_identifier" { value = aws_db_instance.main.identifier }
