#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-agora}"
DB_USER="${DB_USER:-agora_user}"
DB_PASSWORD="${DB_PASSWORD:-}"
DRILL_DB_PREFIX="${DRILL_DB_PREFIX:-agora_drill}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/agora-backups}"
KEEP_DRILL_DB="${KEEP_DRILL_DB:-false}"

export PGPASSWORD="$DB_PASSWORD"

timestamp="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
backup_file="${BACKUP_DIR}/${DB_NAME}_${timestamp}.dump"
drill_db="${DRILL_DB_PREFIX}_${timestamp}"

echo "[drill] source db: ${DB_NAME} @ ${DB_HOST}:${DB_PORT}"
echo "[drill] backup file: ${backup_file}"
echo "[drill] drill db: ${drill_db}"

pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -Fc \
  -f "$backup_file"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${drill_db};" >/dev/null
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${drill_db};" >/dev/null

pg_restore \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$drill_db" \
  --no-owner \
  --no-privileges \
  "$backup_file"

table_count="$(
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$drill_db" -Atc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"
)"

echo "[drill] restored table count: ${table_count}"
if [[ "${table_count}" -lt 20 ]]; then
  echo "[drill] failed: expected at least 20 tables after restore"
  exit 1
fi

echo "[drill] backup + restore verification passed"

if [[ "${KEEP_DRILL_DB}" != "true" ]]; then
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${drill_db};" >/dev/null
  echo "[drill] dropped drill db ${drill_db}"
else
  echo "[drill] KEEP_DRILL_DB=true, drill db preserved: ${drill_db}"
fi

echo "[drill] completed"
