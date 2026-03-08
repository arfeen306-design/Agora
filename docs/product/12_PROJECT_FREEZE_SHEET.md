# Project Freeze Sheet

> Agora — Authoritative standards registry. No implementation may deviate from these frozen definitions without a product-level review.

---

## 1. Role Codes — FROZEN

| Code | Label | Scope | Status |
|------|-------|-------|--------|
| `super_admin` | Super Admin | Platform | Frozen (not yet operationalized) |
| `school_admin` | School Admin | School | Frozen |
| `principal` | Principal | School | Frozen |
| `vice_principal` | Vice Principal | School | Frozen |
| `headmistress` | Headmistress | Section | Frozen |
| `teacher` | Teacher | Classroom | Frozen |
| `accountant` | Accountant | Finance module | Frozen |
| `front_desk` | Front Desk | Admissions module | Frozen |
| `hr_admin` | HR Admin | HR module | Frozen |
| `parent` | Parent | Own children | Frozen |
| `student` | Student | Own data | Frozen |

**Rule:** No new roles may be added without product review. Role codes must never be renamed.

---

## 2. Entity Naming — FROZEN

### Table Names

| Entity | Table Name | Status |
|--------|-----------|--------|
| School | `schools` | Frozen |
| User | `users` | Frozen |
| Role | `roles` | Frozen |
| User Role | `user_roles` | Frozen |
| User Session | `user_sessions` | Frozen |
| School Section | `school_sections` | Frozen |
| Classroom | `classrooms` | Frozen |
| Academic Year | `academic_years` | Frozen |
| Subject | `subjects` | Frozen |
| Staff Profile | `staff_profiles` | Frozen |
| Teacher (legacy) | `teachers` | Frozen (deprecation planned) |
| Student | `students` | Frozen |
| Parent | `parents` | Frozen |
| Student User Account | `student_user_accounts` | Frozen |
| Parent-Student Link | `parent_students` | Frozen |
| Student Enrollment | `student_enrollments` | Frozen |
| Staff Classroom Assignment | `staff_classroom_assignments` | Frozen |
| Classroom Subject | `classroom_subjects` | Frozen |
| Attendance Record | `attendance_records` | Frozen |
| Homework | `homework` | Frozen |
| Homework Submission | `homework_submissions` | Frozen |
| Assessment | `assessments` | Frozen |
| Assessment Score | `assessment_scores` | Frozen |
| Fee Plan | `fee_plans` | Frozen |
| Fee Invoice | `fee_invoices` | Frozen |
| Fee Payment | `fee_payments` | Frozen |
| Conversation | `conversations` | Frozen |
| Conversation Participant | `conversation_participants` | Frozen |
| Message | `messages` | Frozen |
| Notification | `notifications` | Frozen |
| Push Device Token | `push_device_tokens` | Frozen |
| Event | `events` | Frozen |
| Permission | `permissions` | Frozen |
| Role Permission | `role_permissions` | Frozen |
| Delegated Permission | `delegated_permissions` | Frozen |
| Audit Log | `audit_logs` | Frozen |
| Import Job | `import_jobs` | Frozen |
| Import Error | `import_errors` | Frozen |

### Naming Convention

| Layer | Convention | Example | Status |
|-------|-----------|---------|--------|
| Table names | Plural snake_case | `fee_invoices` | Frozen |
| Column names | snake_case | `first_name`, `school_id` | Frozen |
| Foreign keys | `{entity}_id` | `student_id`, `classroom_id` | Frozen |
| Boolean columns | `is_` or `has_` prefix | `is_active`, `is_published` | Frozen |
| Timestamps | `_at` suffix | `created_at`, `sent_at` | Frozen |
| Dates | `_on` or `_date` suffix | `starts_on`, `attendance_date` | Frozen |
| API response fields | camelCase | `schoolId`, `firstName` | Frozen |
| API route paths | kebab-case | `/audit-logs`, `/push-tokens` | Frozen |
| Role codes | snake_case | `school_admin`, `vice_principal` | Frozen |
| Permission codes | dot.notation with snake_case | `institution.profile.view` | Frozen |
| Enum/status values | snake_case | `in_app`, `high_school` | Frozen |

---

## 3. UI Label Standards — FROZEN

| Concept | Correct Term | Never Use |
|---------|-------------|-----------|
| School organizational division | Section | Department, Division, Wing |
| Class group | Classroom | Class, Group, Batch |
| Annual academic period | Academic Year | Session, Term Year |
| Section head | Headmistress | Section Head, HOD, Dean |
| Classroom lead teacher | Homeroom Teacher | Class Teacher, Form Tutor |
| Teaching subject | Subject | Course, Module |
| Student identifier | Student Code | Student ID, Registration No |
| Staff identifier | Staff Code | Employee Code, Staff ID |

**Rule:** All UI text, tooltips, labels, column headers, and error messages must use these exact terms.

---

## 4. Finance Permission Matrix — FROZEN

| Operation | school_admin | principal | vice_principal | accountant | parent | Others |
|-----------|:------------:|:---------:|:--------------:|:----------:|:------:|:------:|
| View fee plans | Full | Read | Read | Full | — | — |
| Create fee plans | Yes | — | — | Yes | — | — |
| Edit fee plans | Yes | — | — | Yes | — | — |
| View all invoices | Full | Read | Read | Full | — | — |
| View own child invoices | — | — | — | — | Yes | — |
| Create invoices | Yes | — | — | Yes | — | — |
| Record payments | Yes | — | — | Yes | — | — |
| View payments | Full | Read | — | Full | — | — |
| Cancel invoices | Yes | — | — | Yes | — | — |
| Fee summary report | Yes | Yes | — | Yes | — | — |
| Fee data export | Yes | — | — | Yes | — | — |

