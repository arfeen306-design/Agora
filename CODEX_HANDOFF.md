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

### UUID UX Fix (Step 26)
- Added backend lookup routes:
  - `GET /api/v1/lookups/classrooms`
  - `GET /api/v1/lookups/students`
  - `GET /api/v1/lookups/subjects`
- Mounted lookups router in `routes/index.js`
- Web forms now use dropdown selectors instead of raw UUID typing:
  - Attendance
  - Homework
  - Marks
  - Fees
- Added lookup helpers in web API client (`agora-web/src/lib/api.ts`)

### Secrets Runtime Wiring (Step 27)
- API config now supports DB secret injection from runtime:
  - `DB_CREDENTIALS_SECRET_JSON`
  - `DB_CREDENTIALS_SECRET_BASE64`
- Secret payload keys supported:
  - `host`, `port`, `dbname|database`, `username|user`, `password`, optional `ssl|sslmode|url`
- When secret env is set, DB connection config auto-overrides manual `DB_*` values
- Deployment + infra docs updated:
  - `DEPLOYMENT.md`
  - `infra/terraform/aws/README.md`
  - env examples and README status updated

### CloudWatch Worker Metrics Publishing (Step 28)
- Added CloudWatch metrics publisher integration:
  - `src/services/cloudwatch-worker-metrics.js`
  - `src/services/worker-queue-metrics.js`
  - `src/workers/worker-metrics-publisher.js`
- Metrics published:
  - `NotificationQueueDepth`
  - `NotificationOldestQueuedMinutes`
  - `NotificationFailedPending`
- Namespace + dimensions configurable via env (defaults to `Agora/Workers`, `Service=agora-api`)
- Added worker scripts:
  - `npm run worker:metrics`
  - `npm run worker:metrics:once`
- Added `worker-metrics` service to `docker-compose.prod.yml`
- Updated docs/env examples and added tests for metric mapping

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
  - Tune SLO/worker thresholds after one week of real traffic

### Architecture Decisions Made
- Next.js App Router (not Pages Router) for web
- Tailwind CSS for styling (no component library)
- Client-side JWT auth with localStorage (web) / SharedPreferences (mobile)
- API calls go through `src/lib/api.ts` (web) / `lib/core/api_client.dart` (mobile)
- Flutter Provider pattern for state management
- Mobile app targets Parent/Student roles, web targets Teacher/Admin roles

### Launch Readiness (Step 29)
- Added prelaunch smoke-check script:
  - `scripts/prelaunch-check.sh`
- Validates:
  - required commands (`docker`, `curl`)
  - production env placeholders/empty secrets
  - compose running status for `api` and `postgres`
  - `/api/v1/health`
  - `/api/v1/internal/observability/slo` (when `INTERNAL_API_KEY` is set)
- Docker Compose production file cleaned by removing obsolete `version` field.

### Phase 5: Analytics Depth + Multi-Branch Architecture (Step 30)
- **Analytics depth** — new `routes/analytics.js`:
  - `GET /api/v1/analytics/classroom-kpis` — per-classroom attendance/marks/homework KPIs
  - `GET /api/v1/analytics/teacher-performance` — per-teacher assignment/marking stats
  - `GET /api/v1/analytics/students-at-risk` — students below configurable thresholds
  - `GET /api/v1/analytics/targets` — school KPI target config
  - `PATCH /api/v1/analytics/targets` — update KPI targets
- **Multi-branch architecture** — new `routes/branches.js`:
  - `GET /api/v1/branches/groups` — list branch groups
  - `POST /api/v1/branches/groups` — create branch group (super_admin)
  - `GET /api/v1/branches/groups/:id` — group detail + member schools
  - `PATCH /api/v1/branches/groups/:id` — update branch group
  - `GET /api/v1/branches/groups/:id/analytics` — cross-branch KPI comparison
  - `POST /api/v1/branches/groups/:id/schools` — add school to group
  - `DELETE /api/v1/branches/groups/:id/schools/:schoolId` — remove school from group
- **DB changes**:
  - Migration: `database/migrations/20260313_phase5_analytics_multi_branch.sql`
  - New tables: `branch_groups`, `branch_group_admins`
  - New columns: `schools.kpi_targets` (JSONB), `schools.branch_group_id` (FK)
  - New role: `branch_group_admin`
