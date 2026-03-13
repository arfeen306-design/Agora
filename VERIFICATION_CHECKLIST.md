# Agora LMS — Phases 7–10 Verification Checklist

> Hand this file to anyone who needs to verify and validate the integration.
> Server: `http://localhost:8080` | DB: `agora` on localhost:5432

---

## Quick Start

```bash
# 1. Start PostgreSQL
brew services start postgresql@16

# 2. Reset & apply schema (if needed)
/opt/homebrew/opt/postgresql@16/bin/psql postgres -c "DROP DATABASE IF EXISTS agora;"
/opt/homebrew/opt/postgresql@16/bin/psql postgres -c "CREATE DATABASE agora OWNER agora_user;"
PGPASSWORD=change_me /opt/homebrew/opt/postgresql@16/bin/psql -U agora_user -d agora \
  -f /Users/admin/Desktop/Agora/database/agora_schema.sql

# 3. Syntax check
cd /Users/admin/Desktop/Agora/agora-api
npm run check   # must print "syntax_ok"

# 4. Start dev server
npm run dev   # → "Agora API listening on http://localhost:8080"

# 5. Health check
curl -s http://localhost:8080/api/v1/health | python3 -m json.tool
# expected envelope:
# {
#   "success": true,
#   "data": {
#     "service": "agora-api",
#     "status": "ok",
#     "db": "up",
#     ...
#   },
#   "meta": {
#     "request_id": "..."
#   }
# }

# 6. Login with seeded demo school admin
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"school_code":"agora_demo","email":"admin@agora.com","password":"admin123"}'
# copy access_token from response
```

Notes:

- There is no `/api/v1/auth/register` route in the current Agora API.
- Login requires `school_code`, `email`, and `password`.
- If you already have the API running, reuse that process instead of starting a second copy.

---

## Files Modified/Created (Phases 7–10)

### Phase 7: AI Tutor Infrastructure

| Status | File | Lines | What |
|--------|------|-------|------|
| NEW | `src/services/ai-engine.js` | 331 | AI engine: context, chat, budget, mock |
| NEW | `src/routes/tutor.js` | 818 | 14 tutor endpoints |
| NEW | `database/migrations/20260313_phase7_ai_tutor.sql` | 113 | 5 tables migration |
| MOD | `database/agora_schema.sql` | +85 | tutor tables in base schema |
| MOD | `src/routes/index.js` | +2 | registered tutor router |

### Phase 8: Mobile App Features

| Status | File | Lines | What |
|--------|------|-------|------|
| NEW | `src/routes/mobile.js` | 569 | 14 mobile endpoints |
| NEW | `database/migrations/20260313_phase8_mobile.sql` | 52 | 2 tables migration |
| MOD | `database/agora_schema.sql` | +42 | user_devices + app_configs |
| MOD | `src/routes/index.js` | +2 | registered mobile router |

### Phase 9: Notification System Enhancement

| Status | File | Lines | What |
|--------|------|-------|------|
| NEW | `src/services/notification-templates.js` | 210 | 28 templates, 9 categories |
| NEW | `src/services/notification-triggers.js` | 135 | event-driven notifications |
| MOD | `src/services/notification-dispatcher.js` | +11 | WhatsApp channel |
| MOD | `src/services/reminder-jobs.js` | +108 | library_overdue + leave_pending jobs |
| MOD | `src/routes/notifications.js` | +137 | 3 analytics endpoints + templates listing |
| MOD | `src/config.js` | +4 | WhatsApp provider config |

### Phase 10: AI Tutor Release (Full Integration)

| Status | File | What |
|--------|------|------|
| MOD | `src/routes/portal.js` | tutor_stats in student dashboard |
| MOD | `src/routes/mobile.js` | tutor sync + 2 tutor-quick endpoints |
| MOD | `src/routes/tutor.js` | notification triggers, analytics, admin moderation |

---

## Database Tables (Phases 7–10)

```sql
-- Verify all tables exist:
SELECT tablename FROM pg_tables WHERE schemaname = 'public'
AND tablename IN (
  'tutor_configs', 'tutor_sessions', 'tutor_messages',
  'tutor_contexts', 'tutor_usage_logs',
  'user_devices', 'app_configs'
);
-- Expected: 7 rows
```

| Table | Phase | Purpose |
|-------|-------|---------|
| `tutor_configs` | 7 | Per-school AI tutor settings |
| `tutor_sessions` | 7 | Student conversation sessions |
| `tutor_messages` | 7 | Individual messages in sessions |
| `tutor_contexts` | 7 | Curriculum context snapshots |
| `tutor_usage_logs` | 7 | Token consumption tracking |
| `user_devices` | 8 | Push device tokens (FCM/APNs) |
| `app_configs` | 8 | App version + maintenance per school |

---

## API Endpoints — Full Verification Matrix

