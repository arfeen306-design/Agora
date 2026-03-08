# Codex Milestone Review — Phases A through F

> Project: Agora School Operating Platform
> Review date: 2026-03-08
> Reviewer scope: Phases A–F implementation against product governance docs
> Method: Direct code inspection of backend routes, middleware, frontend pages, components, tests, and migrations

---

## 1. Executive Verdict

### Scope Completion

**Approximately 90% of the assigned scope across Phases A–F is truly complete.**

Backend completion rate is the highest. All Phase A permission fixes, audit gaps, and security hardening items have been implemented and are verified by 34 passing tests. The admissions foundation backend is complete with proper schema, routes, role guards, and audit logging.

Frontend completion rate is strong. All six major UI surfaces exist (principal dashboard, section dashboard, parent management, student profile, admissions center). Each uses modular components with role-aware gating.

### Acceptability

**The implementation is acceptable.** The codebase is structurally sound, security-critical items have been addressed, and the governance docs are followed with only minor deviations. Two issues prevent a fully clean bill of health:

1. **API response field casing uses `snake_case` throughout, contradicting the frozen `camelCase` standard in `12_PROJECT_FREEZE_SHEET.md`.** This is a systemic inconsistency present in every API response and test assertion. It is not a bug — it is a deliberate or inherited architectural choice — but it conflicts with the documented standard.

2. **Zero frontend automated tests.** All UI confidence is manual. Given the role-aware complexity of the new dashboards, this is a measurable risk.

### Readiness to Move Forward

**The project is ready to move to the next execution slice**, but should begin with a short stabilization sprint (1–2 days) before entering timetable and discipline work. The stabilization sprint should address the casing governance decision, add frontend smoke tests, and expand `.gitignore` secret patterns.

---

## 2. Phase-by-Phase Acceptance Review

### Phase A — Immediate Blocker Fixes and Core APIs

**Verdict: ACCEPTED**

| Item | Status | Evidence |
|------|--------|----------|
| Accountant added to all fee routes | ✅ Done | `fees.js`: `canReadFeePlans`, `canManageFeeData`, `canReadInvoices`, `canReadPayments` all include `accountant` |
| Principal/VP read access to fee data | ✅ Done | `fees.js`: `canReadFeePlans` and `canReadInvoices` include `principal` and `vice_principal` |
| Leadership roles added to reports | ✅ Done | `reports.js`: `ensureAcademicReportReadRole` includes principal, VP, HM, teacher, parent, student. `ensureFeesReportReadRole` includes principal, accountant. `ensureFeesReportExportRole` includes principal, accountant |
| Headmistress section-scoped in reports | ✅ Done | `reports.js`: `appendStudentRoleScopeClause` filters HM via `school_sections.head_user_id`/`coordinator_user_id` |
| Self-delegation block | ✅ Done | `rbac.js` line 401–403: `if (body.granted_to_user_id === req.auth.userId)` returns 422 |
| Login/logout/failed-login audit logging | ✅ Done | `auth.js`: `auth.session.login`, `auth.session.logout`, `auth.session.login_failed` event codes |
| Export audit logging (reports) | ✅ Done | `reports.js`: `auditReportExport()` helper fires `reports.data.exported` on all 4 export endpoints |
| Export audit logging (admin) | ✅ Done | `admin.js`: `security.audit.exported` on audit log export |
| is_active check in auth middleware | ✅ Done | `middleware/auth.js`: queries `users.is_active` AND `schools.is_active` after JWT validation, rejects with 401 |
| Delegation create/revoke audit logging | ✅ Done | `rbac.js`: `security.delegation.created` and `security.delegation.revoked` event codes |
| Pagination consistency | ✅ Done | All 8 checked route files use nested `meta.pagination.{page, page_size, total_items, total_pages}` |
| Parent CRUD endpoints | ✅ Done | `people.js`: GET/POST/GET/:id/PATCH/:id for parents |
| Staff/student detail endpoints | ✅ Done | `people.js`: GET `/people/staff/:staffId`, GET `/people/students/:studentId` |
| Student timeline | ✅ Done | `people.js`: GET `/people/students/:studentId/timeline` |
| Student academic summary | ✅ Done | `people.js`: GET `/people/students/:studentId/academic-summary` |
| Academic year activation | ✅ Done | `institution.js`: PATCH `/institution/academic-years/:id/activate` with transaction and audit logging |
| Fees summary endpoint | ✅ Done | `fees.js`: GET `/fees/summary` |
| Defaulters endpoint | ✅ Done | `fees.js`: GET `/fees/defaulters` |
| Marks read roles expanded | ✅ Done | `marks.js`: `ensureMarksReadRole` includes principal, VP, HM, teacher, parent, student |
| API tests | ✅ Done | 34 tests across 4 API test files, all passing |

