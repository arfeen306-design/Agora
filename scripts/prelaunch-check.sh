#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${ROOT_DIR}/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/agora-api/.env.production}"
API_BASE="${API_BASE:-http://127.0.0.1:8080/api/v1}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-}"

fail_count=0
warn_count=0

ok() {
  printf '[OK] %s\n' "$1"
}

warn() {
  warn_count=$((warn_count + 1))
  printf '[WARN] %s\n' "$1"
}

fail() {
  fail_count=$((fail_count + 1))
  printf '[FAIL] %s\n' "$1"
}

require_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "Command found: ${cmd}"
  else
    fail "Missing required command: ${cmd}"
  fi
}

check_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    fail "Missing env file: $ENV_FILE"
    return
  fi

  local bad
  bad="$(grep -nE 'replace_with_|change_me_strong|^DB_PASSWORD=$|^JWT_ACCESS_SECRET=$|^JWT_REFRESH_SECRET=$|^INTERNAL_API_KEY=$|^ATTENDANCE_DEVICE_API_KEY=$' "$ENV_FILE" || true)"
  if [[ -n "$bad" ]]; then
    fail "Found placeholder/empty secrets in $ENV_FILE"
    printf '%s\n' "$bad"
  else
    ok "No obvious placeholder secrets in $ENV_FILE"
  fi
}

check_compose_services() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    fail "Missing compose file: $COMPOSE_FILE"
    return
  fi

  if ! docker compose -f "$COMPOSE_FILE" ps >/dev/null 2>&1; then
    fail "docker compose could not read service status"
    return
  fi

  ok "docker compose status is readable"

  local running
  running="$(docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null || true)"

  if grep -q '^api$' <<<"$running"; then
    ok "API service is running"
  else
    fail "API service is not running"
  fi

  if grep -q '^postgres$' <<<"$running"; then
    ok "Postgres service is running"
  else
    fail "Postgres service is not running"
  fi
}

check_api_health() {
  local health
  health="$(curl -fsS "${API_BASE}/health" || true)"

  if [[ "$health" == *'"success":true'* && "$health" == *'"status":"ok"'* ]]; then
    ok "API health endpoint is up: ${API_BASE}/health"
  else
    fail "API health check failed at ${API_BASE}/health"
    if [[ -n "$health" ]]; then
      printf '%s\n' "$health"
    fi
  fi
}

check_internal_slo() {
  if [[ -z "$INTERNAL_API_KEY" ]]; then
    warn "INTERNAL_API_KEY not set in shell, skipped /internal/observability/slo check"
    return
  fi

  local slo
  slo="$(curl -fsS "${API_BASE}/internal/observability/slo" -H "X-Internal-Api-Key: ${INTERNAL_API_KEY}" || true)"

  if [[ "$slo" == *'"success":true'* && "$slo" == *'"alerts"'* ]]; then
    ok "Internal SLO endpoint check passed"
  else
    fail "Internal SLO endpoint check failed"
    if [[ -n "$slo" ]]; then
      printf '%s\n' "$slo"
    fi
  fi
}

main() {
  echo "== Agora Prelaunch Check =="
  echo "Root: $ROOT_DIR"
  echo "Compose: $COMPOSE_FILE"
  echo "API base: $API_BASE"

  require_cmd docker
  require_cmd curl
  check_env_file
  check_compose_services
  check_api_health
  check_internal_slo

  echo
  echo "Summary: FAIL=$fail_count WARN=$warn_count"
  if (( fail_count > 0 )); then
    exit 1
  fi
}

main "$@"