### Tutor (14 endpoints) — `src/routes/tutor.js`

| Method | Path | Role | Verify |
|--------|------|------|--------|
| POST | `/tutor/sessions` | student | creates new session |
| GET | `/tutor/sessions` | student | lists own sessions |
| GET | `/tutor/sessions/:id` | student | session detail + messages |
| POST | `/tutor/sessions/:id/messages` | student | send message, get AI reply |
| POST | `/tutor/sessions/:id/close` | student | close + summarize + notify parents |
| GET | `/tutor/history` | student, parent | session history + stats |
| GET | `/tutor/usage` | school_admin, principal, vice_principal | usage dashboard |
| GET | `/tutor/config` | school_admin, principal, vice_principal | get tutor config |
| PATCH | `/tutor/config` | school_admin, principal, vice_principal | update tutor settings |
| GET | `/tutor/insights/:studentId` | teacher, school_admin, principal, vice_principal | student learning insights |
| GET | `/tutor/analytics/trends` | school_admin, principal, vice_principal | engagement trends (daily/weekly/monthly) |
| GET | `/tutor/analytics/leaderboard` | school_admin, principal, vice_principal | top students + subjects |
| GET | `/tutor/admin/sessions` | school_admin, principal, vice_principal | browse all school sessions |
| POST | `/tutor/admin/sessions/:id/terminate` | school_admin, principal, vice_principal | force-close session |

### Mobile (14 endpoints) — `src/routes/mobile.js`

| Method | Path | Role | Verify |
|--------|------|------|--------|
| POST | `/mobile/devices` | any authed | register push device |
| DELETE | `/mobile/devices` | any authed | unregister device (body must include `device_token`) |
| GET | `/mobile/sync/parent` | parent | badge counts |
| GET | `/mobile/sync/student` | student | today snapshot + tutor data |
| GET | `/mobile/feed` | parent, student | unified notification+event feed |
| GET | `/mobile/child/:id/discipline` | parent | child discipline incidents |
| GET | `/mobile/child/:id/transport` | parent | child transport assignment |
| GET | `/mobile/child/:id/report-cards` | parent | child report cards |
| GET | `/mobile/child/:id/tutor-quick` | parent | child tutor summary |
| GET | `/mobile/student/discipline` | student | own discipline |
| GET | `/mobile/student/transport` | student | own transport |
| GET | `/mobile/student/report-cards` | student | own report cards |
| GET | `/mobile/student/tutor-quick` | student | own tutor status |
| GET | `/mobile/app-check` | any authed | app version + maintenance |

### Notifications (new/modified endpoints)

| Method | Path | Role | Phase |
|--------|------|------|-------|
| GET | `/notifications/templates` | school_admin, principal, vice_principal | 9 — list templates |
| GET | `/notifications/analytics` | school_admin, principal, vice_principal | 9 — delivery stats |
| GET | `/notifications/delivery-log` | school_admin, principal, vice_principal | 9 — detailed log |

### Portal (modified)

| Method | Path | Change | Phase |
|--------|------|--------|-------|
| GET | `/portal/student/dashboard` | Added `tutor_stats` | 10 |

---

## Integration Points to Verify

### 1. Notification Triggers (Phase 10 → Phase 9)
```
Session close in tutor.js
  → calls triggerForStudentParents()
  → uses "tutor.session_summary" template
  → queues notification in DB respecting preferences

Budget ≥ 80% check
  → calls triggerByRole("school_admin")
  → uses "tutor.budget_warning" template
```
**Verify:** Close a tutor session → check `notifications` table for parent notification.

### 2. WhatsApp Dispatch (Phase 9)
```
notification-dispatcher.js
  → sendWhatsApp() — webhook or mock
  → config.notifications.whatsapp.provider
```
**Verify:** Set `WHATSAPP_PROVIDER=mock` → check console for `[notify:whatsapp:mock]` log.

### 3. Reminder Worker (Phase 9)
```
reminder-jobs.js now runs 5 jobs:
  ✓ homework_due (existing)
  ✓ attendance_absent (existing)
  ✓ fee_overdue (existing)
  ✓ library_overdue (NEW)
  ✓ leave_pending (NEW)
```
**Verify:** `node src/workers/reminder-worker.js` — should log summary with all 5 counters.

### 4. Portal × Tutor (Phase 10 → Phase 7)
```
portal.js student dashboard
  → queries tutor_sessions for stats
  → returns tutor_stats: { total_sessions, active_sessions, subjects_explored }
```

### 5. Mobile × Tutor (Phase 10 → Phase 7)
```
mobile.js student sync
  → tutor.active_sessions from tutor_sessions
  → tutor.enabled from tutor_configs
```

---

## Config Requirements