**What is partial:** Nothing. Phase A is fully complete.

**What is missing:** Nothing.

---

### Phase B — Principal Command Center Web UI

**Verdict: ACCEPTED**

| Item | Status | Evidence |
|------|--------|----------|
| Principal dashboard page | ✅ Done | `agora-web/src/app/dashboard/principal/page.tsx` |
| Role gating (principal/VP/admin) | ✅ Done | `LEADERSHIP_ROLES = ["school_admin", "principal", "vice_principal"]` with explicit access check |
| Backend dashboard endpoint | ✅ Done | `institution.js`: GET `/institution/dashboards/principal` with role guard |
| KPI cards (late, absent, homework, marks) | ✅ Done | 4 KPI cards with threshold-based tone mapping (warning/danger thresholds) |
| Priority alerts panel | ✅ Done | Dynamic alerts: high absence, late arrival spikes, fee defaulters, section health risks |
| Section health table | ✅ Done | Per-section attendance rate, punctuality, homework completion |
| Finance summary panel | ✅ Done | Collection rates, outstanding, overdue amounts (PKR currency) |
| Pending items panel | ✅ Done | Defaulter invoices, active delegations, section flags |
| Upcoming events panel | ✅ Done | Next 6 events with dates |
| Quick actions panel | ✅ Done | Navigation shortcuts to key pages |
| Modular component architecture | ✅ Done | 10 component files in `src/components/dashboard/principal/` with shared `types.ts` |

**What is correctly implemented:**
- The dashboard is leadership-grade. It surfaces operational intelligence (late/absent counts with severity thresholds), financial health (collection rate), section-level health metrics, and actionable alerts.
- Component architecture is excellent. The page file is clean, delegating all rendering to dedicated components.
- API integration calls `getPrincipalDashboard()`, `getFeesSummary()`, `getEvents()`, and `getNotifications()` in parallel.

**What is partial:**
- The attendance trend visualization (`AttendanceTrendArea`) shows a breakdown but does not include a time-series chart over the past N days. This is a polish item, not a blocker.

**What is missing:** Nothing material.

---

### Phase C — HM Section Operations Dashboard Web UI

**Verdict: ACCEPTED**

| Item | Status | Evidence |
|------|--------|----------|
| Section dashboard page | ✅ Done | `agora-web/src/app/dashboard/section/page.tsx` |
| Role gating (headmistress) | ✅ Done | Checks `isHeadmistress` with friendly fallback if no section assigned |
| Backend section dashboard endpoint | ✅ Done | `institution.js`: GET `/institution/dashboards/section` with HM in role guard |
| Multi-section selector | ✅ Done | Dropdown appears when HM manages multiple sections |
| Section-scoped KPI cards | ✅ Done | Active students, classrooms, late today, absent today — all section-scoped |
| Class attendance area | ✅ Done | Per-class attendance breakdown within section |
| Late/absent students panel | ✅ Done | Student-level detail for late and absent students |
| Teacher completion area | ✅ Done | Assignment completion tracking for section teachers |
| Section announcements | ✅ Done | Section-scoped announcements panel |
| Section events panel | ✅ Done | Section events list |
| Empty state handling | ✅ Done | Friendly message if HM has no assigned section |
| Modular components | ✅ Done | 9 component files in `src/components/dashboard/section/` with shared `types.ts` |

**What is correctly implemented:**
- The dashboard is genuinely section-scoped and operational. An HM sees only their section data.
- Multi-section support is a thoughtful addition — some HMs manage multiple sections.
- The component architecture mirrors the principal dashboard pattern with a cyan color palette distinction.

**What is partial:**
- Discipline shortcut is a placeholder (noted as upcoming). This is expected since the discipline module is not yet built.

**What is missing:** Nothing material.

---

### Phase D — Parent Management Completion

**Verdict: ACCEPTED**

| Item | Status | Evidence |
|------|--------|----------|
| Parent directory page | ✅ Done | `agora-web/src/app/dashboard/people/parents/page.tsx` |
| Search and filters | ✅ Done | By name/email/phone, section, classroom |
| Parent create form | ✅ Done | Full form: name, contact, guardian info, portal access, communication channel, multi-child linking |
| Multi-child linking | ✅ Done | Dynamic form to link multiple children with relation types |
| Duplicate detection | ✅ Done | Real-time duplicate warning for email, phone, WhatsApp |
| Parent profile/edit page | ✅ Done | `agora-web/src/app/dashboard/people/parents/[parentId]/page.tsx` |
| Linked children table | ✅ Done | Shows classroom, relation type, primary flag, status |
| Finance integration | ✅ Done | Role-gated fee overview (total due, paid, outstanding) |
| Edit flow with validation | ✅ Done | All profile fields editable with save validation |
| Role-based contact visibility | ✅ Done | Contacts hidden for non-leadership roles |
| Pagination | ✅ Done | Page navigation in parent directory |
| Metrics dashboard | ✅ Done | Total parents, portal active, multi-child families, no-login users |

