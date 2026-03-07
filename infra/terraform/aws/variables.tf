variable "aws_region" {
  description = "AWS region for Agora production resources."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project slug used in resource naming."
  type        = string
  default     = "agora"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "prod"
}

variable "vpc_id" {
  description = "VPC id where API/DB are deployed."
  type        = string
}

variable "db_subnet_ids" {
  description = "Private subnet ids for RDS subnet group."
  type        = list(string)
}

variable "app_security_group_ids" {
  description = "Security groups allowed to reach Postgres."
  type        = list(string)
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  description = "Initial RDS storage in GB."
  type        = number
  default     = 100
}

variable "db_max_storage_gb" {
  description = "RDS autoscaling max storage in GB."
  type        = number
  default     = 500
}

variable "db_name" {
  description = "App database name."
  type        = string
  default     = "agora"
}

variable "db_username" {
  description = "Master username for RDS."
  type        = string
  default     = "agora_app"
}

variable "db_port" {
  description = "PostgreSQL port."
  type        = number
  default     = 5432
}

variable "db_backup_retention_days" {
  description = "Automated backup retention in days."
  type        = number
  default     = 14
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for high availability."
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Optional email for SNS alerts."
  type        = string
  default     = ""
}

variable "db_cpu_warning_percent" {
  description = "CloudWatch warning threshold for DB CPU."
  type        = number
  default     = 80
}

variable "db_connections_warning" {
  description = "CloudWatch warning threshold for DB connections."
  type        = number
  default     = 300
}

variable "db_free_storage_critical_bytes" {
  description = "Critical threshold for low DB free storage bytes."
  type        = number
  default     = 10737418240
}

variable "worker_metrics_namespace" {
  description = "Namespace used for worker metrics."
  type        = string
  default     = "Agora/Workers"
}

variable "worker_service_dimension" {
  description = "Service dimension value used by worker metrics/alarms."
  type        = string
  default     = "agora-api"
}

variable "worker_queue_depth_warning" {
  description = "Alarm threshold for notification queue depth."
  type        = number
  default     = 500
}

variable "worker_oldest_queued_minutes_warning" {
  description = "Alarm threshold for oldest queued notification age."
  type        = number
  default     = 30
}

variable "worker_failed_pending_warning" {
  description = "Alarm threshold for failed notifications pending retry."
  type        = number
  default     = 100
}
