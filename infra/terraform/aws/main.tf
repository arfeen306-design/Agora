locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

resource "random_password" "db_master" {
  length           = 32
  special          = true
  override_special = "_%@#"
}

resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "${local.name_prefix}/db/master"
  description = "Agora managed Postgres master credentials"
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = var.db_subnet_ids
}

resource "aws_security_group" "postgres" {
  name        = "${local.name_prefix}-db-sg"
  description = "Allow Postgres traffic from Agora API workers"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "postgres_from_apps" {
  for_each                     = toset(var.app_security_group_ids)
  security_group_id            = aws_security_group.postgres.id
  referenced_security_group_id = each.value
  from_port                    = var.db_port
  to_port                      = var.db_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "postgres_egress_any" {
  security_group_id = aws_security_group.postgres.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name_prefix}-postgres15"
  family = "postgres15"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = "15.6"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_max_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_master.result
  port     = var.db_port

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.postgres.id]
  parameter_group_name   = aws_db_parameter_group.postgres.name

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  multi_az                      = var.db_multi_az
  deletion_protection           = true
  skip_final_snapshot           = true
  auto_minor_version_upgrade    = true
  performance_insights_enabled  = true
  publicly_accessible           = false
  iam_database_authentication_enabled = true
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    engine   = "postgres"
    host     = aws_db_instance.postgres.address
    port     = var.db_port
    dbname   = var.db_name
    username = var.db_username
    password = random_password.db_master.result
    sslmode  = "require"
    url      = "postgresql://${var.db_username}:${random_password.db_master.result}@${aws_db_instance.postgres.address}:${var.db_port}/${var.db_name}?sslmode=require"
  })
}

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "db_cpu_high" {
  alarm_name          = "${local.name_prefix}-db-cpu-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.db_cpu_warning_percent
  alarm_description   = "RDS CPU is above threshold."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "missing"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }
}

resource "aws_cloudwatch_metric_alarm" "db_connections_high" {
  alarm_name          = "${local.name_prefix}-db-connections-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.db_connections_warning
  alarm_description   = "RDS connections are above threshold."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "missing"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }
}

resource "aws_cloudwatch_metric_alarm" "db_free_storage_low" {
  alarm_name          = "${local.name_prefix}-db-free-storage-low"
  comparison_operator = "LessThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.db_free_storage_critical_bytes
  alarm_description   = "RDS free storage is below threshold."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_queue_depth_high" {
  alarm_name          = "${local.name_prefix}-worker-queue-depth-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "NotificationQueueDepth"
  namespace           = var.worker_metrics_namespace
  period              = 60
  statistic           = "Maximum"
  threshold           = var.worker_queue_depth_warning
  alarm_description   = "Notification queue depth above threshold."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    Service = var.worker_service_dimension
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_oldest_queued_high" {
  alarm_name          = "${local.name_prefix}-worker-oldest-queued-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "NotificationOldestQueuedMinutes"
  namespace           = var.worker_metrics_namespace
  period              = 60
  statistic           = "Maximum"
  threshold           = var.worker_oldest_queued_minutes_warning
  alarm_description   = "Oldest queued notification age above threshold."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    Service = var.worker_service_dimension
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_failed_pending_high" {
  alarm_name          = "${local.name_prefix}-worker-failed-pending-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "NotificationFailedPending"
  namespace           = var.worker_metrics_namespace
  period              = 60
  statistic           = "Maximum"
  threshold           = var.worker_failed_pending_warning
  alarm_description   = "Failed notifications pending retry above threshold."
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    Service = var.worker_service_dimension
  }
}
