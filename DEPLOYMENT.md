# Agora Deployment (Step 20-28)

This runbook deploys the backend stack (API + workers + PostgreSQL) using Docker Compose.

## 1) Prepare server

- Install Docker Engine + Docker Compose plugin.
- Create deployment folder:

```bash
sudo mkdir -p /opt/agora
sudo chown -R "$USER":"$USER" /opt/agora
```

## 2) Copy project files to server

Required files:

- `docker-compose.prod.yml`
- `agora-api/.env.production` (create from `agora-api/.env.production.example`)

## 3) Configure production env

On server:

```bash
cp /opt/agora/agora-api/.env.production.example /opt/agora/agora-api/.env.production
```

Update secrets in `/opt/agora/agora-api/.env.production`:

- DB password
- JWT secrets
- Internal API key
- FCM credentials
- Storage credentials

## 4) Start stack

```bash
cd /opt/agora
docker compose -f docker-compose.prod.yml up -d --build
```

## 5) Apply DB schema/migrations

For first deployment:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < /opt/agora/database/agora_schema.sql

docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < /opt/agora/database/dev_seed.sql
```

For existing DBs (Step 19 push token migration):

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < /opt/agora/database/migrations/20260307_push_device_tokens.sql

docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < /opt/agora/database/migrations/20260307_tenant_rls.sql
```

## 6) Health checks

- API health: `GET /api/v1/health`
- Check containers:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker-notifications
```

## 7) Release workflow

- Push a tag like `agora-api-v1.0.0`
- GitHub Actions workflow `Agora API Release` will:
  - run API tests
  - build image from `agora-api/Dockerfile`
  - push image to GHCR

## 8) Backup + Restore Drill

Manual drill command:

```bash
DB_HOST=127.0.0.1 \
DB_PORT=5432 \
DB_NAME=agora \
DB_USER=agora_user \
DB_PASSWORD=change_me \
bash /opt/agora/database/scripts/backup_restore_drill.sh
```

Automated drill workflow:

- GitHub Actions workflow: `DR Backup Restore Drill`
- Runs weekly and can be triggered manually from Actions tab

## 9) Managed Infra Automation (Step 24)

Terraform stack path:

- `/Users/admin/Desktop/Agora/infra/terraform/aws`

Run:

```bash
cd /Users/admin/Desktop/Agora/infra/terraform/aws
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

CI validation workflow:

- `.github/workflows/infra-validate.yml`

## 10) Secrets Manager Runtime Wiring (Step 27)

After Terraform apply, use output `db_credentials_secret_arn` and inject that secret into runtime env as:

- `DB_CREDENTIALS_SECRET_JSON` (recommended)
- or `DB_CREDENTIALS_SECRET_BASE64` (optional if your platform requires base64)

The API now auto-parses this secret JSON (`host`, `port`, `dbname/database`, `username/user`, `password`, optional `sslmode/url`) and overrides manual `DB_*` values.

Example secret payload (matches Terraform output):

```json
{
  "host": "agora-prod-postgres.abc123.us-east-1.rds.amazonaws.com",
  "port": 5432,
  "dbname": "agora",
  "username": "agora_app",
  "password": "generated_password_here",
  "sslmode": "require"
}
```

## 11) CloudWatch Worker Metrics Publisher (Step 28)

Worker service is now included in `docker-compose.prod.yml` as:

- `worker-metrics`

It publishes these metrics into CloudWatch namespace `Agora/Workers`:

- `NotificationQueueDepth`
- `NotificationOldestQueuedMinutes`
- `NotificationFailedPending`

Required runtime env in `agora-api/.env.production`:

- `WORKER_METRICS_PUBLISH_ENABLED=true`
- `WORKER_METRICS_NAMESPACE=Agora/Workers`
- `WORKER_METRICS_SERVICE_DIMENSION=agora-api`
- `WORKER_METRICS_AWS_REGION=<your-region>`

For AWS auth, use IAM role on compute (recommended) or standard AWS env credentials.

## 12) SLO + Alerting Endpoint (Step 25)

Internal monitoring endpoint:

```bash
curl -s http://127.0.0.1:8080/api/v1/internal/observability/slo \
  -H "X-Internal-Api-Key: <INTERNAL_API_KEY>"
```

Use this endpoint for:

- API burn-rate/error-budget monitoring
- Worker queue depth/age/failed-pending threshold alerts
