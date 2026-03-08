# Entity Domain Map

> Agora — Domain boundaries, entity ownership, and overlap rules

---

## 1. Domain Definitions

Agora is organized into the following domains. Each domain owns specific entities and is responsible for the business logic around those entities.

| Domain | Scope | Owner Module |
|--------|-------|-------------|
| **Auth** | User identity, sessions, tokens | `src/routes/auth.js` |
| **Institution** | School profile, sections, classrooms, academic years | `src/routes/institution.js` |
| **People** | Staff profiles, students, parents, enrollments, imports | `src/routes/people.js`, `src/routes/imports.js` |
| **Academics** | Attendance, homework, assessments, scores | `src/routes/attendance.js`, `src/routes/homework.js`, `src/routes/marks.js` |
| **Finance** | Fee plans, invoices, payments | `src/routes/fees.js` |
| **Communication** | Conversations, messages, notifications, push tokens | `src/routes/messaging.js`, `src/routes/notifications.js` |
| **Events** | School and classroom events | `src/routes/events.js` |
| **Files** | File upload, download, signed URLs | `src/routes/files.js` |
| **Reports** | Aggregated summaries and exports across all domains | `src/routes/reports.js` |
| **Security** | RBAC templates, permissions, delegations, audit logs | `src/routes/rbac.js`, `src/routes/admin.js` |
| **Observability** | Internal metrics, SLO, readiness | `src/routes/observability.js` |

---

## 2. Entity Ownership by Domain

### Auth Domain

| Entity | Table | Owned Fields |
|--------|-------|-------------|
| User | `users` | id, school_id, email, phone, password_hash, first_name, last_name, is_active, last_login_at |
| Role | `roles` | id, code, description |
| User Role | `user_roles` | user_id, role_id, assigned_at |
| User Session | `user_sessions` | id, school_id, user_id, refresh_token_hash, expires_at, revoked_at |

### Institution Domain

| Entity | Table | Owned Fields |
|--------|-------|-------------|
| School | `schools` | All columns including profile fields (logo_url, branch_name, address, contact, academic settings) |
| School Section | `school_sections` | All columns (name, code, section_type, head, coordinator, display_order) |
| Classroom | `classrooms` | All columns (grade_label, section_label, homeroom_teacher_id, capacity, section_id, classroom_code) |
| Academic Year | `academic_years` | All columns (name, starts_on, ends_on, is_current) |
| Subject | `subjects` | All columns (code, name) |

### People Domain

| Entity | Table | Owned Fields |
|--------|-------|-------------|
| Staff Profile | `staff_profiles` | All columns (staff_code, staff_type, designation, employment_status, etc.) |
| Teacher (legacy) | `teachers` | All columns (employee_code, designation, joined_on) |
| Student | `students` | All columns (student_code, first_name, last_name, status, admission_status, etc.) |
| Parent | `parents` | All columns (occupation, guardian_name, father_name, mother_name, whatsapp_number, etc.) |
| Student User Account | `student_user_accounts` | student_id, user_id |
| Parent-Student Link | `parent_students` | parent_id, student_id, relation_type, is_primary |
| Student Enrollment | `student_enrollments` | All columns (student_id, classroom_id, academic_year_id, roll_no, status) |
| Staff Classroom Assignment | `staff_classroom_assignments` | All columns (staff_profile_id, classroom_id, subject_id, assignment_role) |
| Classroom Subject | `classroom_subjects` | All columns (classroom_id, subject_id, teacher_id) |
| Import Job | `import_jobs` | All columns |
| Import Error | `import_errors` | All columns |

### Academics Domain

| Entity | Table | Owned Fields |
|--------|-------|-------------|
| Attendance Record | `attendance_records` | All columns (student_id, classroom_id, attendance_date, status, source) |
| Homework | `homework` | All columns (classroom_id, subject_id, title, due_at, attachment_urls) |
| Homework Submission | `homework_submissions` | All columns (homework_id, student_id, status, score, feedback) |
| Assessment | `assessments` | All columns (classroom_id, subject_id, title, assessment_type, max_marks) |
| Assessment Score | `assessment_scores` | All columns (assessment_id, student_id, marks_obtained, remarks) |