- Routes registered in `routes/index.js`

### Phase 6: Parent/Student Portal + Notification Expansion (Step 31)
- **Parent/Student Portal** — new `routes/portal.js`:
  - `GET /api/v1/portal/parent/dashboard` — aggregated parent dashboard
  - `GET /api/v1/portal/parent/children` — linked students
  - `GET /api/v1/portal/parent/child/:studentId/attendance` — child attendance
  - `GET /api/v1/portal/parent/child/:studentId/academics` — child marks
  - `GET /api/v1/portal/parent/child/:studentId/homework` — child homework
  - `GET /api/v1/portal/parent/child/:studentId/fees` — child fee invoices
  - `GET /api/v1/portal/student/dashboard` — aggregated student dashboard
  - `GET /api/v1/portal/student/timetable` — student timetable
- **Notification Expansion** — added to `routes/notifications.js`:
  - `GET /api/v1/notifications/scheduled` — list scheduled notifications
  - `POST /api/v1/notifications/scheduled` — create scheduled notification
  - `DELETE /api/v1/notifications/scheduled/:id` — cancel scheduled notification
  - `POST /api/v1/notifications/bulk` — bulk send (role/classroom/all)
  - `GET /api/v1/notifications/preferences` — user notification preferences
  - `PATCH /api/v1/notifications/preferences` — update preferences
  - WhatsApp channel support added to all notification schemas
- **DB changes**:
  - Migration: `database/migrations/20260313_phase6_notifications_portal.sql`
  - New tables: `scheduled_notifications`, `notification_preferences`
  - Updated enum: `notification_channel` += `whatsapp`
- Portal router registered in `routes/index.js`

### Phase 7: Transport, Library & Teacher Leave Self-Service (Step 32)
- **Transport Management** — new `routes/transport.js`:
  - Routes CRUD (list/create/update/deactivate)
  - Stops management (list/add/remove per route)
  - Vehicles CRUD (list/register/update)
  - Student-route assignments (list/assign/deactivate)
  - Roles: `school_admin`, `transport_admin`
- **Library Management** — new `routes/library.js`:
  - Book catalog CRUD (browse/search/detail/add/update/remove)
  - Issue/return workflow with transactional copy tracking
  - Transactions list, overdue report, member history
  - Library dashboard stats
  - Roles: `school_admin`, `librarian`
- **Teacher Leave Self-Service** — added to `routes/hr.js`:
  - `GET /api/v1/people/hr/my/leave-balance` — own leave balance by type
  - `POST /api/v1/people/hr/my/leave-requests` — submit leave request
  - `GET /api/v1/people/hr/my/leave-requests` — view own requests
  - `DELETE /api/v1/people/hr/my/leave-requests/:id` — cancel pending
  - `PATCH /api/v1/people/hr/leave-requests/:id/approve` — admin approve/reject
- **DB changes**:
  - Migration: `database/migrations/20260313_phase7_transport_library_leave.sql`
  - New tables: `transport_routes`, `transport_stops`, `transport_vehicles`, `transport_assignments`, `library_books`, `library_transactions`, `leave_requests`
  - New roles: `transport_admin`, `librarian`
- Transport + library routers registered in `routes/index.js`

### Phase 7: AI Tutor Infrastructure (Step 33)
- **AI Engine** — new `services/ai-engine.js`:
  - Context building (student grade, subject, recent marks, curriculum data)
  - OpenAI chat integration with lazy-loaded client
  - Token budget enforcement per school (monthly cap)
  - Session summarization via AI
  - Dev-mode mock response generator (no API key required)
- **Tutor API** — new `routes/tutor.js`:
  - `POST /api/v1/tutor/sessions` — start tutoring session
  - `GET /api/v1/tutor/sessions` — list own sessions
  - `GET /api/v1/tutor/sessions/:id` — session detail with messages
  - `POST /api/v1/tutor/sessions/:id/messages` — send message & get AI response
  - `POST /api/v1/tutor/sessions/:id/close` — close & summarize session
  - `GET /api/v1/tutor/history` — student/parent history & stats
  - `GET /api/v1/tutor/usage` — admin usage dashboard
  - `GET /api/v1/tutor/config` — get school tutor config
  - `PATCH /api/v1/tutor/config` — update tutor settings
  - `GET /api/v1/tutor/insights/:studentId` — teacher learning insights
