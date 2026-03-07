# Agora Infra (AWS Terraform)

This Terraform stack automates Step 24 production infrastructure:

- Managed PostgreSQL (`aws_db_instance`)
- Secrets Manager for DB credentials
- Monitoring + alerting (CloudWatch alarms + SNS topic)

## 1) Prepare values

```bash
cd /Users/admin/Desktop/Agora/infra/terraform/aws
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your real AWS network ids.

## 2) Plan

```bash
terraform init
terraform fmt -recursive
terraform validate
terraform plan
```

## 3) Apply

```bash
terraform apply
```

After apply, confirm email subscription in SNS (if `alert_email` is set).

## 4) Connect API to managed secrets

Use output `db_credentials_secret_arn` in your runtime platform (ECS/EC2/Kubernetes) and map values to:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

## Notes

- Worker alarms (`NotificationQueueDepth`, `NotificationOldestQueuedMinutes`, `NotificationFailedPending`) expect metrics under namespace `Agora/Workers`.
- Step 25 internal SLO endpoint provides these values; publish them to CloudWatch via your runtime collector/sidecar.
