# Naming Standard

> Agora — Canonical terminology and naming conventions for all layers

---

## 1. Role Codes

All role codes are lowercase `snake_case`. These are stored in the `roles.code` column and referenced throughout RBAC, route guards, and UI.

| Role Code | Display Label | Description |
|-----------|--------------|-------------|
| `super_admin` | Super Admin | Platform-wide administrator (multi-school) |
| `school_admin` | School Admin | Full control within a single school |
| `principal` | Principal | School principal with leadership controls |
| `vice_principal` | Vice Principal | Delegated leadership controls |
| `headmistress` | Headmistress | Section head with section-scoped controls |
| `teacher` | Teacher | Manages classroom operations |
| `accountant` | Accountant | Finance and fees operations |
| `front_desk` | Front Desk | Admissions and front desk operations |
| `hr_admin` | HR Admin | HR and staff operations |
| `parent` | Parent | Views linked student data |
| `student` | Student | Student mobile app access |

### Rules

- Role codes must never be renamed once seeded.
- New roles require a product review and must be added to this registry before implementation.
- Role codes are used in API route guards (`requireRoles()`), permission templates, and UI sidebar filtering.
- The display label is what appears in the UI. The code is what appears in the database and API payloads.

---

## 2. School Structure Terms

| Concept | Correct Term | Incorrect Alternatives |
|---------|-------------|----------------------|
| The top-level organizational unit | **School** | Campus, Branch, Institute |
| A division within a school (e.g., Junior, Middle, Senior) | **Section** | Department, Division, Wing, Block |
| A specific class group within a section and academic year | **Classroom** | Class, Group, Batch, Stream |
| The yearly academic period | **Academic Year** | Session, Term Year, School Year |
| The person heading a section | **Headmistress** | Section Head, HOD, Dean |
| The teacher assigned as classroom lead | **Homeroom Teacher** | Class Teacher, Form Tutor |
| A teaching subject | **Subject** | Course, Module |

### Section Types

| Code | Display Label |
|------|--------------|
| `pre_school` | Pre-School |
| `junior` | Junior |
| `middle` | Middle |
| `senior` | Senior |
| `high_school` | High School |
| `general` | General |

### Classroom Naming Convention

Classrooms are identified by the combination of `grade_label` and `section_label` within an academic year.

- `grade_label`: The grade or class level (e.g., `Grade 1`, `Grade 10`, `Nursery`)
- `section_label`: The section identifier within the grade (e.g., `A`, `B`, `Rose`, `Blue`)
- Combined display: `{grade_label} - {section_label}` (e.g., `Grade 5 - A`)
- `classroom_code`: Optional machine-readable code (e.g., `G5A-2026`)
- `room_number`: Physical room identifier (e.g., `R-101`)

---

## 3. People Entities

| Entity | Table Name | Code Field | Display Pattern |
|--------|-----------|------------|-----------------|
| User (auth identity) | `users` | — | `{first_name} {last_name}` |
| Staff member | `staff_profiles` | `staff_code` | `{staff_code} — {first_name} {last_name}` |
| Teacher (legacy, for classroom assignments) | `teachers` | `employee_code` | `{employee_code} — {first_name} {last_name}` |
| Student | `students` | `student_code` | `{student_code} — {first_name} {last_name}` |
| Parent / Guardian | `parents` | — | `{guardian_name}` or `{user.first_name} {user.last_name}` |

### Relationship Terms

| Relationship | Term |
|-------------|------|
| Parent linked to student | **Guardian Link** (via `parent_students`) |
| Student enrolled in classroom | **Enrollment** (via `student_enrollments`) |
| Staff assigned to classroom | **Classroom Assignment** (via `staff_classroom_assignments`) |
| Teacher assigned to subject in classroom | **Subject Assignment** (via `classroom_subjects`) |

---

## 4. Academic Entities

| Entity | Table Name | Key Fields |
|--------|-----------|------------|
| Academic Year | `academic_years` | `name`, `starts_on`, `ends_on`, `is_current` |
| Subject | `subjects` | `code`, `name` |
| Enrollment | `student_enrollments` | `student_id`, `classroom_id`, `academic_year_id`, `roll_no`, `status` |
| Attendance Record | `attendance_records` | `student_id`, `classroom_id`, `attendance_date`, `status` |
| Homework | `homework` | `classroom_id`, `subject_id`, `title`, `due_at` |
| Homework Submission | `homework_submissions` | `homework_id`, `student_id`, `status`, `score` |
| Assessment | `assessments` | `classroom_id`, `subject_id`, `title`, `assessment_type`, `max_marks` |
| Assessment Score | `assessment_scores` | `assessment_id`, `student_id`, `marks_obtained` |
| Event | `events` | `title`, `event_type`, `starts_at`, `target_scope` |