### Finance Domain

| Entity | Table | Owned Fields |
|--------|-------|-------------|
| Fee Plan | `fee_plans` | All columns (title, amount, academic_year_id, classroom_id, due_day) |
| Fee Invoice | `fee_invoices` | All columns (student_id, fee_plan_id, amount_due, amount_paid, status) |
| Fee Payment | `fee_payments` | All columns (invoice_id, amount, payment_date, method, reference_no) |

### Communication Domain

| Entity | Table | Owned Fields |
|--------|-------|-------------|
| Conversation | `conversations` | All columns (kind, title, created_by_user_id) |
| Conversation Participant | `conversation_participants` | All columns (conversation_id, user_id, role_in_conversation) |
| Message | `messages` | All columns (conversation_id, sender_user_id, kind, body, attachment_urls) |
| Notification | `notifications` | All columns (user_id, title, body, channel, status, payload) |
| Push Device Token | `push_device_tokens` | All columns (user_id, provider, platform, device_token) |

### Events Domain

| Entity | Table | Owned Fields |
|--------|-------|-------------|
| Event | `events` | All columns (title, event_type, starts_at, ends_at, target_scope, target_classroom_id) |

### Security Domain

| Entity | Table | Owned Fields |
|--------|-------|-------------|
| Permission | `permissions` | All columns (code, module, description) |
| Role Permission | `role_permissions` | All columns (role_id, permission_id, scope_level, can_view/create/edit/delete) |
| Delegated Permission | `delegated_permissions` | All columns (granted_by, granted_to, permission_id, scope_type, grant_reason) |
| Audit Log | `audit_logs` | All columns (actor_user_id, action, entity_name, entity_id, metadata) |

---

## 3. Overlap Rules

### Cross-Domain References

Some entities hold foreign keys into other domains. This is expected and necessary. The following rules govern how cross-domain references work.

| Referencing Entity | Foreign Key | Referenced Domain | Rule |
|-------------------|-------------|-------------------|------|
| `classrooms` | `homeroom_teacher_id → teachers.id` | People | Institution domain creates classrooms. People domain owns teacher data. Classroom only holds the FK reference. |
| `classrooms` | `section_id → school_sections.id` | Institution | Both owned by Institution domain. Section association is set during classroom creation. |
| `classroom_subjects` | `teacher_id → teachers.id` | People | People domain owns teachers. Academics domain uses this join table to know which teacher handles which subject in which classroom. |
| `attendance_records` | `student_id`, `classroom_id` | People, Institution | Academics domain writes attendance. It reads student and classroom data but does not modify them. |
| `homework` | `classroom_id`, `subject_id`, `teacher_id` | Institution, People | Same pattern. Academics domain references but does not own these entities. |
| `fee_invoices` | `student_id`, `fee_plan_id` | People, Finance | Finance domain owns both. Student data is referenced for billing. |
| `fee_plans` | `academic_year_id`, `classroom_id` | Institution | Finance domain references institution structures but does not modify them. |
| `events` | `target_classroom_id` | Institution | Events domain references classroom for targeted events. |
| `messages` | `sender_user_id` | Auth | Communication domain references user identity. |
| `staff_profiles` | `user_id`, `primary_section_id` | Auth, Institution | People domain owns staff. References auth identity and institution section. |
| `student_enrollments` | `student_id`, `classroom_id`, `academic_year_id` | People, Institution | People domain writes enrollments. References institution structures. |

### Rules for Codex

1. **Never duplicate a model** across domains. If a route handler needs data from another domain, query the existing table. Do not create a shadow table or duplicate columns.

2. **Read cross-domain, write own domain.** A module should only INSERT/UPDATE/DELETE rows in tables it owns. It may SELECT from any table.

3. **No cascading business logic across domains.** If deleting a student requires cancelling their invoices, the People module should call a Finance domain function, not directly update `fee_invoices`.

