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
- CI/CD pipeline (GitHub Actions)
- Automated tests (Jest/Supertest for API)
- RFID/QR hardware integration endpoints
- Cloud deployment configs (AWS/GCP)
- Remove legacy Flask files (app.py, school.db, templates/, venv/)
- Firebase Cloud Messaging integration for push notifications

### Architecture Decisions Made
- Next.js App Router (not Pages Router) for web
- Tailwind CSS for styling (no component library)
- Client-side JWT auth with localStorage (web) / SharedPreferences (mobile)
- API calls go through `src/lib/api.ts` (web) / `lib/core/api_client.dart` (mobile)
- Flutter Provider pattern for state management
- Mobile app targets Parent/Student roles, web targets Teacher/Admin roles