**What is correctly implemented:**
- End-to-end usable. A school admin can list, search, create, edit, and manage parent records including multi-child linking.
- Duplicate detection is a production-quality UX feature.
- Finance integration shows fee summary for a parent's linked children, gated to finance-authorized roles.

**What is partial:** Nothing.

**What is missing:** Nothing material for the defined scope.

---

### Phase E — Rich Student Profile

**Verdict: ACCEPTED**

| Item | Status | Evidence |
|------|--------|----------|
| Student profile page | ✅ Done | `agora-web/src/app/dashboard/students/[studentId]/profile/page.tsx` |
| Tab structure | ✅ Done | 7 tabs: Overview, Attendance, Academics, Finance, Discipline (placeholder), Documents (placeholder), Timeline |
| Role-aware field visibility | ✅ Done | `canViewFinance`, `canViewInternalNotes` with per-role checks |
| Attendance summary | ✅ Done | Metrics: total days, present, absent, late, leave, rate |
| Homework summary | ✅ Done | Total assigned, submitted, completion rate |
| Marks summary with trend | ✅ Done | Subject performance bars, monthly test trend chart (SVG polyline), progress delta |
| Fee ledger | ✅ Done | Invoice table, fee summary KPIs (role-gated to admin, principal, VP, accountant, parent) |
| Timeline integration | ✅ Done | Activity timeline with event icons, date range filter (7d/30d/all), up to 160 events |
| Academic summary integration | ✅ Done | Calls `getPeopleStudentAcademicSummary()` |
| Sensitive data controls | ✅ Done | Medical alert, emergency contact, internal notes gated by role |
| Guardian information cards | ✅ Done | Shown in overview tab |
| Placeholder tabs for upcoming modules | ✅ Done | Discipline and Documents tabs exist as placeholders |

**What is correctly implemented:**
- This is a premium-quality student profile. The tab structure is comprehensive, the data visualization (subject performance bars, trend chart) is polished, and role-aware visibility is properly enforced.
- The timeline tab aggregates attendance, homework, scores, and invoices into a unified feed with date filtering.
- Finance tab is correctly hidden from roles that should not see fee data.

**What is partial:**
- The marks trend chart is SVG-based (polyline with gradient). This is functional but a chart library would provide more interactivity. Acceptable for current scope.

**What is missing:** Nothing material for the defined scope.

---

### Phase F — Admissions Center Foundation

**Verdict: ACCEPTED WITH ISSUES**

| Item | Status | Evidence |
|------|--------|----------|
| Admissions schema | ✅ Done | `20260308_admissions_foundation.sql`: `admission_applications` + `admission_stage_events` tables |
| Route file | ✅ Done | `admissions.js`: 6 endpoints mounted in `routes/index.js` |
| Pipeline endpoint | ✅ Done | GET `/admissions/pipeline` with stage grouping and summary |
| Inquiry creation | ✅ Done | POST `/admissions/inquiries` for school_admin, front_desk |
| Applications list | ✅ Done | GET `/admissions/applications` with pagination |
| Application detail | ✅ Done | GET `/admissions/applications/:studentId` with history |
| Stage transitions | ✅ Done | PATCH `/admissions/:studentId/stage` with valid-transition graph |
| Admit flow | ✅ Done | POST `/admissions/:studentId/admit` creates enrollment |
| Role guards | ✅ Done | school_admin, principal, VP for approval; front_desk for create/transitions |
| Audit logging | ✅ Done | `admissions.inquiry.created`, `admissions.stage.changed`, `admissions.student.admitted` |
| Duplicate roll number handling | ✅ Done | Returns 422 VALIDATION_ERROR on conflict |
| Enrollment uniqueness | ✅ Done | Migration adds unique constraint on (school_id, student_id, academic_year_id) |
| Dashboard page | ✅ Done | `agora-web/src/app/dashboard/admissions/page.tsx` |
| Pipeline page | ✅ Done | `agora-web/src/app/dashboard/admissions/pipeline/page.tsx` |
| New applicant page | ✅ Done | `agora-web/src/app/dashboard/admissions/applicants/new/page.tsx` |
| Applicant detail page | ✅ Done | `agora-web/src/app/dashboard/admissions/applicants/[studentId]/page.tsx` |
| Stage transition UI | ✅ Done | Valid-stage-choice graph prevents invalid transitions in frontend |
| Admit action UI | ✅ Done | Classroom/academic year/roll number selection on admit |
| Test coverage | ✅ Done | 3 tests covering role guards, stage transitions, admit workflow, roll_no validation |

**Issues:**