| Env Variable | Default | Phase |
|---|---|---|
| `OPENAI_API_KEY` | (none — uses mock) | 7 |
| `AI_TUTOR_MODEL` | `gpt-4o-mini` | 7 |
| `AI_TOKEN_BUDGET_PER_SCHOOL` | `500000` | 7 |
| `WHATSAPP_PROVIDER` | `mock` | 9 |
| `WHATSAPP_WEBHOOK_URL` | (empty) | 9 |

---

## Smoke Test Script

```bash
LOGIN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"school_code":"agora_demo","email":"admin@agora.com","password":"admin123"}')
TOKEN=$(printf "%s" "$LOGIN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])')
BASE="http://localhost:8080/api/v1"

# Health
curl -s $BASE/health | python3 -m json.tool

# Notification templates (school admin / leadership)
curl -s $BASE/notifications/templates \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Notification analytics (school admin / leadership)
curl -s "$BASE/notifications/analytics?days=7" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Tutor config (school admin / leadership)
curl -s $BASE/tutor/config \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Tutor analytics trends (school admin / leadership)
curl -s "$BASE/tutor/analytics/trends?period=daily&days=7" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Tutor leaderboard (school admin / leadership)
curl -s "$BASE/tutor/analytics/leaderboard?days=30" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Mobile app check
curl -s $BASE/mobile/app-check \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Register device
curl -s -X POST $BASE/mobile/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device_token":"test_device_token_0123456789","platform":"ios"}' | python3 -m json.tool

# Delete device (requires JSON body)
curl -s -X DELETE $BASE/mobile/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device_token":"test_device_token_0123456789"}' | python3 -m json.tool
```

---

## Dedicated Student / Parent Tutor Flow Verification

This is the exact end-to-end flow verified against the seeded demo data on `2026-03-13`.

### One-command option

```bash
cd /Users/admin/Desktop/Agora
./scripts/verify-phases-7-10.sh
```

### Manual exact commands

```bash
BASE="http://127.0.0.1:8080/api/v1"

# 1. Login as admin, student, and parent
ADMIN_LOGIN=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"school_code":"agora_demo","email":"admin@agora.com","password":"admin123"}')
STUDENT_LOGIN=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"school_code":"agora_demo","email":"student1@agora.com","password":"student123"}')
PARENT_LOGIN=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"school_code":"agora_demo","email":"parent1@agora.com","password":"pass123"}')

ADMIN_TOKEN=$(printf "%s" "$ADMIN_LOGIN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])')
STUDENT_TOKEN=$(printf "%s" "$STUDENT_LOGIN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])')
PARENT_TOKEN=$(printf "%s" "$PARENT_LOGIN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])')

# 2. Enable tutor for the demo school
curl -s -X PATCH $BASE/tutor/config \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_enabled":true}' | python3 -m json.tool

# 3. Pull student_id from the student portal dashboard
PORTAL_BEFORE=$(curl -s $BASE/portal/student/dashboard \
  -H "Authorization: Bearer $STUDENT_TOKEN")
STUDENT_ID=$(printf "%s" "$PORTAL_BEFORE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["student_id"])')

# 4. Create session
SESSION_CREATE=$(curl -s -X POST $BASE/tutor/sessions \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"topic":"Linear equations practice"}')
SESSION_ID=$(printf "%s" "$SESSION_CREATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')

# 5. Send message
curl -s -X POST $BASE/tutor/sessions/$SESSION_ID/messages \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"How do I solve 2x + 5 = 17?"}' | python3 -m json.tool

# 6. Close session
curl -s -X POST $BASE/tutor/sessions/$SESSION_ID/close \
  -H "Authorization: Bearer $STUDENT_TOKEN" | python3 -m json.tool

# 7. Parent tutor history for this student
curl -s "$BASE/tutor/history?student_id=$STUDENT_ID" \
  -H "Authorization: Bearer $PARENT_TOKEN" | python3 -m json.tool

# 8. Portal tutor stats after close
curl -s $BASE/portal/student/dashboard \
  -H "Authorization: Bearer $STUDENT_TOKEN" | python3 -m json.tool

# 9. Mobile quick endpoints
curl -s $BASE/mobile/student/tutor-quick \
  -H "Authorization: Bearer $STUDENT_TOKEN" | python3 -m json.tool
curl -s $BASE/mobile/child/$STUDENT_ID/tutor-quick \
  -H "Authorization: Bearer $PARENT_TOKEN" | python3 -m json.tool
```

### Expected results

1. Session create returns `status: "active"` and a real session id.
2. Message send returns both `user_message` and `assistant_message`.
3. Session close returns `status: "closed"` and a non-empty `summary`.
4. Parent tutor history returns the same session id with `status: "closed"`.
5. Student portal dashboard returns `tutor_stats`.
6. Mobile student tutor quick returns `tutor_enabled: true`.
7. Mobile parent tutor quick returns the same session in `recent_sessions`.
8. A `Tutoring Session Summary` notification is queued for the parent after close.
