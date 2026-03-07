# Agora Deployment (Step 20)

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