1. **Admissions tables are not in the RLS policy.** The `admission_applications` and `admission_stage_events` tables have `school_id` columns but are not listed in the tenant RLS migration (`20260307_tenant_rls.sql`). The routes manually filter by `school_id` from JWT, which provides functional isolation, but the database-level RLS policy does not cover these new tables. This means direct database access bypasses tenant isolation for admissions data.

2. **The `admission_applications` table introduces a parallel status tracking model.** The `students.admission_status` field still exists and is referenced in governance docs, but the actual workflow uses `admission_applications.current_status`. The admit flow updates `students.admission_status` to `admitted`, so the two are synchronized on admission, but pre-admission stages are tracked only in `admission_applications`. This is architecturally reasonable but should be documented.

---

## 3. File-Level Evidence

### Backend Route Files (All verified)

| File | Lines | Key Findings |
|------|-------|-------------|
| `agora-api/src/routes/auth.js` | ~400 | Login/logout/failed-login audit logging verified. `fireAndForgetAuditLog` imported and used. |
| `agora-api/src/routes/fees.js` | ~1130 | Accountant added. Principal/VP read access. Fee summary includes VP. Defaulters endpoint correct. |
| `agora-api/src/routes/reports.js` | ~880 | Leadership roles added. HM section-scoped. Export audit logging on all 4 endpoints via `auditReportExport()`. |
| `agora-api/src/routes/marks.js` | ~500 | `ensureMarksReadRole` includes principal, VP, HM. |
| `agora-api/src/routes/people.js` | ~2527 | Parent CRUD (4 endpoints). Staff/student detail. Timeline. Academic summary. Dual-write for teachers/staff. |
| `agora-api/src/routes/rbac.js` | ~554 | Self-delegation blocked. Delegation create/revoke audit logging. |
| `agora-api/src/routes/admissions.js` | ~1050 | 6 endpoints. Role guards. Stage transition validation. Admit flow with enrollment. 3 audit event codes. |
| `agora-api/src/routes/admin.js` | ~250 | `security.audit.exported` on audit log export. |
| `agora-api/src/routes/institution.js` | ~1200+ | Academic year activation. Principal dashboard endpoint. Section dashboard endpoint. |
| `agora-api/src/middleware/auth.js` | ~120 | `is_active` check on both user and school. Returns 401 if inactive. |
| `agora-api/src/middleware/audit-trail.js` | ~102 | Automatic audit on POST/PATCH/PUT/DELETE. Uses raw HTTP method + path format. |
| `agora-api/src/routes/index.js` | ~45 | 19 route files mounted including admissions.js. |

### Frontend Pages (All verified)

| File | Tabs/Sections | Components Used |
|------|--------------|-----------------|
| `agora-web/src/app/dashboard/principal/page.tsx` | Single-page dashboard | 10 modular components |
| `agora-web/src/app/dashboard/section/page.tsx` | Single-page dashboard | 9 modular components |
| `agora-web/src/app/dashboard/people/parents/page.tsx` | Directory + create form | Inline with reusable patterns |
| `agora-web/src/app/dashboard/people/parents/[parentId]/page.tsx` | Profile + edit flow | Inline with role-gated sections |
| `agora-web/src/app/dashboard/students/[studentId]/profile/page.tsx` | 7 tabs | SVG chart, timeline, role-aware |
| `agora-web/src/app/dashboard/admissions/page.tsx` | Dashboard with stage cards | Hero card, stage cards, quick actions |
| `agora-web/src/app/dashboard/admissions/pipeline/page.tsx` | Kanban + table | Stage board, applicant table |
| `agora-web/src/app/dashboard/admissions/applicants/new/page.tsx` | Multi-section form | Lookup dropdowns, validation |
| `agora-web/src/app/dashboard/admissions/applicants/[studentId]/page.tsx` | Detail + stage mgmt | History timeline, admit form |
| `agora-web/src/components/Sidebar.tsx` | 22 nav items | Role-filtered menu |

### Frontend Components (All verified)

| Directory | File Count | Purpose |
|-----------|-----------|---------|
| `src/components/dashboard/principal/` | 10 files | Principal dashboard modular components + types |
| `src/components/dashboard/section/` | 9 files | Section dashboard modular components + types |

### Test Files (All verified)

| File | Tests | Coverage |
|------|-------|----------|
| `test/api/auth-and-audit.test.js` | 12 | Auth login/logout, audit logging, RBAC, push tokens, tenant boundaries, deactivated users |
| `test/api/institution-people-rbac.test.js` | 8 | Institution profile, sections, staff CRUD, RBAC delegations, imports, dashboards |
| `test/api/phase-a-core-apis.test.js` | 7 | Fees, reports, marks, people CRUD, academic year, tenant scoping |
| `test/api/admissions-foundation.test.js` | 3 | Role guards, stage transitions, admit workflow, roll_no validation |
| `test/config-db-secret.test.js` | 3 | Database credential loading |
| `test/cloudwatch-worker-metrics.test.js` | 1 | CloudWatch metric mapping |
| **Total** | **34** | All passing |

