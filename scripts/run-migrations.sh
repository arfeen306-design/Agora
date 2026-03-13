#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/database/migrations"
ENV_FILE="${ROOT_DIR}/agora-api/.env"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed or not on PATH."
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL_CONN=(psql "${DATABASE_URL}")
elif [[ -n "${DB_HOST:-}" && -n "${DB_USER:-}" && -n "${DB_NAME:-}" ]]; then
  PSQL_CONN=(psql -h "${DB_HOST}" -p "${DB_PORT:-5432}" -U "${DB_USER}" -d "${DB_NAME}")
else
  echo "Error: DATABASE_URL or DB_HOST/DB_USER/DB_NAME must be set."
  exit 1
fi

echo "Applying migrations from: ${MIGRATIONS_DIR}"

for file in "${MIGRATIONS_DIR}"/*.sql; do
  [[ -f "${file}" ]] || continue
  echo "-> $(basename "${file}")"
  "${PSQL_CONN[@]}" -v ON_ERROR_STOP=1 -f "${file}"
done

echo "Migrations applied successfully."
