# agora-api

Node.js + Express backend scaffold for Agora.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+

## Setup

```bash
cd /Users/admin/Desktop/Agora/agora-api
cp .env.example .env
npm install
npm run dev
```

API base:

- `http://localhost:8080/api/v1`
- Health check: `GET /api/v1/health`

## Contract Sources

- OpenAPI spec: `/Users/admin/Desktop/Agora/api/openapi.yaml`
- API contract notes: `/Users/admin/Desktop/Agora/api/contract.md`
- DB schema: `/Users/admin/Desktop/Agora/database/agora_schema.sql`

## Next Implementation

1. Production security hardening (RLS + secrets)
2. Infra automation (managed DB, secrets manager, monitoring)
3. SLO/alerting polish (error budget + worker alert thresholds)

## Step 5 Auth (Implemented)

Routes:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### Seed test users

Apply schema + seed:

```bash
psql -h 127.0.0.1 -U agora_user -d agora -f /Users/admin/Desktop/Agora/database/agora_schema.sql
psql -h 127.0.0.1 -U agora_user -d agora -f /Users/admin/Desktop/Agora/database/dev_seed.sql
```

Demo login payload:

```json
{
  "school_code": "agora_demo",
  "email": "teacher1@agora.com",
  "password": "teach123"
}
```

Additional demo users:

- Parent: `parent1@agora.com` / `pass123`
- Student: `student1@agora.com` / `student123`

## Step 6 Attendance (Implemented)

Routes:

- `GET /api/v1/attendance`
- `POST /api/v1/attendance/bulk` (teacher/admin)
- `PATCH /api/v1/attendance/:attendanceId` (teacher/admin)

Sample bulk payload (teacher):

```json
{
  "classroom_id": "60000000-0000-0000-0000-000000000001",
  "attendance_date": "2026-03-07",
  "entries": [
    {
      "student_id": "40000000-0000-0000-0000-000000000001",
      "status": "present",
      "source": "manual",
      "note": "On time"
    },
    {
      "student_id": "40000000-0000-0000-0000-000000000002",
      "status": "late",
      "source": "manual",
      "note": "Late by 5 minutes"
    }
  ]
}
```

## Step 7 Homework (Implemented)

Routes:

- `GET /api/v1/homework`
- `POST /api/v1/homework` (teacher/admin)
- `PATCH /api/v1/homework/:homeworkId` (teacher/admin)
- `DELETE /api/v1/homework/:homeworkId` (teacher/admin)
- `GET /api/v1/homework/:homeworkId/submissions`
- `POST /api/v1/homework/:homeworkId/submissions` (student self, teacher/admin on behalf)
- `PATCH /api/v1/homework/submissions/:submissionId` (teacher/admin)

Sample create homework payload (teacher):

```json
{
  "classroom_id": "60000000-0000-0000-0000-000000000001",
  "subject_id": "70000000-0000-0000-0000-000000000001",
  "title": "Geometry Worksheet 2",
  "description": "Solve Q1-Q8 from chapter 3",
  "due_at": "2026-03-10T12:00:00Z",
  "attachment_urls": [],
  "is_published": true
}
```

## Step 8 Marks (Implemented)

Routes:

- `GET /api/v1/assessments`
- `POST /api/v1/assessments` (teacher/admin)
- `PATCH /api/v1/assessments/:assessmentId` (teacher/admin)
- `POST /api/v1/assessments/:assessmentId/scores/bulk` (teacher/admin)
- `GET /api/v1/students/:studentId/marks/summary` (role-scoped)

Sample create assessment payload:

```json
{
  "classroom_id": "60000000-0000-0000-0000-000000000001",
  "subject_id": "70000000-0000-0000-0000-000000000001",
  "title": "Monthly Test 2",
  "assessment_type": "monthly",
  "max_marks": 50,
  "assessment_date": "2026-03-12"
}
```

## Step 9 Messaging (Implemented)

Routes:

- `GET /api/v1/conversations`
- `POST /api/v1/conversations`
- `GET /api/v1/conversations/:conversationId/messages`
- `POST /api/v1/conversations/:conversationId/messages`
- `POST /api/v1/conversations/:conversationId/read`

Sample create conversation payload:

```json
{
  "kind": "direct",
  "title": null,
  "participant_user_ids": ["20000000-0000-0000-0000-000000000003"]
}
```

## Step 10 Notifications (Implemented)

Routes:

- `GET /api/v1/notifications`
- `PATCH /api/v1/notifications/:notificationId/read`
- `POST /api/v1/notifications/test` (teacher/admin)
- `POST /api/v1/internal/notifications/trigger` (internal API key)