### Migration Files

| File | Purpose |
|------|---------|
| `database/migrations/20260307_institution_foundation.sql` | Core schema |
| `database/migrations/20260307_institution_seed.sql` | Seed data |
| `database/migrations/20260307_push_device_tokens.sql` | Push tokens table |
| `database/migrations/20260307_tenant_rls.sql` | Row-level security policies |
| `database/migrations/20260308_admissions_foundation.sql` | `admission_applications`, `admission_stage_events` tables, enrollment constraints |

---

## 4. Governance Compliance Review

### Naming Standard (01_NAMING_STANDARD.md)

**Verdict: Mostly Compliant**

| Area | Status |
|------|--------|
| Role codes (snake_case) | ✅ Compliant |
| Table names (plural snake_case) | ✅ Compliant |
| Column names (snake_case) | ✅ Compliant |
| Foreign keys (`_id` suffix) | ✅ Compliant |
| Boolean columns (`is_`/`has_` prefix) | ✅ Compliant |
| Timestamps (`_at` suffix) | ✅ Compliant |
| Permission codes (dot.notation) | ✅ Compliant |
| Enum values (snake_case) | ✅ Compliant |
| API route paths (kebab-case) | ✅ Compliant |
| API response fields | ❌ **Non-compliant** |

**Violation:** API response fields use `snake_case` (e.g., `student_id`, `total_items`, `admission_status`) instead of `camelCase` (e.g., `studentId`, `totalItems`, `admissionStatus`) as specified in `01_NAMING_STANDARD.md` Section 8 and `12_PROJECT_FREEZE_SHEET.md` Section 2. This is systemic — every route file and every test assertion uses `snake_case` for JSON fields. There is no transformation layer between database columns and API responses.

**Impact:** This is a deliberate or inherited architectural choice that is consistently applied, so it does not cause functional issues. However, it directly contradicts the frozen standard. A governance decision is needed: either update the freeze sheet to formalize `snake_case` for responses, or introduce a casing transformation layer.

### Permission Governance (03_PERMISSION_GOVERNANCE.md)

**Verdict: Mostly Compliant**

All major permission corrections from Section 9 of the governance doc have been implemented:

| Correction | Status |
|-----------|--------|
| Accountant added to fee routes | ✅ Done |
| Principal/VP read access to fees | ✅ Done |
| Leadership roles added to reports | ✅ Done |
| HM section-scoped in reports | ✅ Done |
| Accountant added to fee reports | ✅ Done |
| Self-delegation blocked | ✅ Done |

**Minor deviation:** The frozen finance permission matrix (doc 12, Section 4) shows `vice_principal` with `—` (no access) for "Fee summary report" and "View payments." However, the implementation gives `vice_principal` access to GET `/fees/summary`. This is an expansion beyond the frozen specification. Whether this is intentional should be documented.

### Lifecycle State Matrix (04_LIFECYCLE_STATE_MATRIX.md)

**Verdict: Compliant**

- Admission status values in the migration match the planned lifecycle: `inquiry`, `applied`, `under_review`, `test_scheduled`, `accepted`, `rejected`, `admitted`, `waitlisted`.
- Invoice status transitions (draft → issued → partial/paid/overdue → cancelled) are enforced in `fees.js`.
- Academic year activation enforces single `is_current = true` via transaction.

### Audit Policy (05_UNIVERSAL_AUDIT_POLICY.md)

**Verdict: Mostly Compliant**

| Required Event | Status | Event Code |
|---------------|--------|------------|
| Login | ✅ Done | `auth.session.login` |
| Logout | ✅ Done | `auth.session.logout` |
| Login failed | ✅ Done | `auth.session.login_failed` |
| Report export | ✅ Done | `reports.data.exported` |
| Audit log export | ✅ Done | `security.audit.exported` |
| Delegation created | ✅ Done | `security.delegation.created` |
| Delegation revoked | ✅ Done | `security.delegation.revoked` |
| Admission inquiry created | ✅ Done | `admissions.inquiry.created` |
| Admission stage changed | ✅ Done | `admissions.stage.changed` |
| Admission student admitted | ✅ Done | `admissions.student.admitted` |
| Parent created | ✅ Done | `people.parent.created` |
| Parent updated | ✅ Done | `people.parent.updated` |
| Fee payment recorded | ✅ Done | `finance.payment.recorded` |
| Academic year activated | ✅ Done | `institution.academic_year.activated` |

