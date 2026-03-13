# Agora Audit Fix Execution Report (2026-03-10)

## Scope
This report documents the fixes implemented from the latest audit review (`/Users/admin/Desktop/audit_report.md.resolved`) and the validation completed in this run.

## What Was Fixed

### 1. Authentication and Password Security
- Enforced bcrypt-only password verification.
- Removed plaintext-password fallback behavior in API login verification.

Updated file:
- `/Users/admin/Desktop/Agora/agora-api/src/routes/auth.js`

### 2. Role Seed Alignment in Base Schema
- Synced base `roles` seed with currently used RBAC roles so fresh base-schema environments include leadership/ops roles.

Updated file:
- `/Users/admin/Desktop/Agora/database/agora_schema.sql`

### 3. Seed Password Hardening
- Replaced plaintext demo passwords with bcrypt hashes.
- Updated user upsert behavior to refresh `password_hash` when conflicts exist, so existing local DB rows are corrected during reseed.

Updated files:
- `/Users/admin/Desktop/Agora/database/dev_seed.sql`
- `/Users/admin/Desktop/Agora/database/migrations/20260307_institution_seed.sql`

### 4. Existing-DB Password Backfill
- Added migration to backfill known demo users from plaintext values to bcrypt hashes in already-provisioned environments.

Added file:
- `/Users/admin/Desktop/Agora/database/migrations/20260310_password_hash_backfill.sql`

### 5. Migration Runner
- Added a simple migration execution script using `psql` for ordered SQL migration application.

Added file:
- `/Users/admin/Desktop/Agora/scripts/run-migrations.sh`

### 6. Web Auth Role Helper Expansion
- Added missing role helper booleans in auth context for cleaner role-aware page logic.

Updated file:
- `/Users/admin/Desktop/Agora/agora-web/src/lib/auth.tsx`

### 7. Mobile Token Refresh
- Added refresh-token flow to mobile API client:
  - On `401`, attempt `/auth/refresh`.
  - Retry original request once on successful refresh.
  - Clear tokens on refresh failure.

Updated file:
- `/Users/admin/Desktop/Agora/agora-mobile/lib/core/api_client.dart`

### 8. Legacy Flask Secret Hardening
- Removed hardcoded Flask secret usage.
- Now uses `FLASK_SECRET_KEY` with secure random fallback for local/dev.

Updated file:
- `/Users/admin/Desktop/Agora/app.py`

### 9. Test Fixture Stabilization After Auth Hardening
- Updated backend API test setup to remain deterministic under bcrypt-only auth:
  - Seed loading adjustments.
  - Convergence fixture password hashing fixes.
  - Upsert behavior consistency.

Updated files:
- `/Users/admin/Desktop/Agora/agora-api/test/api/admissions-foundation.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/attendance-edge-cases.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/auth-and-audit.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/discipline-foundation.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/documents-vault-foundation.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/hr-payroll-foundation.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/institution-people-rbac.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/phase-a-core-apis.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/response-contract-regression.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/teacher-staff-convergence.test.js`
- `/Users/admin/Desktop/Agora/agora-api/test/api/timetable-foundation.test.js`

### 10. Repo Hygiene for Stale Next Cache Variants
- Added ignore patterns for `.next_broken_*` and `.next_cache_*`.

Updated file:
- `/Users/admin/Desktop/Agora/.gitignore`

## Verification Executed

### Backend
- Command: `npm test` (in `agora-api`)
- Result: **67 passed, 0 failed**

### Web
- Command: `npm test` (in `agora-web`)
- Result: **15 files passed, 41 tests passed**

- Command: `npm run build` (in `agora-web`)
- Result: **Build successful**

- Command: `npm run lint` (in `agora-web`)
- Result: **Pass with 1 existing warning** (React hook dependency warning in timetable page)

### Mobile
- Command: `flutter analyze` (in `agora-mobile`)
- Result: **1 existing warning** (unused field in dashboard screen)

## Current Status
- Critical security findings in auth/seed flow addressed.
- Backend suite is fully green after fixture stabilization.
- Web tests and build are green.
- Mobile compiles/analyzes with one non-blocking warning.

## Remaining Follow-Up (Not completed in this specific run)
- Full role-specific mobile dashboard expansion.
- OpenAPI/Swagger serving endpoint.
- Web global `error.tsx`/`loading.tsx` hardening.
- Optional physical cleanup of already-created `.next_broken_*` directories (now ignored by git).

