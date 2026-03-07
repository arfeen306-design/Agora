# Codex Coordination File

## What Codex Has Built (Latest)

### Backend Reports (Step 15)
- `routes/reports.js` with summary + CSV/PDF exports:
  - Attendance, Homework, Marks, Fees
- `utils/report-export.js` for shared CSV/PDF generation
- OpenAPI updated with Reports endpoints/schemas

### Backend Admin Audit (Step 16)
- `routes/admin.js`:
  - `GET /api/v1/admin/audit-logs`
  - `GET /api/v1/admin/audit-logs/export`
- `middleware/audit-trail.js`:
  - Auto-logs authenticated write requests (`POST/PATCH/PUT/DELETE`) into `audit_logs`
  - Redacts sensitive keys in payload metadata
- `utils/audit-log.js` shared audit insert + sanitization helpers
- Route mounted in `routes/index.js` under `/admin`
- OpenAPI updated with Admin tag + audit endpoints/schemas

### Backend Tests + CI (Step 17)
- API integration tests added:
  - `agora-api/test/api/auth-and-audit.test.js`
- `package.json` scripts:
  - `npm test`
  - `npm run test:api`
- GitHub Actions workflow added at project root:
  - `.github/workflows/api-ci.yml`
  - Starts PostgreSQL service, applies schema + seed, runs API tests

### Hardware Attendance Ingestion (Step 18)
- Added device endpoint in `routes/attendance.js`:
  - `POST /api/v1/attendance/device-ingest`
- Security:
  - Device API key header (`X-Device-Api-Key`)
- Behavior:
  - Supports RFID/QR/face sources
  - Finds student by `student_id` or `student_code`
  - Resolves classroom from active enrollment
  - Computes `present` vs `late` using school timezone + cutoff time
  - Upserts attendance record, queues parent notifications, emits realtime events
  - Writes audit log entry (`DEVICE_ATTENDANCE_INGEST`)
- OpenAPI updated with `DeviceApiKey` security scheme + endpoint schemas

### Firebase Cloud Messaging (Step 19)
- Push provider supports `fcm` in `services/notification-dispatcher.js`
- New FCM sender service:
  - `services/fcm.js` (OAuth2 JWT assertion + FCM HTTP v1 send)
- Push device token API added in `routes/notifications.js`:
  - `GET /api/v1/notifications/push-tokens`
  - `POST /api/v1/notifications/push-tokens`
  - `DELETE /api/v1/notifications/push-tokens/:tokenId`
- DB support:
  - `push_device_tokens` table added to `database/agora_schema.sql`
  - migration script added: `database/migrations/20260307_push_device_tokens.sql`
- Config/env additions:
  - `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_TOKEN_URI`, `FCM_SCOPE`
- OpenAPI updated with push-token routes and schemas

### Cloud Deployment + Release Pipeline (Step 20)
- Containerization:
  - `agora-api/Dockerfile`
  - `agora-api/.dockerignore`
  - `agora-api/.env.production.example`
- Production stack:
  - `docker-compose.prod.yml` (api + postgres + notification worker + reminder worker)
- Deployment runbook:
  - `DEPLOYMENT.md`
- Release workflow:
  - `.github/workflows/api-release.yml`
  - Runs tests, builds Docker image, pushes to GHCR on tag/manual trigger

### Multi-Tenant Hardening + Observability (Step 21)
- Tenant boundary enforcement:
  - Added guard in `middleware/auth.js`
  - Rejects cross-school hints in request payload/query/params/header (`TENANT_SCOPE_MISMATCH`)
- Observability stack:
  - `middleware/request-observability.js` (structured request logging + counters)
  - `utils/observability.js` (in-memory metrics state)
  - `middleware/error-handler.js` now emits structured error logs + error counters
  - `routes/observability.js`:
    - `GET /api/v1/internal/observability/metrics`
    - `GET /api/v1/internal/observability/ready`
- Route wiring:
  - `routes/index.js` includes observability router
- OpenAPI + tests updated for new internal endpoints and tenant guard behavior