**Remaining gap:** The automatic audit middleware still uses raw `{HTTP_METHOD} {path}` format instead of structured event codes. This is documented as a Phase 2 improvement in the audit policy. Not a blocker but creates filtering difficulty for non-manual audit events.

### API Contract Blueprint (07_API_CONTRACT_BLUEPRINT.md)

**Verdict: Mostly Compliant**

- Standard envelope shape (`{success, data, meta}`) is used consistently.
- Pagination is nested inside `meta.pagination` uniformly across all route files.
- Validation errors return 422 with field-level details.
- 404 is used for access-denied cases to avoid leaking resource existence.
- All new endpoints (admissions, dashboard, timeline, academic-summary) follow the contract.

**Gap:** The API contract specifies `camelCase` response fields. Actual implementation uses `snake_case`. Same issue as naming standard.

### Screen Inventory and Navigation (08_SCREEN_INVENTORY_AND_NAVIGATION.md)

**Verdict: Mostly Compliant**

All planned screens for this milestone exist at the specified paths:

| Planned Screen | Planned Path | Actual Path | Status |
|---------------|-------------|-------------|--------|
| Principal Dashboard | `/dashboard/principal` | `/dashboard/principal` | ✅ Match |
| Section Dashboard | (mapped to HM) | `/dashboard/section` | ✅ Exists |
| Parent Directory | `/dashboard/people/parents` | `/dashboard/people/parents` | ✅ Match |
| Parent Detail | `/dashboard/people/parents/:id` | `/dashboard/people/parents/[parentId]` | ✅ Match |
| Student Profile | `/dashboard/students/:id/profile` | `/dashboard/students/[studentId]/profile` | ✅ Match |
| Admissions Dashboard | `/dashboard/admissions` | `/dashboard/admissions` | ✅ Match |
| Admission Pipeline | `/dashboard/admissions/pipeline` | `/dashboard/admissions/pipeline` | ✅ Match |
| Applicant Form | `/dashboard/admissions/applicants/new` | `/dashboard/admissions/applicants/new` | ✅ Match |
| Applicant Detail | `/dashboard/admissions/applicants/:id` | `/dashboard/admissions/applicants/[studentId]` | ✅ Match |

**Sidebar navigation** has 22 role-gated items with correct role filtering for principal, headmistress, front_desk, and all other roles.

### UI Component System (09_UI_COMPONENT_SYSTEM.md)

**Verdict: Mostly Compliant**

The new dashboard pages use a modular component architecture that aligns with the component system's intent:

| Component Concept | Implementation | Notes |
|------------------|----------------|-------|
| Hero Dashboard Card | `PrincipalHeroCard`, `SectionHeroCard` | ✅ Implemented as welcome banner with key metric |
| Stat Card / KPI Strip | `PrincipalKpiStrip`, `SectionKpiStrip` | ✅ Grid layout with tone-based styling |
| Alert Card | `PriorityAlertsPanel` | ✅ 4 severity levels (danger/warning/info/success) |
| Data Table | Multiple inline tables | ⚠️ Tables exist but are not abstracted into a shared `DataTable` component |
| Status Badge | `AdmissionStatusPill`, inline status badges | ⚠️ Pattern exists but not a single shared component |
| Filter Bar | Inline filter implementations | ⚠️ Filters work but are not abstracted into a shared `FilterBar` |
| Empty State | Implemented per-page | ⚠️ Empty states exist but are not a shared component |

**Gap:** The governance doc specifies a reusable component library (DataTable, FilterBar, StatusBadge, EmptyState as shared components). The implementation has these patterns but they are implemented inline within each page rather than as shared, importable components. The dashboard components (10 principal + 9 section) are well-structured, but lower-level primitives (table, badge, filter, empty state) are duplicated across pages.

### Freeze Sheet (12_PROJECT_FREEZE_SHEET.md)

**Verdict: Mostly Compliant**

| Frozen Item | Status |
|------------|--------|
| Role codes (11 roles) | ✅ No new roles added |
| Entity naming conventions | ✅ All new tables follow conventions |
| UI label standards | ✅ Terms used correctly (Section, Classroom, Headmistress) |
| Finance permission matrix | ⚠️ VP added to fee summary (not in frozen matrix) |
| Classroom naming rules | ✅ `{grade_label} - {section_label}` format used |
| Route naming rules | ✅ `/api/v1/admissions` uses approved prefix |
| Sensitive visibility rules | ✅ Medical alerts, emergency contacts, fee data properly gated |
| API response envelope | ✅ Consistent envelope shape |
| API response field casing | ❌ snake_case instead of camelCase |

---

## 5. Quality and Risk Review

