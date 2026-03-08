# Next Actions for Codex

> Agora — Immediate fixes in priority order

---

## Priority 1 — Permission Corrections (Blocking)

These are incorrect permission configurations in the current code that must be fixed before any new module work begins.

### 1. Add accountant to fee route guards

**File:** `agora-api/src/routes/fees.js`
**Action:** Add `'accountant'` to the `requireRoles()` call on all fee endpoints (plans, invoices, payments).
**Reason:** The accountant role exists and is seeded but has zero access to the finance module it was designed for.

### 2. Add principal and vice_principal read access to fee data

**File:** `agora-api/src/routes/fees.js`
**Action:** Add `'principal'` and `'vice_principal'` to the GET endpoints for fee plans and invoice lists (read-only).
**Reason:** School leadership cannot view financial data.

### 3. Add leadership roles to report endpoints

**File:** `agora-api/src/routes/reports.js`
**Action:** Add `'principal'`, `'vice_principal'` to all summary and export endpoints. Add `'headmistress'` with section-scoped filtering. Add `'accountant'` to fee summary and fee export.
**Reason:** Only school_admin and teacher can currently view reports. Leadership and finance roles are excluded.

### 4. Block self-delegation

**File:** `agora-api/src/routes/rbac.js`
**Action:** In the POST `/rbac/delegations` handler, add validation: `if (granted_to_user_id === req.auth.userId) return 422 "Cannot delegate permissions to yourself."`
**Reason:** Self-delegation circumvents the delegation audit trail.

---

## Priority 2 — Audit Logging Gaps

### 5. Add login and logout audit events

**File:** `agora-api/src/routes/auth.js`
**Action:** After successful login, call `createAuditLog({ schoolId, actorUserId, action: 'auth.session.login', entityName: 'user_sessions', metadata: { email } })`. After failed login, log with action `auth.session.login_failed`. After logout, log `auth.session.logout`.
**Reason:** Authentication events are not currently audited.

### 6. Add export audit events

**Files:** `agora-api/src/routes/reports.js`, `agora-api/src/routes/admin.js`
**Action:** Before returning CSV/PDF data in export endpoints, call `createAuditLog()` with event code `reports.data.exported` or `security.audit.exported`, including the report type, filter parameters, and row count.
**Reason:** Data exports represent sensitive read operations and should be traceable.

---

## Priority 3 — Data Integrity

### 7. Standardize pagination format

**Files:** All route files returning paginated data
**Action:** Ensure all paginated responses use the nested format: `meta.pagination.page`, `meta.pagination.page_size`, `meta.pagination.total_items`, `meta.pagination.total_pages`. Some routes currently use flat `meta.total_items`.
**Reason:** Inconsistent pagination format forces the frontend to handle two shapes.

### 8. Add DB constraint for assessment_type

**File:** New migration
**Action:** Add a CHECK constraint or PostgreSQL enum for `assessments.assessment_type` with values: `quiz`, `assignment`, `monthly`, `term`.
**Reason:** Currently free-form TEXT with no enforcement. Inconsistent values will cause reporting issues.

### 9. Add DB constraint for payment_method

**File:** New migration
**Action:** Add a CHECK constraint for `fee_payments.method` with values: `cash`, `bank`, `online`.
**Reason:** Zod validates at API level but the DB has no constraint. Direct DB inserts or migrations could introduce invalid values.

### 10. Fix staff_classroom_assignments default vs seed mismatch

**File:** Seed file or migration
**Action:** Decide whether `assignment_role` default should be `teacher` or `subject_teacher`. Update the schema default and seed data to match. Recommended: use `subject_teacher` as default since it is more specific.
**Reason:** Schema defaults to `teacher` but seed inserts `subject_teacher`.

---

## Priority 4 — Security Hardening

### 11. Scope device API key per school

**File:** `agora-api/src/routes/attendance.js`
**Action:** Replace the single `DEVICE_API_KEY` environment variable with a per-school key stored in the `schools` table (e.g., `device_api_key_hash` column). The device ingest endpoint should resolve the school from the API key.
**Reason:** A single shared key means any device can submit attendance for any school. In a multi-tenant system this is a security gap.

### 12. Check user is_active in requireAuth middleware

**File:** `agora-api/src/middleware/auth.js`
**Action:** After JWT validation, query `users.is_active` and reject if false. Cache the result for the request duration.
**Reason:** Currently, deactivated users retain access until their JWT expires (up to 15 minutes).

---

## Priority 5 — Cleanup

### 13. Plan teacher/staff_profiles consolidation

**Files:** Multiple route files referencing `teachers` table
**Action:** Document a migration plan to unify the legacy `teachers` table with `staff_profiles`. Update `classroom_subjects`, `homework`, and attendance queries to reference `staff_profiles` instead. The `teachers` table can become a view or be deprecated with a migration.
**Reason:** Two overlapping models for the same entity creates confusion and maintenance burden.

### 14. Remove observability page internal key requirement

**File:** `agora-web/src/app/dashboard/observability/page.tsx`
**Action:** Either remove the observability page from the web dashboard (it is an internal ops concern) or provide a server-side proxy that injects the internal API key so the browser does not need it.
**Reason:** The page calls endpoints that require `X-Internal-Api-Key`, which cannot be safely provided to a browser client.

---

## Execution Notes

- Items 1–4 are quick fixes (30 minutes each). Do them first.
- Items 5–6 add audit coverage. Do them after permission fixes.
- Items 7–10 are data integrity improvements. Do them in the next migration batch.
- Items 11–14 are deeper changes. Plan them but do not rush.
- Do not combine unrelated changes in a single migration file. Each migration should address one concern.
- Run the full test suite after each change. Existing tests in `agora-api/test/` cover RBAC and auth flows.
