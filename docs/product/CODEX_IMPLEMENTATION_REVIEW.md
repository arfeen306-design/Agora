# Codex Implementation Review

> Agora — Review of latest Codex implementation against project documentation
> Review date: 2026-03-08

---

## 1. What Codex Completed Correctly

### Finance Permissions (fees.js)

- **Accountant role added to all fee routes.** Helper functions `canReadFeePlans`, `canManageFeeData`, `canReadInvoices`, `canReadPayments` properly gate access. `canManageFeeData` grants POST/PATCH to `school_admin` and `accountant` only.
- **Principal and vice_principal have read access** to fee plans, invoices, and payments via `canReadFeePlans` and `canReadInvoices`.
- **Parent scoping works correctly.** Parent invoice access uses an EXISTS subquery against `parent_students` + `parents` tables, ensuring parents only see their own children's invoices.
- **Payment reference_no is hidden from non-privileged roles** via `canReadPaymentReference()` (school_admin, accountant only).
- **Payment validation is sound.** Payments are blocked on cancelled invoices, and invoice status auto-transitions (partial/paid) based on amount.
- **Explicit audit logging** on fee plan create, fee plan update, invoice create, payment recorded — using structured event codes like `finance.fee_plan.created`.

### Report Permissions (reports.js)

- **Leadership roles added.** `ensureAcademicReportReadRole` includes school_admin, principal, vice_principal, headmistress, teacher, parent, student.
- **Headmistress is section-scoped.** `appendStudentRoleScopeClause` filters headmistress data via `school_sections.head_user_id` / `coordinator_user_id`.
- **Teacher is classroom-scoped.** Filtered via `classroom_subjects` and `homeroom_teacher` joins.
- **Parent and student are safely scoped.** Parent scoped to own child via `parent_students`. Student scoped to self via `student_user_accounts`.
- **Accountant added to fee reports** via `ensureFeesReportReadRole`.

### Parents CRUD (people.js)

- **All four CRUD operations implemented:**
  - `GET /people/parents` — list with search, scoping, pagination
  - `POST /people/parents` — creates user + parent record + parent role + linked students
  - `GET /people/parents/:parentId` — single parent with linked students
  - `PATCH /people/parents/:parentId` — update parent profile and linked students
- **Proper role guards:** `PARENT_VIEW_ROLES` (school_admin, principal, vice_principal, headmistress, teacher, front_desk) and `PARENT_MANAGE_ROLES` (school_admin, principal, vice_principal, front_desk).
- **Contact visibility gated** by `canViewParentContacts()` — only school_admin, principal, headmistress, teacher can see phone/email.
- **Headmistress section-scoped and teacher classroom-scoped** via `appendParentScope()`.
- **Audit logging present** on parent create (`people.parent.created`) and update (`people.parent.updated`).

### Single Staff Profile (people.js)