| Area | Rating | Detail |
|------|--------|--------|
| **Tenant safety** | Strong | RLS policies on existing tables. Auth middleware checks `school_id` from JWT. Cross-tenant access returns 404. Verified by tenant scoping test. **Gap:** New admissions tables not in RLS policy. |
| **Role safety** | Strong | All new endpoints have proper `requireRoles()` guards. Tests explicitly verify role denial (403 for unauthorized roles). Front desk cannot approve admissions. Teachers cannot access admissions. |
| **Audit safety** | Strong | All critical events have manual audit logging. 14 distinct event codes verified. Automatic middleware covers mutations. Tests verify audit entries exist after operations. |
| **Test coverage** | Good (backend) / None (frontend) | 34 backend API tests covering auth, RBAC, scoping, CRUD, and audit. Zero frontend tests. No integration or E2E tests. |
| **UI consistency** | Good | Dashboard pages use consistent component patterns (hero card, KPI strip, alert panels). Principal and section dashboards share architectural patterns. Color palettes are role-differentiated (blue for principal, cyan for section). |
| **Component reuse** | Good for dashboards / Fair for data pages | Dashboard components are fully modular (10 + 9 files). Parent and student profile pages have more inline code. No shared DataTable or FilterBar component across the app. |
| **Response shape consistency** | Strong | All routes use `{success, data, meta}` envelope. Pagination nested consistently. Validation errors are uniform (422 with field-level details). |
| **Pagination consistency** | Strong | All paginated endpoints verified using `meta.pagination.{page, page_size, total_items, total_pages}`. |
| **Naming consistency** | Mostly consistent | Database, route paths, role codes, permission codes, and audit event codes all follow conventions. API response field casing is the sole systemic deviation. |
| **Legacy teachers vs staff_profiles overlap** | Managed | Dual-write pattern on staff creation keeps both tables synchronized. Reports scoping still uses `teachers` table. This works but creates a hard dependency on the legacy table. |
| **Frontend regression risk** | Medium-High | Zero automated frontend tests. All new pages (principal, section, parent, student profile, admissions) are untested by automation. Manual testing is the only safety net for role-aware visibility and data correctness. |

---

## 6. Remaining Gaps After This Milestone

### Critical

| # | Gap | Impact |
|---|-----|--------|
| 1 | Admissions tables (`admission_applications`, `admission_stage_events`) not in RLS policy | Direct database access bypasses tenant isolation for admissions data. Routes manually filter by `school_id` from JWT, so the API is safe, but this is a defense-in-depth gap. |

### High

| # | Gap | Impact |
|---|-----|--------|
| 2 | API response casing governance (snake_case vs camelCase) unresolved | Every API response and test uses snake_case. Freeze sheet says camelCase. A decision and enforcement mechanism are needed. |
| 3 | Zero frontend automated tests | All new dashboard pages, profile views, and admissions flows are untested by automation. Role-aware visibility bugs could ship undetected. |
| 4 | `.gitignore` missing `.env.production` pattern | `.env` and `.env.*.local` are covered, but `.env.production` (without `.local` suffix) is not explicitly listed. Risk of committing production secrets. |

### Medium

| # | Gap | Impact |
|---|-----|--------|
| 5 | Timetable engine not built | No period/schedule/bell-time model. Teachers and parents cannot see daily schedules. Blocks "full school day" experience. |
| 6 | Discipline module not built | Placeholder tabs exist in student profile. No incident tracking, consequence management, or pastoral care. |
| 7 | Document vault not built | Placeholder tab exists in student profile. No structured document library with categories, access rules, or versioning. |
| 8 | No shared DataTable / FilterBar / StatusBadge components | Each page implements its own table, filter, and badge patterns. Increases maintenance cost and inconsistency risk. |
| 9 | Reports scoping still uses legacy `teachers` table | `appendStudentRoleScopeClause` in reports.js joins against `teachers` instead of `staff_profiles`. Works due to dual-write but creates migration dependency. |
| 10 | No DB constraint on `assessment_type` | Free-form TEXT with no enum or CHECK. Inconsistent values will cause reporting issues. |
| 11 | No DB constraint on `payment_method` | Zod validates at API level but DB has no constraint. |
| 12 | Currency hardcoded to PKR in finance summary panel | `FinanceSummaryPanel.tsx` uses hardcoded PKR symbol. Should be configurable from school profile. |

### Low

| # | Gap | Impact |
|---|-----|--------|
| 13 | Automatic audit middleware uses raw HTTP format, not structured event codes | Filtering by business meaning is difficult. Phase 2 improvement per audit policy doc. |
| 14 | Setup wizard / institutional onboarding not built | New schools must be configured manually. |
| 15 | Analytics expansion not built | Basic summaries exist. No trend analysis, comparative reports, or export scheduling. |
| 16 | `super_admin` role not operationalized | Seeded but no multi-school admin panel. |
| 17 | No Terraform state pattern in `.gitignore` | `*.tfstate` and `*.tfstate.backup` not listed. Only `.terraform/` dir is covered. |

