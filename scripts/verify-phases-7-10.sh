#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/agora-api"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080/api/v1}"

ADMIN_SCHOOL_CODE="${ADMIN_SCHOOL_CODE:-agora_demo}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@agora.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
STUDENT_EMAIL="${STUDENT_EMAIL:-student1@agora.com}"
STUDENT_PASSWORD="${STUDENT_PASSWORD:-student123}"
PARENT_EMAIL="${PARENT_EMAIL:-parent1@agora.com}"
PARENT_PASSWORD="${PARENT_PASSWORD:-pass123}"
TUTOR_TOPIC="${TUTOR_TOPIC:-Linear equations practice}"
TUTOR_MESSAGE="${TUTOR_MESSAGE:-How do I solve 2x + 5 = 17?}"

read_env_value() {
  local key="$1"
  local default_value="$2"
  local env_file="$API_DIR/.env"
  if [[ -f "$env_file" ]]; then
    local found
    found=$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true)
    if [[ -n "$found" ]]; then
      printf '%s' "$found"
      return
    fi
  fi
  printf '%s' "$default_value"
}

DB_HOST="${DB_HOST:-$(read_env_value DB_HOST 127.0.0.1)}"
DB_PORT="${DB_PORT:-$(read_env_value DB_PORT 5432)}"
DB_NAME="${DB_NAME:-$(read_env_value DB_NAME agora)}"
DB_USER="${DB_USER:-$(read_env_value DB_USER agora_user)}"
DB_PASSWORD="${DB_PASSWORD:-$(read_env_value DB_PASSWORD change_me)}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[FAIL] Missing required command: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd python3
need_cmd node

json_get() {
  local path="$1"
  python3 -c '
import json, sys
path = sys.argv[1].split(".") if sys.argv[1] else []
obj = json.load(sys.stdin)
for part in path:
    if part.isdigit():
        obj = obj[int(part)]
    else:
        obj = obj[part]
if isinstance(obj, bool):
    print("true" if obj else "false")
elif obj is None:
    print("")
elif isinstance(obj, (dict, list)):
    print(json.dumps(obj))
else:
    print(obj)
' "$path"
}