Sample test notification payload:

```json
{
  "user_id": "20000000-0000-0000-0000-000000000003",
  "title": "Test Notification",
  "body": "Agora notification pipeline is active.",
  "channel": "push"
}
```

## Step 11 Realtime WebSocket (Implemented)

WebSocket URL:

- `ws://localhost:8080/ws?access_token=<JWT_ACCESS_TOKEN>`

Supported event types:

- `ws.connected`
- `conversation.new`
- `message.new`
- `conversation.read`
- `notification.new`
- `notification.read`

Notes:

- WebSocket auth uses the same JWT access token as REST API.
- Realtime events are emitted from messaging and notifications routes.

## Step 12 File Storage (Implemented)

Routes:

- `POST /api/v1/files/upload-url`
- `POST /api/v1/files/download-url`
- `PUT /api/v1/files/local/upload/:token` (dev/local provider only)
- `GET /api/v1/files/local/download/:token` (dev/local provider only)

Supported providers:

- `local` (default, works immediately)
- `s3` (AWS S3 or S3-compatible endpoint)
- `gcs` (Google Cloud Storage)

Sample upload-url payload:

```json
{
  "scope": "homework",
  "file_name": "worksheet-3.pdf",
  "content_type": "application/pdf",
  "size_bytes": 120934
}
```

## Step 13 Notification Worker (Implemented)

Worker scripts:

- `npm run worker:notifications`
- `npm run worker:notifications:once`

What it does:

- Polls DB for `queued` notifications
- Retries `failed` notifications with backoff using payload metadata (`retry_count`, `next_retry_at`)
- Dispatches by channel:
  - `in_app` => marks as sent
  - `push` => `mock` (default), `webhook`, or `fcm`
  - `email`, `sms` => `mock` (default) or `webhook`
- Marks row as `sent` or `failed` and stores attempt metadata in `payload`

Worker env keys:

- `NOTIFICATION_WORKER_INTERVAL_MS`, `NOTIFICATION_WORKER_BATCH_SIZE`
- `NOTIFICATION_WORKER_MAX_RETRIES`, `NOTIFICATION_WORKER_BASE_BACKOFF_SECONDS`, `NOTIFICATION_WORKER_MAX_BACKOFF_SECONDS`
- `PUSH_PROVIDER`, `PUSH_WEBHOOK_URL`
- `EMAIL_PROVIDER`, `EMAIL_WEBHOOK_URL`
- `SMS_PROVIDER`, `SMS_WEBHOOK_URL`

## Step 14 Automated Reminders / Cron Jobs (Implemented)

Worker scripts:

- `npm run worker:reminders`
- `npm run worker:reminders:once`

Reminder jobs:

- `homework_due`: reminders for pending homework due within configured hours
- `attendance_absent`: same-day absence alerts to linked parents
- `fee_overdue`: daily overdue fee reminders for unpaid invoices

Important behavior:

- Reminders create `queued` notifications only
- Step 13 notification worker handles actual dispatch/send
- Dedup uses `payload.reminder_key` to avoid duplicate reminders per rule

Reminder env keys:

- `REMINDER_WORKER_INTERVAL_MS`, `REMINDER_WORKER_RUN_ONCE`
- `REMINDER_HOMEWORK_DUE_ENABLED`, `REMINDER_HOMEWORK_DUE_WITHIN_HOURS`
- `REMINDER_ATTENDANCE_ABSENT_ENABLED`
- `REMINDER_FEE_OVERDUE_ENABLED`

## Step 15 Reports/Export Module (Implemented)

Summary endpoints:

- `GET /api/v1/reports/attendance/summary`
- `GET /api/v1/reports/homework/summary`
- `GET /api/v1/reports/marks/summary`
- `GET /api/v1/reports/fees/summary`

Export endpoints (CSV/PDF):

- `GET /api/v1/reports/attendance/export`
- `GET /api/v1/reports/homework/export`
- `GET /api/v1/reports/marks/export`
- `GET /api/v1/reports/fees/export`

Notes:

- Export query supports `format=csv|pdf` and `max_rows` (default 1000, max 10000)
- RBAC/student-visibility scoping is applied before summaries/exports
- PDF generation uses `pdfkit`

## Step 16 Admin Audit Logs + Export (Implemented)

Routes:

- `GET /api/v1/admin/audit-logs` (school_admin only)
- `GET /api/v1/admin/audit-logs/export` (school_admin only)

What is included:

- Filters: `actor_user_id`, `action`, `entity_name`, `date_from`, `date_to`
- Pagination on list endpoint (`page`, `page_size`)
- Export supports `format=csv|pdf` and `max_rows`

Automatic logging behavior:

- Middleware logs authenticated write requests (`POST/PATCH/PUT/DELETE`) into `audit_logs`
- Sensitive fields in payload are redacted (`password`, `token`, `secret`, etc.)
- Metadata includes method, path, status code, duration, request id, and role snapshot

## Step 17 Automated API Tests + CI (Implemented)

Test commands:

- `npm test`
- `npm run test:api`

Coverage currently included:

- Health endpoint availability
- Auth flow (`/auth/login`, `/auth/me`, unauthorized checks)
- RBAC enforcement for admin audit endpoints
- Audit trail logging after write action + CSV export validation
- Device-ingest security + attendance upsert behavior
- Push token register/list/delete flow

Files:

- Test suite: `/Users/admin/Desktop/Agora/agora-api/test/api/auth-and-audit.test.js`
- CI workflow: `/Users/admin/Desktop/Agora/.github/workflows/api-ci.yml`

## Step 18 RFID/QR/Face Attendance Ingestion (Implemented)

Device ingestion route:

- `POST /api/v1/attendance/device-ingest` (device API key auth via `X-Device-Api-Key`)

What it does:

- Accepts device check-ins by `student_id` or `student_code`
- Resolves active classroom enrollment automatically (or validates provided `classroom_id`)
- Computes local attendance date using school timezone
- Auto-sets status as `present` or `late` using configured local cutoff time
- Upserts attendance for same student/date
- Queues parent notifications and emits realtime notification events
- Writes device action into `audit_logs`

New env keys:

- `ATTENDANCE_DEVICE_API_KEY`
- `ATTENDANCE_DEVICE_LATE_AFTER_LOCAL_TIME` (default `08:05:00`)
- `ATTENDANCE_DEVICE_NOTIFICATION_CHANNEL` (`push` by default)

## Step 19 Firebase Cloud Messaging Integration (Implemented)

Push token management routes:

- `GET /api/v1/notifications/push-tokens`
- `POST /api/v1/notifications/push-tokens`
- `DELETE /api/v1/notifications/push-tokens/:tokenId`

Notification worker update:

- Push provider now supports `fcm` in addition to `mock`/`webhook`
- Worker sends push notifications through FCM HTTP v1 when `PUSH_PROVIDER=fcm`
- Invalid/unregistered FCM tokens are auto-deactivated

Database:

- New table `push_device_tokens`
- Full schema includes it in `/Users/admin/Desktop/Agora/database/agora_schema.sql`
- Existing DBs can apply migration:

```bash
psql -h 127.0.0.1 -U agora_user -d agora -f /Users/admin/Desktop/Agora/database/migrations/20260307_push_device_tokens.sql
```

New env keys:

- `FCM_PROJECT_ID`
- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY` (use `\\n` for newlines)
- `FCM_TOKEN_URI` (default `https://oauth2.googleapis.com/token`)
- `FCM_SCOPE` (default `https://www.googleapis.com/auth/firebase.messaging`)

## Step 20 Cloud Deployment + Release Pipeline (Implemented)

Deployment assets:

- `agora-api/Dockerfile` (production Node 20 image)
- `agora-api/.dockerignore`
- `agora-api/.env.production.example`
- `docker-compose.prod.yml` (API + worker-notifications + worker-reminders + postgres)
- `DEPLOYMENT.md` (server runbook)

Release pipeline:

- GitHub Actions workflow: `.github/workflows/api-release.yml`
- Trigger: push tags (`agora-api-v*`, `v*`) or manual dispatch
- Pipeline stages:
  - run API tests
  - build Docker image
  - push image to GHCR (`ghcr.io/<owner>/agora-api`)

## Step 21 Multi-Tenant Hardening + Observability (Implemented)

Tenant hardening:

- Auth middleware now enforces tenant boundary across request params/query/body/header (`school_id`, `schoolId`, `X-School-Id`)
- Cross-school attempts return `403 TENANT_SCOPE_MISMATCH`

Observability:

- Structured request logs for every API request (JSON format)
- Structured error logs from central error handler
- In-memory request/error counters + recent request samples
- New internal endpoints (require `X-Internal-Api-Key`):
  - `GET /api/v1/internal/observability/metrics`
  - `GET /api/v1/internal/observability/ready`

Health update:

- `/api/v1/health` now includes `uptime_seconds`
