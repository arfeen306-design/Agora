# Project State Review

> Agora School Management Platform — State Assessment

---

## 1. What Currently Exists

Agora is a multi-tenant SaaS school management platform consisting of three application layers and supporting infrastructure.

### Backend — `agora-api/`

| Area | Status |
|------|--------|
| Express REST API on Node.js 20+ | Built and functional |
| PostgreSQL database with full schema | Complete with 30+ tables |
| JWT authentication (access + refresh token pair) | Implemented |
| Role-based access control (RBAC) with 11 role codes | Seeded and enforced |
| Permission system (19 permission codes, role templates, delegated permissions) | Implemented |
| Row-level security (RLS) across 25 tenant tables | Migration exists |
| Attendance CRUD + device ingestion (RFID/QR/Face) | Implemented |
| Homework CRUD + student submissions + grading | Implemented |
| Assessments + bulk score entry + per-student summary | Implemented |
| Messaging (conversations + messages) with WebSocket realtime | Implemented |
| Notifications (in-app, push via FCM, email/SMS via webhook) | Implemented |
| Fee plans, invoices, payments | Implemented |
| Events CRUD | Implemented |
| Reports (attendance, homework, marks, fees) with CSV/PDF export | Implemented |
| Audit logging (automatic on mutations + manual for device ingest) | Implemented |
| File storage (local, S3, GCS) with signed URLs | Implemented |
| Institution management (profile, sections, classrooms) | Implemented |
| People management (staff profiles, students, imports) | Implemented |
| RBAC admin (templates, delegations, effective permissions) | Implemented |
| Lookup endpoints for dropdowns | Implemented |
| Bulk student import engine (CSV/XLSX, preview + execute, per-row isolation) | Implemented |
| Three background workers (notification dispatch, reminders, CloudWatch metrics) | Implemented |
| Internal observability endpoints (metrics, readiness, SLO burn rate) | Implemented |
| Zod schema validation on all route handlers | Implemented |

### Frontend — `agora-web/`

| Area | Status |
|------|--------|
| Next.js 14 App Router with TypeScript + Tailwind CSS | Built |
| Auth context with token management (localStorage) | Implemented |
| Full API client matching all backend endpoints | Implemented |
| 15 dashboard pages covering all backend modules | Implemented |
| Role-aware sidebar navigation | Implemented |

### Mobile — `agora-mobile/`

| Area | Status |
|------|--------|
| Flutter app with Provider state management | Built |
| Targets Parent and Student roles only | Implemented |
| Login, Dashboard, Attendance, Homework, Marks, Messaging, Notifications | Implemented |
| Comprehensive parent dashboard with KPIs, progress checker, graph snapshot | Implemented |
| Theme system with Agora brand colors | Implemented |

### Infrastructure — `infra/terraform/aws/`

| Area | Status |
|------|--------|
| PostgreSQL RDS provisioning (Multi-AZ, encrypted, Performance Insights) | Defined |
| Secrets Manager for DB credentials | Defined |
| CloudWatch alarms (CPU, connections, storage, worker queue health) | Defined |
| SNS alert topic | Defined |
| Docker Compose for local + production deployment | Defined |

### Database

| Area | Status |
|------|--------|
| Full schema with 30+ tables covering all domains | Complete |
| PostgreSQL enums for attendance, homework submission, invoice, messaging, notifications | Defined |
| 4 migration files (tenant RLS, institution foundation, RBAC + imports, student enrichment) | Applied |
| Dev seed data with demo school, 8 users, sample academic data | Complete |

---

## 2. What Matches the Plan

The following areas are fully aligned with a school management platform product plan:

- **Multi-tenant architecture** — school_id isolation at DB, API, and RLS levels is solid.
- **Authentication** — JWT access/refresh pattern with session tracking and secure refresh rotation.
- **Core academic modules** — Attendance, homework, marks, and events cover the baseline academic workflow.
- **Messaging** — Real-time WebSocket messaging with conversation model supports parent-teacher and group communication.
- **Fee management** — Plan, invoice, payment lifecycle with status tracking (draft → issued → partial → paid → overdue → cancelled).
- **Notification pipeline** — Multi-channel dispatch (in-app, push, email, SMS) with worker-based processing and automated reminders.
- **RBAC** — Granular permission system with role templates, scope levels, and delegation.
- **People management** — Staff profiles, student master records, parent linking, and bulk import.
- **Reporting** — Summary endpoints and export (CSV/PDF) for attendance, homework, marks, and fees.
- **Institution management** — School profile, sections (with types and heads), classrooms with section association.
- **Observability** — In-process metrics, SLO burn rate calculation, and CloudWatch publishing.

---

## 3. What Is Missing

### Not Yet Built