**Rule:** This matrix is the source of truth for fee-related access. Route guards must match exactly.

---

## 5. Classroom Naming Rules — FROZEN

| Field | Format | Example |
|-------|--------|---------|
| `grade_label` | Free text, school-defined | `Grade 1`, `Nursery`, `Class 10` |
| `section_label` | Single letter or short name | `A`, `B`, `Rose`, `Blue` |
| Display format | `{grade_label} - {section_label}` | `Grade 5 - A` |
| `classroom_code` | Optional machine code | `G5A-2026` |
| `room_number` | Physical room identifier | `R-101` |

**Uniqueness constraint:** `UNIQUE(school_id, academic_year_id, grade_label, section_label)`

**Rule:** Classroom display names must always use the `{grade_label} - {section_label}` format in the UI. Never show only the grade or only the section.

---

## 6. Route Naming Rules — FROZEN

### API Route Structure

```
/api/v1/{domain}/{resource}
/api/v1/{domain}/{resource}/{resourceId}
/api/v1/{domain}/{resource}/{resourceId}/{sub-resource}
```

### Frozen Route Prefixes

| Prefix | Domain | Status |
|--------|--------|--------|
| `/api/v1/auth` | Authentication | Frozen |
| `/api/v1/attendance` | Attendance | Frozen |
| `/api/v1/homework` | Homework | Frozen |
| `/api/v1/assessments` | Marks/Assessments | Frozen |
| `/api/v1/fees` | Finance | Frozen |
| `/api/v1/events` | Events | Frozen |
| `/api/v1/conversations` | Messaging | Frozen |
| `/api/v1/notifications` | Notifications | Frozen |
| `/api/v1/files` | File Storage | Frozen |
| `/api/v1/reports` | Reports | Frozen |
| `/api/v1/admin` | Admin/Audit | Frozen |
| `/api/v1/institution` | Institution | Frozen |
| `/api/v1/people` | People | Frozen |
| `/api/v1/rbac` | RBAC/Security | Frozen |
| `/api/v1/lookups` | Dropdowns | Frozen |
| `/api/v1/internal` | Internal/Ops | Frozen |

### New Route Prefixes (Approved)

| Prefix | Domain | Status |
|--------|--------|--------|
| `/api/v1/admissions` | Admissions | Approved |
| `/api/v1/discipline` | Discipline | Approved |
| `/api/v1/documents` | Document Vault | Approved |
| `/api/v1/timeline` | Parent Timeline | Approved |
| `/api/v1/students/:id/profile` | Student Profile Composite | Approved |

**Rule:** New routes must use an approved prefix or request a new one via product review. Never create routes outside the `/api/v1/` namespace.

---

## 7. Sensitive Visibility Rules — FROZEN

### Data That Must Be Restricted

| Data | Who Can See | Restriction |
|------|------------|-------------|
| Student medical alerts (`medical_alert`) | school_admin, principal, homeroom teacher, parent (own child) | Never in list views. Only in profile detail. |
| Student emergency contact | school_admin, principal, homeroom teacher, parent (own child) | Never in list views. |
| Student home address (`address_line`) | school_admin, principal, parent (own child) | Never in list views. |
| Parent contact details (phone, WhatsApp) | school_admin, principal, headmistress (section), homeroom teacher | Never visible to students or other parents. |
| Fee payment history | school_admin, accountant, parent (own child) | Never visible to teachers. |
| Staff salary/HR data | school_admin, hr_admin | Never visible to any other role. |
| Audit logs | school_admin only | Not delegatable to consumer roles. |
| Discipline sensitive incidents | school_admin, principal | Never visible to parents or students. |
| Discipline investigation notes | school_admin, principal | Never visible to parents, students, or teachers. |
| Passwords and tokens | Nobody (hashed in DB) | Never returned in any API response. |

### API Response Sanitization

| Field Category | Sanitization Rule |
|----------------|------------------|
| `password`, `password_hash` | Never included in any response |
| `refresh_token`, `access_token` | Returned only in auth endpoints, never in user profile responses |
| `device_token` | Returned only in push token management endpoints |
| `reference_no` (payments) | Visible only to school_admin and accountant |
| Audit log `metadata` | Sensitive keys already sanitized at write time |

**Rule:** These visibility rules are non-negotiable. Any new endpoint or screen must check this table before exposing data. Violations are security incidents.

---

## 8. API Response Envelope — FROZEN

```
Success:
{
  "success": true,
  "data": <T>,
  "meta": {
    "request_id": "<uuid>",
    "pagination": {
      "page": <number>,
      "page_size": <number>,
      "total_items": <number>,
      "total_pages": <number>
    }
  }
}

Error:
{
  "success": false,
  "error": {
    "code": "<ERROR_CODE>",
    "message": "<human-readable>",
    "details": [{ "field": "<name>", "issue": "<message>" }]
  },
  "meta": {
    "request_id": "<uuid>"
  }
}
```

**Rule:** All endpoints must use this exact envelope shape. Pagination must always be nested inside `meta.pagination`. Existing flat pagination fields must be migrated.

---

## Effective Date

This freeze sheet is effective immediately. All future implementation must comply with these standards. Exceptions require explicit product-level review and must be documented as amendments to this file.