### Assessment Type Values

Use these standardized values for `assessments.assessment_type`:

| Value | Display Label |
|-------|--------------|
| `quiz` | Quiz |
| `assignment` | Assignment |
| `monthly` | Monthly Test |
| `term` | Term Exam |

---

## 5. Finance Entities

| Entity | Table Name | Key Fields |
|--------|-----------|------------|
| Fee Plan | `fee_plans` | `title`, `amount`, `academic_year_id`, `classroom_id`, `due_day` |
| Fee Invoice | `fee_invoices` | `student_id`, `fee_plan_id`, `amount_due`, `amount_paid`, `status`, `due_date` |
| Fee Payment | `fee_payments` | `invoice_id`, `amount`, `payment_date`, `method`, `reference_no` |

### Invoice Status Values

| Code | Display Label |
|------|--------------|
| `draft` | Draft |
| `issued` | Issued |
| `partial` | Partially Paid |
| `paid` | Paid |
| `overdue` | Overdue |
| `cancelled` | Cancelled |

### Payment Method Values

| Code | Display Label |
|------|--------------|
| `cash` | Cash |
| `bank` | Bank Transfer |
| `online` | Online Payment |

---

## 6. Discipline Entities (Planned)

| Entity | Proposed Table | Purpose |
|--------|---------------|---------|
| Discipline Incident | `discipline_incidents` | Records behavioral events |
| Consequence | `discipline_consequences` | Tracks consequences applied |
| Behavioral Note | `behavioral_notes` | Pastoral and counselor notes |

---

## 7. Document Entities (Planned)

| Entity | Proposed Table | Purpose |
|--------|---------------|---------|
| Document | `documents` | File metadata with scope, category, and access control |
| Document Access | `document_access_rules` | Role-based or user-specific access |

---

## 8. Import Entities

| Entity | Table Name | Key Fields |
|--------|-----------|------------|
| Import Job | `import_jobs` | `import_type`, `source_format`, `status`, `total_rows`, `valid_rows`, `invalid_rows` |
| Import Error | `import_errors` | `job_id`, `row_number`, `field_name`, `issue`, `raw_value` |

### Import Job Status Values

| Code | Display Label |
|------|--------------|
| `queued` | Queued |
| `validating` | Validating |
| `validated` | Validated |
| `executing` | Executing |
| `completed` | Completed |
| `failed` | Failed |

---

## 9. UI Label Rules

### General Principles

- Use sentence case for headings and labels: `Student enrollment`, not `Student Enrollment` or `STUDENT ENROLLMENT`.
- Use the canonical terms defined in this document. Never substitute synonyms in the UI.
- Dates should display as `DD MMM YYYY` (e.g., `15 Mar 2026`) in the UI unless a date picker uses ISO format.
- Currency amounts should display with the school's configured currency symbol and two decimal places.
- Status badges should use the exact status code values defined in this document, rendered as title case in the UI (e.g., `Partially Paid` for code `partial`).

### Role Display in UI

- Sidebar menu items and page access are filtered by role.
- Role badges in user profiles should show the display label from the role table above.
- Multi-role users show all role badges, not just the primary.

---

## 10. Database Entity Naming Guidance

### Table Names

- Plural `snake_case`: `students`, `fee_invoices`, `audit_logs`
- Join tables use both entity names: `parent_students`, `classroom_subjects`, `staff_classroom_assignments`

### Column Names

- `snake_case` always: `first_name`, `school_id`, `created_at`
- Foreign keys end with `_id`: `student_id`, `classroom_id`, `fee_plan_id`
- Boolean columns start with `is_` or `has_`: `is_active`, `is_current`, `is_published`
- Timestamp columns end with `_at`: `created_at`, `updated_at`, `sent_at`, `revoked_at`
- Date columns end with `_on` or `_date`: `starts_on`, `joined_on`, `attendance_date`, `payment_date`

### API Response Field Names

- `camelCase` in JSON: `schoolId`, `firstName`, `attendanceDate`, `isActive`
- API route paths use `kebab-case`: `/api/v1/audit-logs`, `/api/v1/push-tokens`

### Enum and Status Values

- `snake_case` for all enum and status values: `school_admin`, `in_app`, `high_school`, `fee_overdue`
- Exception: PostgreSQL enum type names are also `snake_case`: `attendance_status`, `invoice_status`

### Permission Codes

- Dot-separated with `snake_case` segments: `{module}.{resource}.{action}`
- Examples: `institution.profile.view`, `finance.fees.manage`, `rbac.delegation.manage`