4. **Shared lookup tables** (`schools`, `users`, `roles`) are referenced by all domains. Changes to these tables must be coordinated.

5. **The `teachers` table and `staff_profiles` table coexist.** The legacy `teachers` table is still referenced by `classroom_subjects`, `homework`, and attendance-related queries. The newer `staff_profiles` table is the canonical staff record. Both reference `users.id` via `user_id`. New code should prefer `staff_profiles` and avoid adding new references to `teachers`. See `11_NEXT_ACTIONS_FOR_CODEX.md` for the planned consolidation.

---

## 4. Domain Boundary Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                              SCHOOL                                  │
│  ┌─────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  AUTH    │  │ INSTITUTION │  │  PEOPLE  │  │   ACADEMICS      │  │
│  │         │  │             │  │          │  │                  │  │
│  │ users   │  │ schools     │  │ staff    │  │ attendance       │  │
│  │ roles   │←─│ sections    │←─│ students │←─│ homework         │  │
│  │ sessions│  │ classrooms  │  │ parents  │  │ assessments      │  │
│  │         │  │ acad_years  │  │ enroll.  │  │ scores           │  │
│  │         │  │ subjects    │  │ imports  │  │                  │  │
│  └────┬────┘  └──────┬──────┘  └────┬─────┘  └──────────────────┘  │
│       │              │              │                                │
│  ┌────┴────┐  ┌──────┴──────┐  ┌───┴──────┐  ┌──────────────────┐  │
│  │SECURITY │  │   EVENTS    │  │ FINANCE  │  │  COMMUNICATION   │  │
│  │         │  │             │  │          │  │                  │  │
│  │ perms   │  │ events      │  │ fee_plans│  │ conversations    │  │
│  │ RBAC    │  │             │  │ invoices │  │ messages         │  │
│  │ audit   │  │             │  │ payments │  │ notifications    │  │
│  │ deleg.  │  │             │  │          │  │ push_tokens      │  │
│  └─────────┘  └─────────────┘  └──────────┘  └──────────────────┘  │
│                                                                      │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────────┐               │
│  │  FILES   │  │  REPORTS    │  │  OBSERVABILITY   │               │
│  │          │  │ (read-only  │  │  (internal only) │               │
│  │ upload   │  │  cross-     │  │                  │               │
│  │ download │  │  domain)    │  │  metrics / SLO   │               │
│  └──────────┘  └─────────────┘  └──────────────────┘               │
└──────────────────────────────────────────────────────────────────────┘
```

### Key Observations

- **Reports** is a read-only domain. It queries Academics, Finance, and People data for summaries. It never writes to those tables.
- **Files** is a utility domain. It provides upload/download capabilities consumed by other domains (homework attachments, submission files, message attachments).
- **Observability** is internal-only. It does not interact with business entities. It reads notification queue stats for worker health.
- **Security** (RBAC + Audit) is a cross-cutting domain. Audit logging hooks into all mutation routes automatically. RBAC is checked by middleware before any route handler runs.

---

## 5. Notes for Codex on Avoiding Duplication

1. When building Discipline, create new tables (`discipline_incidents`, `discipline_consequences`) under a new Discipline domain. Reference `students.id` and `users.id` but do not add discipline columns to the `students` table.

2. When building Document Vault, create `documents` and `document_access_rules` tables. Do not repurpose the existing `attachment_urls` JSONB columns on homework/submissions/messages. Those remain inline attachment references.

3. When building Admissions, use the existing `students.admission_status` field as the status tracker. Do not create a separate `admissions` table for the same data. If admission requires additional stages beyond what a single status field supports, create an `admission_applications` table that links to `students` upon acceptance.

4. When building Teacher Workspace, use existing `classroom_subjects`, `homework`, `assessments`, and `attendance_records` tables. The workspace is a view layer, not a new data model.

5. When building Parent Daily Timeline, aggregate from existing `attendance_records`, `homework`, `homework_submissions`, `notifications`, and `events` tables. No new table is needed for the timeline itself.
