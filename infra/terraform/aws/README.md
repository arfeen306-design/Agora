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

Use output `db_credentials_secret_arn` in your runtime platform (ECS/EC2/Kubernetes) and inject the full secret string into:

- `DB_CREDENTIALS_SECRET_JSON` (recommended)

Optional fallback:

- `DB_CREDENTIALS_SECRET_BASE64`

`agora-api` now parses this JSON at startup and overrides `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` automatically.

## Notes

- Worker alarms (`NotificationQueueDepth`, `NotificationOldestQueuedMinutes`, `NotificationFailedPending`) expect metrics under namespace `Agora/Workers`.
- Step 28 adds `worker-metrics` publisher (`npm run worker:metrics`) that sends these values directly to CloudWatch.