---

## 7. Exact Next Actions for Codex

### Immediate Stabilization Sprint (Recommended: 1–2 days)

**1. Add admissions tables to RLS policy**
- File: `database/migrations/` (new migration)
- Action: Add `admission_applications` and `admission_stage_events` to the tenant RLS policy using the same pattern as `20260307_tenant_rls.sql`.

**2. Resolve API response casing governance**
- Files: All route files, `agora-web/src/lib/api.ts`
- Decision needed: Either formally update `12_PROJECT_FREEZE_SHEET.md` to declare `snake_case` as the frozen standard for API responses, OR introduce a `toSnakeCase`/`toCamelCase` transformation layer in the API response helper.
- Recommendation: Update the freeze sheet to formalize `snake_case` since the entire backend, frontend, mobile app, and test suite are built on it. Changing to camelCase now would require touching every route, every test, and every frontend API consumer.

**3. Expand `.gitignore` secret patterns**
- File: `.gitignore`
- Add: `.env.production`, `.env.staging`, `*.tfstate`, `*.tfstate.backup`, `secrets.json`, `credentials.json`

**4. Add frontend smoke tests for critical pages**
- Files: New test files in `agora-web/`
- Setup: Add Vitest + Testing Library (or Playwright for E2E)
- Priority test targets:
  - Principal dashboard renders for principal role, shows 403 for teacher
  - Section dashboard renders for headmistress, shows section selector
  - Parent directory lists parents, create form submits
  - Student profile tabs render, finance tab hidden for teacher
  - Admissions pipeline renders, new applicant form submits

### Next Feature Slice (After Stabilization)

**5. Timetable foundation**
- New migration: `timetable_periods`, `timetable_slots`, `timetable_entries`
- New route: `src/routes/timetable.js`
- New permission codes: `academics.timetable.view`, `academics.timetable.manage`
- Frontend: Teacher timetable view, classroom day grid, admin timetable builder

**6. Discipline module foundation**
- New migration: `discipline_incidents`, `discipline_consequences` (schema defined in `06_PRIORITY_2_PRODUCT_SPEC.md`)
- New route: `src/routes/discipline.js`
- New permission codes: `discipline.incidents.view`, `discipline.incidents.manage`
- Add to RLS policy
- Frontend: Incident report form, incident list, student discipline summary in profile tab

**7. Document vault foundation**
- New migration: `documents`, `document_access_rules` (schema defined in `06_PRIORITY_2_PRODUCT_SPEC.md`)
- New route: `src/routes/documents.js`
- New permission codes: `documents.vault.view`, `documents.vault.manage`
- Add to RLS policy
- Frontend: Document library page, student documents in profile tab

**8. Shared component extraction**
- Extract from existing pages into `src/components/shared/`:
  - `DataTable` — with pagination, sorting, row actions, empty state
  - `FilterBar` — with search, select, date range, clear-all
  - `StatusBadge` — unified badge with entity + status props
  - `EmptyState` — with icon, title, message, CTA
- Refactor parent directory, admissions pipeline, and student profile to use shared components

**9. DB constraints migration**
- New migration adding CHECK constraints for `assessments.assessment_type` and `fee_payments.method`
- Seed any existing non-conforming data if needed

**10. Migrate report scoping from teachers to staff_profiles**
- File: `src/routes/reports.js`, `appendStudentRoleScopeClause` function
- Replace `teachers` table join with `staff_profiles` join

---

## 8. Final Recommendation

**Recommended path: Stabilization sprint first, then timetable and discipline.**

The implementation quality is genuinely strong. Backend governance, security hardening, and audit coverage are in good shape. The new dashboard UIs are leadership-grade and role-aware. Admissions foundation is well-structured with proper schema, transitions, and tests.

However, moving directly into timetable and discipline without stabilization would compound three risks:

1. **The RLS gap on admissions tables** is a defense-in-depth issue that should be closed before adding more tables (timetable, discipline, documents) that will also need RLS.

2. **Zero frontend tests** means every new page added increases regression risk multiplicatively. Adding tests for the existing 9 new pages before building more pages is the responsible path.

3. **The casing governance question** will only get more expensive to resolve as more endpoints and consumers are added. Locking it down now (even if the decision is simply "formalize snake_case") prevents drift.

**Recommended execution order:**
1. Stabilization sprint (items 1–4 above): 1–2 days
2. Timetable foundation (item 5): 3–4 days
3. Discipline foundation (item 6): 2–3 days
4. Shared component extraction (item 8): 1 day, can parallel with above
5. Document vault (item 7): 2–3 days
6. DB constraints and legacy migration (items 9–10): 1 day

The project is in a strong position. The stabilization sprint is not a setback — it is the difference between "functionally complete" and "production-confident."