- `GET /people/staff/:staffId` implemented with `STAFF_VIEW_ROLES` guard.
- Headmistress access is section-scoped (checks if staff belongs to headmistress's section).

### Single Student Profile (people.js)

- `GET /people/students/:studentId` implemented with access context checks.
- **Sensitive data filtering works:** `canViewStudentSensitiveProfile()` limits `emergency_contact` and `medical_alert` to school_admin, principal, parent (own child), student (self), and homeroom teacher. Unauthorized viewers receive null for these fields.
- Returns nested response: `{student, enrollment, parents}`.
- Classroom display uses freeze-compliant format: `${grade_label} - ${section_label}`.

### Student Timeline (people.js)

- `GET /people/students/:studentId/timeline` implemented.
- UNION ALL query across attendance_records, homework, assessment_scores, fee_invoices.
- Returns `{student_id, events: [{type, date, time, data}]}`.
- Supports `date_from`, `date_to`, `max_events` filters.

### Student Academic Summary (people.js)

- `GET /people/students/:studentId/academic-summary` implemented.
- Returns `attendance_summary` (total_days, present, absent, late, leave, rate), `homework_summary` (total_assigned, submitted, completion_rate), `marks_summary` (score_count, assessment_count, average_percentage), `fee_summary` (conditionally).
- **Fee summary correctly excluded from teacher view** — `canViewFeeSummary` includes school_admin, principal, vice_principal, accountant, parent, student but NOT teacher. This aligns with doc spec.

### Academic Year Activation (institution.js)

- `PATCH /institution/academic-years/:id/activate` implemented.
- Roles: school_admin, principal, vice_principal.
- Transaction-wrapped: deactivates the previously current year, activates the target year.
- **Audit logging present** with event code `institution.academic_year.activated`, capturing previous and new year details.

### Defaulters Endpoint (fees.js)

- `GET /fees/defaulters` implemented.
- Roles: school_admin, accountant, principal, vice_principal — correct per docs.

### Pagination Consistency

- **All paginated list endpoints use the nested format:** `meta.pagination.{page, page_size, total_items, total_pages}`.
- Verified across: fees.js, people.js, attendance.js, marks.js, homework.js, messaging.js, institution.js, rbac.js.
- This matches the standard envelope defined in `07_API_CONTRACT_BLUEPRINT.md`.

### Dual-Write for Teachers/Staff

- Staff creation with teacher role correctly inserts into both `staff_profiles` and `teachers` (ON CONFLICT DO UPDATE).
- Staff update when adding teacher role also triggers dual-write.
- This preserves backward compatibility with existing queries that reference the `teachers` table.

---

## 2. What Is Partially Correct

### Finance Summary Missing vice_principal — Severity: Medium

- **File:** `agora-api/src/routes/fees.js`, `GET /fees/summary` handler
- **Issue:** Allowed roles are `school_admin`, `principal`, `accountant`. The `vice_principal` role is missing.
- **Doc reference:** `03_PERMISSION_GOVERNANCE.md` lists vice_principal as having read access to finance.
- **Impact:** Vice principals cannot access the consolidated fee summary, though they can access individual fee plans, invoices, and the defaulters endpoint.

### Fee Report Export Missing Principal — Severity: Medium

- **File:** `agora-api/src/routes/reports.js`, `ensureFeesReportExportRole` function
- **Issue:** Fee report export roles are `school_admin`, `accountant`. The `principal` role is missing from export.
- **Doc reference:** `07_API_CONTRACT_BLUEPRINT.md` Section 1 states principal should have read access to fee reports. Export is a read operation.
- **Impact:** Principals can view fee report data but cannot export it as CSV/PDF.

### Marks Endpoints Missing Leadership Roles — Severity: Medium

- **File:** `agora-api/src/routes/marks.js`, `ensureMarksReadRole` function
- **Issue:** Only includes `school_admin`, `teacher`, `parent`, `student`. Missing: `principal`, `vice_principal`, `headmistress`.
- **Doc reference:** `03_PERMISSION_GOVERNANCE.md` grants these leadership roles read access to academic data.
- **Impact:** Leadership can access marks data through the reports module but not directly through the marks CRUD endpoints. This works but is inconsistent with the permission model.

### Reports Scoping Still Uses teachers Table — Severity: Low

- **File:** `agora-api/src/routes/reports.js`, `appendStudentRoleScopeClause` function
- **Issue:** Teacher classroom scoping joins against the `teachers` table (`JOIN teachers t ON t.user_id = ...`), not `staff_profiles`.
- **Doc reference:** `12_PROJECT_FREEZE_SHEET.md` item about teachers vs staff_profiles consolidation.
- **Impact:** Works correctly due to dual-write, but creates a hard dependency on the legacy `teachers` table. If dual-write is ever removed, teacher report scoping will break.

---

## 3. What Is Missing

### Login/Logout Audit Logging — Severity: Critical

- **File:** `agora-api/src/routes/auth.js`
- **Issue:** No `fireAndForgetAuditLog()` or `createAuditLog()` calls anywhere in the file. Login success, login failure, and logout events produce zero audit records.
- **Doc reference:** `05_UNIVERSAL_AUDIT_POLICY.md` Section 5 lists auth events as "High" priority mandatory audit. `11_NEXT_ACTIONS_FOR_CODEX.md` item #5 explicitly calls this out.
- **Impact:** No traceability for authentication events. Failed login brute-force attempts are invisible. Compliance risk.

### Report/Admin Export Audit Logging — Severity: High

- **File:** `agora-api/src/routes/reports.js`, `agora-api/src/routes/admin.js`
- **Issue:** No `fireAndForgetAuditLog` calls on any export endpoints. GET requests are not captured by the automatic audit middleware.
- **Doc reference:** `05_UNIVERSAL_AUDIT_POLICY.md` Section 5 classifies data export as "High" priority. `07_API_CONTRACT_BLUEPRINT.md` Section 6 explicitly lists `reports.data.exported` and `security.audit.exported` as required manual audit hooks.
- **Impact:** Data exfiltration via CSV/PDF export is completely untracked.

### Self-Delegation Block — Severity: High

- **File:** `agora-api/src/routes/rbac.js`, `POST /rbac/delegations` handler
- **Issue:** No validation that `granted_to_user_id !== req.auth.userId`. A user can delegate permissions to themselves.
- **Doc reference:** `07_API_CONTRACT_BLUEPRINT.md` Section 2 states: "Add validation: `granted_to_user_id !== granted_by_user_id`".
- **Impact:** Privilege escalation vector. A principal could delegate school_admin-level permissions to themselves.

### is_active Check in Auth Middleware — Severity: High

- **File:** `agora-api/src/middleware/auth.js`, `requireAuth` function
- **Issue:** JWT validation succeeds without checking `users.is_active`. A deactivated user with a non-expired access token can continue making API calls.
- **Doc reference:** `11_NEXT_ACTIONS_FOR_CODEX.md` item #12.
- **Impact:** Deactivated staff or students retain API access until their JWT expires (up to access token lifetime).

### DB Constraint on assessment_type — Severity: Low

- **File:** Database schema / `agora-api/src/routes/marks.js`
- **Issue:** `assessment_type` is accepted as a free-form string (`z.string().trim().min(1).max(60)`) with no enum constraint in the database.
- **Doc reference:** `11_NEXT_ACTIONS_FOR_CODEX.md` item #8.
- **Impact:** Inconsistent assessment type values across the system. Reporting and filtering may be unreliable.

### DB Constraint on payment_method — Severity: Low

- **File:** Database schema / `agora-api/src/routes/fees.js`
- **Issue:** No CHECK constraint on payment method values at the database level (only Zod validation).
- **Doc reference:** `11_NEXT_ACTIONS_FOR_CODEX.md` item #8.
- **Impact:** Direct database inserts or migrations could bypass validation and insert invalid payment methods.

---

## 4. What Violates the Naming Standard

### No Naming Standard Violations Detected

All checked routes follow the naming conventions defined in `01_NAMING_STANDARD.md`:

- API paths use lowercase snake_case segments: `/fees/plans`, `/people/parents`, `/institution/academic-years`.
- Database column names use snake_case: `school_id`, `student_id`, `amount_due`, `attendance_date`.
- Zod schema names use camelCase: `listQuerySchema`, `bulkScoresSchema`, `createDelegationSchema`.
- Role codes use snake_case: `school_admin`, `vice_principal`, `front_desk`.
- Audit event codes use dot-separated lowercase: `finance.fee_plan.created`, `institution.academic_year.activated`.
- JSON response fields use snake_case: `total_items`, `page_size`, `student_id`.

---

## 5. What Violates Permission Governance

### Marks Read Roles Incomplete

- **File:** `agora-api/src/routes/marks.js:82-92`
- **Violation:** `ensureMarksReadRole` does not include `principal`, `vice_principal`, or `headmistress`.
- **Reference:** `03_PERMISSION_GOVERNANCE.md` grants these roles `academics.marks.view` at minimum.

### Fee Summary Missing vice_principal

- **File:** `agora-api/src/routes/fees.js`, `GET /fees/summary` handler
- **Violation:** vice_principal is excluded from the fee summary endpoint despite having `finance.fees.view` in the permission governance doc.

### Fee Export Missing principal

- **File:** `agora-api/src/routes/reports.js`, `ensureFeesReportExportRole`
- **Violation:** Principal cannot export fee reports despite having read access to fee data.

### Self-Delegation Not Blocked

- **File:** `agora-api/src/routes/rbac.js:394-458`
- **Violation:** Missing the `granted_to_user_id !== granted_by_user_id` guard. Violates the principle of least privilege and the explicit requirement in `07_API_CONTRACT_BLUEPRINT.md`.

---

## 6. What Violates the Freeze Sheet

### No Freeze Sheet Violations Detected

Based on `12_PROJECT_FREEZE_SHEET.md`:

- No schema changes detected beyond what was already established.
- No new route files added (no admissions.js, discipline.js, documents.js — these are correctly deferred to Priority 2).
- Naming conventions are consistent.
- Pagination envelope format is uniform.
- Classroom display format uses `${grade_label} - ${section_label}` as specified.
- The dual-write pattern for teachers/staff_profiles is a known accepted state, not a violation.

---

## 7. What Violates Audit Policy

### auth.js — No Login/Logout/Failed-Login Audit — Critical

- **Reference:** `05_UNIVERSAL_AUDIT_POLICY.md` Section 5, "Authentication" category, Priority: High.
- **Required events:** `auth.session.login`, `auth.session.logout`, `auth.session.login_failed`.
- **Current state:** Zero audit events from auth routes.

### reports.js — No Export Audit — High

- **Reference:** `05_UNIVERSAL_AUDIT_POLICY.md` Section 5, "Data export" category, Priority: High.
- **Required event:** `reports.data.exported` with report type, date range, and row count.
- **Current state:** No manual audit logging on any GET export endpoint.

### admin.js — No Audit Log Export Audit — High

- **Reference:** `05_UNIVERSAL_AUDIT_POLICY.md` Section 5 and Section 7 (sensitive events).
- **Required event:** `security.audit.exported`.
- **Current state:** No manual audit logging on the audit log export endpoint.

### rbac.js — No Delegation Create/Revoke Audit — Medium

- **File:** `agora-api/src/routes/rbac.js`
- **Reference:** `05_UNIVERSAL_AUDIT_POLICY.md` event codes `security.delegation.created` and `security.delegation.revoked`.
- **Current state:** POST `/rbac/delegations` and PATCH `/rbac/delegations/:id/revoke` have no explicit audit logging. The automatic audit middleware covers POST/PATCH but uses raw HTTP method + path format, not structured event codes. Delegation create/revoke are classified as sensitive security events that should have explicit logging with before/after context.

### Automatic Audit Middleware — Uses Raw Action Format — Low

- **File:** `agora-api/src/middleware/audit-trail.js`
- **Reference:** `05_UNIVERSAL_AUDIT_POLICY.md` Section 4 (Event Code Naming Pattern).
- **Current state:** The `action` field stores `${req.method} ${actionPath}` (e.g., `POST /api/v1/attendance/bulk`) instead of structured event codes (e.g., `academics.attendance.bulk_recorded`). This makes filtering by business meaning difficult.
- **Note:** This is a Phase 2 improvement per the audit policy doc. Not a blocker but creates technical debt.

---

## 8. What API Responses Are Inconsistent

### No Structural Inconsistencies Detected

All reviewed endpoints follow the standard envelope:

```
Success: { success: true, data: T, meta: { pagination: {...} } }
Error:   { success: false, error: { code, message, details }, meta: { request_id } }
```

- Pagination is consistently nested across all 8 route files checked.
- All Zod validation errors return 422 `VALIDATION_ERROR` with field-level details.
- 404 responses use `NOT_FOUND` and do not leak resource existence.
- The `success()` helper function is used uniformly.

### Minor: Academic Summary Response Missing `generated_at` in Docs

- **File:** `agora-api/src/routes/people.js:2519`
- **Issue:** The academic summary response includes a `generated_at` timestamp field that is not specified in `07_API_CONTRACT_BLUEPRINT.md` Section 3 (Student Profile Composite Response).
- **Severity:** Informational. This is an addition, not a violation. No action needed.

---

## 9. What UI or Workflow Risks Remain

### Deactivated Users Can Still Access API

- If a staff member is deactivated (is_active = false), they retain full API access until their JWT expires. This is a security risk for involuntary terminations.

### Self-Delegation Enables Privilege Escalation on Web UI

- Without the self-delegation block, a principal or vice_principal can navigate to the delegation management screen and grant themselves permissions they don't natively have. This is exploitable through the existing RBAC management UI.

### Teacher Marks Access Gap Affects Teacher Dashboard

- Teachers can access marks through the marks module routes, but leadership roles (principal, vice_principal, headmistress) cannot directly call marks endpoints. If the web dashboard routes leadership users to `/dashboard/marks`, they will receive a 403 error. Leadership must use `/dashboard/reports` for marks data.

### No Auth Audit Trail Creates Compliance Blind Spot

- Without login/logout audit logging, the admin audit log screen (`/dashboard/admin-audit`) cannot show authentication events. School administrators cannot investigate unauthorized access attempts or verify staff login patterns.

### Export Actions Are Invisible to Administrators

- Report exports and audit log exports are not tracked. A malicious actor could export all student data, fee records, or audit logs without any record of having done so.

---

## 10. Exact Next Actions for Codex in Priority Order

### Priority 1 — Security (Must Fix Before Any Deployment)

1. **Add login/logout/failed-login audit logging in `src/routes/auth.js`**
   - Import `fireAndForgetAuditLog` from `../utils/audit-log`
   - After successful login: log `auth.session.login` with userId, email, ip, user_agent
   - After failed login: log `auth.session.login_failed` with attempted email, ip, user_agent (actorUserId = null)
   - After logout: log `auth.session.logout` with userId

2. **Add self-delegation block in `src/routes/rbac.js`, POST `/rbac/delegations`**
   - After parsing the body, add:
     ```js
     if (body.granted_to_user_id === req.auth.userId) {
       throw new AppError(422, "VALIDATION_ERROR", "Cannot delegate permissions to yourself");
     }
     ```

3. **Add is_active check in `src/middleware/auth.js`, `requireAuth` function**
   - After JWT validation succeeds, query `SELECT is_active FROM users WHERE id = $1` and reject with 401 if `is_active = false`.
   - Consider caching this check for performance (optional).

### Priority 2 — Permission Corrections

4. **Add vice_principal to `GET /fees/summary` in `src/routes/fees.js`**
   - Add `vice_principal` to the role check for the fee summary endpoint.

5. **Add principal to `ensureFeesReportExportRole` in `src/routes/reports.js`**
   - Add `principal` to the role list in `ensureFeesReportExportRole`.

6. **Add leadership roles to `ensureMarksReadRole` in `src/routes/marks.js`**
   - Add `principal`, `vice_principal`, `headmistress` to the role check.
   - For headmistress, apply section-scoped filtering (similar to reports.js pattern).

### Priority 3 — Audit Compliance

7. **Add export audit logging in `src/routes/reports.js`**
   - On all export endpoints (CSV/PDF), call `fireAndForgetAuditLog` with event code `reports.data.exported`, including report type, date range, and row count.

8. **Add audit log export audit in `src/routes/admin.js`**
   - On the audit log export endpoint, call `fireAndForgetAuditLog` with event code `security.audit.exported`.

9. **Add explicit audit logging for delegation create/revoke in `src/routes/rbac.js`**
   - POST `/rbac/delegations`: log `security.delegation.created` with permission_code, granted_to, scope
   - PATCH `/rbac/delegations/:id/revoke`: log `security.delegation.revoked` with delegation_id

### Priority 4 — Data Integrity

10. **Add CHECK constraint for assessment_type in database**
    - Create a migration adding an enum or CHECK constraint for valid assessment types.

11. **Add CHECK constraint for payment_method in database**
    - Create a migration adding an enum or CHECK constraint for valid payment methods.

### Priority 5 — Technical Debt (Non-Blocking)

12. **Migrate report scoping from teachers table to staff_profiles**
    - Update `appendStudentRoleScopeClause` in reports.js to join against `staff_profiles` instead of `teachers`.
    - This unblocks future removal of the dual-write pattern.

13. **Introduce structured event codes in the automatic audit middleware**
    - Create `src/utils/audit-events.js` with an event code map.
    - Update `src/middleware/audit-trail.js` to resolve HTTP method + path into structured event codes.
    - This is Phase 2 per `05_UNIVERSAL_AUDIT_POLICY.md`.

---

## Final Verdict

Codex has completed the core Priority 1 work with **high quality**. Finance permissions, report scoping, parents CRUD, student profile endpoints, timeline, academic summary, academic year activation, defaulters, and pagination consistency are all implemented correctly and align with the documentation.

**Three security gaps must be closed before deployment:**
1. Login/logout audit logging (auth.js) — zero audit trail on authentication
2. Self-delegation block (rbac.js) — privilege escalation vector
3. is_active check (auth.js middleware) — deactivated users retain access

**Three permission gaps need fixing** (fee summary missing VP, fee export missing principal, marks missing leadership) — these are medium severity and won't cause data exposure but will cause 403 errors for legitimate users.

**Audit policy compliance is incomplete** — export audit logging and RBAC delegation audit are missing. These are required for production compliance.

The codebase is structurally sound, naming conventions are followed, the pagination envelope is consistent, and the response format is uniform. No freeze sheet violations detected. The dual-write pattern for teachers/staff is acceptable technical debt that doesn't block deployment.

**Estimated remaining effort:** Items 1-3 (security) are small, targeted changes. Items 4-6 (permissions) are one-line fixes each. Items 7-9 (audit) are straightforward additions. The codebase is close to deployment-ready once the security items are resolved.
