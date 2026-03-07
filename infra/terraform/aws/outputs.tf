output "db_instance_endpoint" {
  description = "RDS endpoint hostname."
  value       = aws_db_instance.postgres.address
}

output "db_instance_identifier" {
  description = "RDS instance identifier."
  value       = aws_db_instance.postgres.id
}

output "db_credentials_secret_arn" {
  description = "Secrets Manager ARN containing DB connection credentials."
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "alerts_topic_arn" {
  description = "SNS topic ARN used for platform alerts."
  value       = aws_sns_topic.alerts.arn
}