api_call() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local body="${4:-}"
  local tmp
  tmp=$(mktemp)
  local code
  if [[ -n "$token" && -n "$body" ]]; then
    code=$(curl -s -o "$tmp" -w '%{http_code}' -X "$method" "$BASE_URL$path" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$body")
  elif [[ -n "$token" ]]; then
    code=$(curl -s -o "$tmp" -w '%{http_code}' -X "$method" "$BASE_URL$path" -H "Authorization: Bearer $token")
  elif [[ -n "$body" ]]; then
    code=$(curl -s -o "$tmp" -w '%{http_code}' -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json' -d "$body")
  else
    code=$(curl -s -o "$tmp" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  fi
  API_CODE="$code"
  API_RESPONSE=$(cat "$tmp")
  rm -f "$tmp"
}

assert_ok() {
  local step="$1"
  local expected_code="${2:-200}"
  if [[ "$API_CODE" != "$expected_code" ]]; then
    echo "[FAIL] $step (HTTP $API_CODE)"
    echo "$API_RESPONSE"
    exit 1
  fi
  local success
  success=$(printf '%s' "$API_RESPONSE" | json_get success)
  if [[ "$success" != "true" ]]; then
    echo "[FAIL] $step (success != true)"
    echo "$API_RESPONSE"
    exit 1
  fi
  echo "[OK] $step"
}

query_parent_notification() {
  (
    cd "$API_DIR"
    DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" PARENT_EMAIL="$PARENT_EMAIL" \
    node - <<'NODE'
const { Client } = require('pg');
(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  const result = await client.query(`
    select n.title, n.body, n.channel, n.status, n.created_at
    from notifications n
    join users u on u.id = n.user_id
    where u.email = $1 and n.title = 'Tutoring Session Summary'
    order by n.created_at desc
    limit 1
  `, [process.env.PARENT_EMAIL]);
  process.stdout.write(JSON.stringify(result.rows[0] || null));
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
  )
}

echo "== Agora Phases 7-10 Verification =="
echo "Base URL: $BASE_URL"

api_call GET /health
assert_ok "Health check"

api_call POST /auth/login "" "{\"school_code\":\"$ADMIN_SCHOOL_CODE\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
assert_ok "Admin login"
ADMIN_TOKEN=$(printf '%s' "$API_RESPONSE" | json_get data.access_token)

api_call POST /auth/login "" "{\"school_code\":\"$ADMIN_SCHOOL_CODE\",\"email\":\"$STUDENT_EMAIL\",\"password\":\"$STUDENT_PASSWORD\"}"
assert_ok "Student login"
STUDENT_TOKEN=$(printf '%s' "$API_RESPONSE" | json_get data.access_token)

api_call POST /auth/login "" "{\"school_code\":\"$ADMIN_SCHOOL_CODE\",\"email\":\"$PARENT_EMAIL\",\"password\":\"$PARENT_PASSWORD\"}"
assert_ok "Parent login"
PARENT_TOKEN=$(printf '%s' "$API_RESPONSE" | json_get data.access_token)

api_call PATCH /tutor/config "$ADMIN_TOKEN" '{"is_enabled":true}'
assert_ok "Enable tutor config"

api_call GET /portal/student/dashboard "$STUDENT_TOKEN"
assert_ok "Student portal dashboard (pre-session)"
STUDENT_ID=$(printf '%s' "$API_RESPONSE" | json_get data.student_id)

api_call POST /tutor/sessions "$STUDENT_TOKEN" "{\"topic\":\"$TUTOR_TOPIC\"}"
assert_ok "Student creates tutor session" 201
SESSION_ID=$(printf '%s' "$API_RESPONSE" | json_get data.id)
SESSION_STATUS=$(printf '%s' "$API_RESPONSE" | json_get data.status)
if [[ "$SESSION_STATUS" != "active" ]]; then
  echo "[FAIL] Session did not start active"
  echo "$API_RESPONSE"
  exit 1
fi

api_call POST "/tutor/sessions/$SESSION_ID/messages" "$STUDENT_TOKEN" "{\"content\":\"$TUTOR_MESSAGE\"}"
assert_ok "Student sends tutor message"
ASSISTANT_REPLY=$(printf '%s' "$API_RESPONSE" | json_get data.assistant_message.content)
if [[ -z "$ASSISTANT_REPLY" ]]; then
  echo "[FAIL] Tutor reply was empty"
  exit 1
fi

api_call POST "/tutor/sessions/$SESSION_ID/close" "$STUDENT_TOKEN"
assert_ok "Student closes tutor session"
CLOSED_STATUS=$(printf '%s' "$API_RESPONSE" | json_get data.status)
SUMMARY=$(printf '%s' "$API_RESPONSE" | json_get data.summary)
if [[ "$CLOSED_STATUS" != "closed" || -z "$SUMMARY" ]]; then
  echo "[FAIL] Closed session missing status or summary"
  echo "$API_RESPONSE"
  exit 1
fi

api_call GET "/tutor/history?student_id=$STUDENT_ID" "$PARENT_TOKEN"
assert_ok "Parent tutor history"
PARENT_SESSION_ID=$(printf '%s' "$API_RESPONSE" | json_get data.sessions.0.id)
PARENT_STATUS=$(printf '%s' "$API_RESPONSE" | json_get data.sessions.0.status)
if [[ "$PARENT_SESSION_ID" != "$SESSION_ID" || "$PARENT_STATUS" != "closed" ]]; then
  echo "[FAIL] Parent history did not return the closed session"
  echo "$API_RESPONSE"
  exit 1
fi

api_call GET /portal/student/dashboard "$STUDENT_TOKEN"
assert_ok "Student portal dashboard (post-session)"
PORTAL_TOTAL=$(printf '%s' "$API_RESPONSE" | json_get data.tutor_stats.total_sessions)
PORTAL_ACTIVE=$(printf '%s' "$API_RESPONSE" | json_get data.tutor_stats.active_sessions)
if [[ "$PORTAL_TOTAL" -lt 1 || "$PORTAL_ACTIVE" != "0" ]]; then
  echo "[FAIL] Portal tutor_stats not updated as expected"
  echo "$API_RESPONSE"
  exit 1
fi

api_call GET /mobile/student/tutor-quick "$STUDENT_TOKEN"
assert_ok "Mobile student tutor quick"
STUDENT_ENABLED=$(printf '%s' "$API_RESPONSE" | json_get data.tutor_enabled)
if [[ "$STUDENT_ENABLED" != "true" ]]; then
  echo "[FAIL] Mobile student tutor quick did not report tutor_enabled=true"
  echo "$API_RESPONSE"
  exit 1
fi

api_call GET "/mobile/child/$STUDENT_ID/tutor-quick" "$PARENT_TOKEN"
assert_ok "Mobile parent tutor quick"
PARENT_TOTAL=$(printf '%s' "$API_RESPONSE" | json_get data.stats.total_sessions)
if [[ "$PARENT_TOTAL" -lt 1 ]]; then
  echo "[FAIL] Mobile parent tutor quick did not return session stats"
  echo "$API_RESPONSE"
  exit 1
fi

NOTIFICATION_JSON=""
for attempt in 1 2 3 4 5; do
  NOTIFICATION_JSON=$(query_parent_notification || true)
  if [[ -n "$NOTIFICATION_JSON" && "$NOTIFICATION_JSON" != "null" ]]; then
    break
  fi
  sleep 1
done
if [[ -z "$NOTIFICATION_JSON" || "$NOTIFICATION_JSON" == "null" ]]; then
  echo "[FAIL] Parent session summary notification not found"
  exit 1
fi

echo "[OK] Parent session summary notification queued"
echo
echo "Session ID: $SESSION_ID"
echo "Student ID: $STUDENT_ID"
echo "Tutor reply: $ASSISTANT_REPLY"
echo "Notification: $NOTIFICATION_JSON"
echo
echo "All Phase 7-10 tutor family checks passed."