| Module | Gap |
|--------|-----|
| Accountant workspace | No dedicated accountant-facing pages or accountant-scoped API flows beyond basic fee CRUD |
| Admissions center | No admission pipeline (inquiry → application → evaluation → enrollment). `admission_status` field exists on students but has no workflow |
| Teacher workspace | No teacher-specific dashboard, lesson planning, timetable, or class management view |
| Rich student profile | No unified profile page aggregating academic, attendance, discipline, medical, and fee history |
| Discipline and pastoral care | No incident tracking, behavioral logs, counselor notes, or consequence management |
| Parent daily timeline | No chronological daily feed combining attendance, homework, messages, and events for a child |
| Document vault | No file library per student or per school; file storage exists but is used only for attachments within homework, submissions, and messages |
| Timetable management | No period/schedule/bell-time model |
| Grade book / report card generation | No term-end result aggregation or report card template |
| Examination scheduling | No exam calendar or seating plan |
| Transport management | `transport_info` field exists on students but no transport module |
| Library management | Not present |
| HR and payroll | `hr_admin` role exists but no HR-specific API routes |
| SMS/email template management | Notifications dispatch via webhook but no template configuration UI |

### Partially Built

| Area | State |
|------|-------|
| Admission workflow | `admission_status` field on `students` table (default `admitted`) exists but no status machine, no admission routes, no admission stages |
| Student lifecycle | `status` field on `students` (default `active`) and `left_on` on `student_enrollments` exist but are unused in any API route |
| super_admin role | Seeded in DB and checked in `isSchoolLeadership()` utility, but no route requires it and no platform-level admin panel exists |
| Headmistress section scoping | Section-filtered views exist for lookups but the dashboard is minimal |
| Principal/VP dashboards | Endpoint exists returning aggregate stats but the web page may not fully render the leadership view |

---

## 4. What Is Inconsistent

### Naming Inconsistencies

| Issue | Detail |
|-------|--------|
| Route mounting style | `auth`, `attendance`, `homework`, `fees`, `events`, `admin` use explicit path prefix mounting. `marks`, `messaging`, `notifications`, `files`, `reports`, `institution`, `people`, `rbac`, `imports` define absolute paths internally and are mounted without a prefix. Both work but the pattern is mixed. |
| `assessment_type` is free-form TEXT | Seed uses `monthly`; comments suggest `quiz, assignment, monthly, term` but no DB constraint enforces this. |
| `payment_method` is free-form TEXT in schema | Zod validates it as `z.enum(['cash', 'bank', 'online'])` at API level, but the DB column has no constraint. |
| `staff_classroom_assignments.assignment_role` | Schema default is `teacher` but seed data inserts `subject_teacher`. |
| `parents.preferred_channel` | Uses the PostgreSQL `notification_channel` enum type, while other similar fields store values as plain TEXT. |
| `conversation_participants.role_in_conversation` | Defaults to `member` but no other values are used or enforced. |

### Structural Inconsistencies

| Issue | Detail |
|-------|--------|
| Pagination format | Some routes return `meta.pagination` as a nested object. Others return `meta.total_items` and `meta.total_pages` as flat fields. |
| Observability page on web | Calls internal endpoints requiring `X-Internal-Api-Key` header, which is not available to normal browser clients without special configuration. |
| Teacher entity duplication | Both `teachers` table (original) and `staff_profiles` table (migration) exist. `teachers` is still used by attendance, homework, marks, and classroom_subjects. `staff_profiles` is the newer unified model. These need a clear migration path or coexistence rule. |

---

## 5. What Should Be Frozen Before Further Implementation

The following decisions must be locked before any new module is built to prevent architectural drift:

| Item | Action |
|------|--------|
| Role codes | Freeze the 11 role codes. No new roles without product review. |
| Permission codes | Freeze the 19 permission codes. New modules must define their permissions explicitly before implementation. |
| Entity naming | Freeze all table names, column naming convention (snake_case), and API response field naming (camelCase). |
| UI label terminology | Freeze the terms: Section (not Department, Division, Wing), Classroom (not Class, Group), Headmistress (not Section Head, HOD). |
| Route path convention | Freeze kebab-case for URL paths, camelCase for JSON fields, snake_case for DB columns. |
| Finance permission matrix | Freeze which roles can view, create, edit, and delete fee plans, invoices, and payments. |
| Audit event naming pattern | Freeze the `action` field format: `{HTTP_METHOD} /api/v1/{path}` for automatic logs. Define a pattern for manual/business events. |
| API response envelope | Freeze the `{success, data, error, meta}` shape. Standardize pagination inside `meta.pagination`. |
| Sensitive field list | Freeze the list of fields excluded from audit log payloads: password, token, secret, authorization, api_key. |

See `12_PROJECT_FREEZE_SHEET.md` for the authoritative freeze registry.