### Production Security Hardening (Step 22)
- API security:
  - Strict production CORS allowlist (`CORS_ALLOWED_ORIGINS`)
  - `x-powered-by` disabled
  - Rate limiting middleware for:
    - `POST /auth/login`
    - `POST /attendance/device-ingest`
    - `/internal/*` endpoints
- Request context + DB session hardening:
  - Added `AsyncLocalStorage` request context (`utils/request-context.js`)
  - DB layer now sets `app.current_school_id` per request session (`src/db.js`)
- RLS migration:
  - `database/migrations/20260307_tenant_rls.sql`
  - Adds tenant policy helper function and enables RLS policies on school-scoped tables

### Backup/Restore Drills + DR Runbook (Step 23)
- Added drill script:
  - `database/scripts/backup_restore_drill.sh`
  - Backs up production DB, restores into temporary drill DB, validates table count, cleans up
- Added CI drill workflow:
  - `.github/workflows/dr-backup-drill.yml`
  - Manual + weekly run
  - Uploads backup artifact
- Deployment runbook updated with drill instructions (`DEPLOYMENT.md`)

### Infra Automation (Step 24)
- Added Terraform stack:
  - `infra/terraform/aws/providers.tf`
  - `infra/terraform/aws/variables.tf`
  - `infra/terraform/aws/main.tf`
  - `infra/terraform/aws/outputs.tf`
  - `infra/terraform/aws/terraform.tfvars.example`
  - `infra/terraform/aws/README.md`
- Provisions:
  - Managed Postgres (RDS)
  - Secrets Manager credentials (generated password)
  - CloudWatch alarms + SNS topic (DB + worker queue)
- Added workflow:
  - `.github/workflows/infra-validate.yml`
  - Runs terraform fmt/init/validate on infra changes

### SLO + Alerting Polish (Step 25)
- New internal endpoint:
  - `GET /api/v1/internal/observability/slo`
- Computes:
  - API availability windows and burn rate against SLO target
  - Error budget remaining %
  - Worker queue alerts (depth, oldest queued age, failed-pending retries)
- Updated:
  - `src/utils/observability.js` (SLO math)
  - `src/routes/observability.js` (new endpoint + alert evaluation)
  - `src/config.js` and env templates for SLO/threshold settings
  - OpenAPI schema/paths
  - API tests for internal SLO endpoint

## What Claude Code Has Built (DO NOT DUPLICATE)

### Web Dashboard (agora-web/)
- Full Next.js 14 Teacher/Admin dashboard with TypeScript + Tailwind CSS
- Pages: Login, Dashboard Overview, Attendance, Homework, Marks, Students, Messaging, Fees, Events
- API client library connecting to agora-api backend
- Auth context with JWT token management
- Responsive sidebar layout with role-based navigation

### Flutter Mobile App (agora-mobile/)
- Full Flutter app for Parent & Student users
- Provider-based state management with AuthProvider
- API client with JWT auth (auto-login, token persistence)
- 7 screens: Login, Dashboard, Attendance, Homework, Marks, Messaging, Notifications
- 6 data models: User, Attendance, Homework, Assessment, Conversation/Message, Notification
- Material Design 3 theme with Agora branding
- Bottom navigation with 5 tabs + notifications in app bar
- Chat UI with WhatsApp-style message bubbles
- NOTE: Needs `flutter create --project-name agora_mobile .` to generate platform folders (android/, ios/)

### Backend API Routes Added
- `routes/fees.js` - Fee plans, invoices, and payments CRUD
- `routes/events.js` - School events CRUD
- Both registered in `routes/index.js`

### What Codex Should Focus On Next
- Keep backend stable and avoid overlap with Claude frontend work
- Production rollout tasks:
  - Wire runtime to Secrets Manager output from Terraform
  - Publish SLO worker queue metrics to CloudWatch namespace `Agora/Workers`
  - Tune SLO/worker thresholds after one week of real traffic

### Architecture Decisions Made
- Next.js App Router (not Pages Router) for web
- Tailwind CSS for styling (no component library)
- Client-side JWT auth with localStorage (web) / SharedPreferences (mobile)
- API calls go through `src/lib/api.ts` (web) / `lib/core/api_client.dart` (mobile)
- Flutter Provider pattern for state management
- Mobile app targets Parent/Student roles, web targets Teacher/Admin roles