- **DB changes**:
  - Migration: `database/migrations/20260313_phase7_ai_tutor.sql`
  - New tables: `tutor_configs`, `tutor_sessions`, `tutor_messages`, `tutor_contexts`, `tutor_usage_logs`
  - Config already in `config.js` (`ai.apiKey`, `ai.model`, `ai.tokenBudgetPerSchool`)
- Tutor router registered in `routes/index.js`

### Phase 8: Mobile App Features (Step 34)
- **Mobile API** — new `routes/mobile.js`:
  - `POST /api/v1/mobile/devices` — register push device (FCM/APNs)
  - `DELETE /api/v1/mobile/devices` — unregister device
  - `GET /api/v1/mobile/sync/parent` — parent quick-sync (badge counts)
  - `GET /api/v1/mobile/sync/student` — student quick-sync (today's data)
  - `GET /api/v1/mobile/feed` — unified notification + event feed
  - `GET /api/v1/mobile/child/:id/discipline` — child discipline incidents
  - `GET /api/v1/mobile/child/:id/transport` — child transport assignment
  - `GET /api/v1/mobile/child/:id/report-cards` — child report cards
  - `GET /api/v1/mobile/student/discipline` — own discipline incidents
  - `GET /api/v1/mobile/student/transport` — own transport assignment
  - `GET /api/v1/mobile/student/report-cards` — own report cards
  - `GET /api/v1/mobile/app-check` — app version & maintenance check
- **DB changes**:
  - Migration: `database/migrations/20260313_phase8_mobile.sql`
  - New tables: `user_devices`, `app_configs`
- Mobile router registered in `routes/index.js`

### Phase 9: Notification System Enhancement (Step 35)
- **WhatsApp Channel** — added to `services/notification-dispatcher.js`:
  - `sendWhatsApp()` with webhook/mock pattern
  - Config: `WHATSAPP_PROVIDER`, `WHATSAPP_WEBHOOK_URL` in `config.js`
- **Notification Templates** — new `services/notification-templates.js`:
  - 28 pre-defined templates across 9 categories (attendance, homework, fees, transport, library, tutor, discipline, leave, general)
  - Variable interpolation with `{{key}}` syntax
- **Event-Driven Triggers** — new `services/notification-triggers.js`:
  - `triggerNotification()` — queues with preference checking
  - `triggerByRole()` — target by role code
  - `triggerForStudentParents()` — target student's linked parents
- **New Reminder Jobs** — added to `services/reminder-jobs.js`:
  - `queueLibraryOverdueReminders()` — overdue library books
  - `queueLeavePendingReminders()` — pending leave requests > 2 days
- **Analytics Endpoints** — added to `routes/notifications.js`:
  - `GET /api/v1/notifications/analytics` — delivery stats by channel, daily volumes
  - `GET /api/v1/notifications/delivery-log` — detailed delivery log with filters
  - `GET /api/v1/notifications/templates` — list available templates

### Phase 10: AI Tutor Release — Full Integration (Step 36)
- **Portal Integration** — `routes/portal.js`:
  - Student dashboard now includes `tutor_stats` (sessions, active, subjects explored)
- **Mobile Integration** — `routes/mobile.js`:
  - Student sync includes `tutor.active_sessions` + `tutor.enabled`
  - `GET /api/v1/mobile/student/tutor-quick` — student tutor status
  - `GET /api/v1/mobile/child/:id/tutor-quick` — parent child tutor summary
- **Notification Triggers** — wired into `routes/tutor.js`:
  - Session close → parent notification with summary (`tutor.session_summary`)
  - Budget 80% → admin notification (`tutor.budget_warning`)
- **Analytics** — new endpoints in `routes/tutor.js`:
  - `GET /api/v1/tutor/analytics/trends` — daily/weekly/monthly engagement trends
  - `GET /api/v1/tutor/analytics/leaderboard` — top students + subjects
- **Admin Moderation** — new endpoints in `routes/tutor.js`:
  - `GET /api/v1/tutor/admin/sessions` — browse all school sessions (with filters)
  - `POST /api/v1/tutor/admin/sessions/:id/terminate` — force-close a session
