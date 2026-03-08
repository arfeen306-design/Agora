# Priority 2 Product Specification

> Agora — Full specifications for the next wave of modules

---

## Module A: Accountant and Admissions Center

### A.1 Overview

Two operational roles — **Accountant** and **Front Desk** — currently have limited or no functional screens. This module provides each with a dedicated workspace.

### A.2 Target Users

- **Accountant** (`accountant` role): Manages fee plans, invoices, payments, and financial reporting.
- **Front Desk** (`front_desk` role): Manages the admission pipeline, student registration, and visitor-facing operations.

### A.3 Business Problem Solved

- Accountants currently have zero access to fee routes despite the role existing in the RBAC system.
- Front Desk users can create students but have no admission workflow or pipeline view.
- Both roles lack dedicated dashboard views, forcing school admins to handle these operations.

### A.4 Screen List

| Screen | Path | Role |
|--------|------|------|
| Accountant Dashboard | `/dashboard/accountant` | accountant |
| Fee Plan Manager | `/dashboard/accountant/plans` | accountant |
| Invoice Center | `/dashboard/accountant/invoices` | accountant |
| Payment Recorder | `/dashboard/accountant/payments` | accountant |
| Fee Reports | `/dashboard/accountant/reports` | accountant |
| Admissions Dashboard | `/dashboard/admissions` | front_desk |
| Admission Pipeline | `/dashboard/admissions/pipeline` | front_desk |
| Applicant Form | `/dashboard/admissions/applicants/new` | front_desk |
| Applicant Detail | `/dashboard/admissions/applicants/:id` | front_desk |

### A.5 Accountant Dashboard — Detail

**Fields displayed:**

| Card | Data Source | Fields |
|------|------------|--------|
| Total Receivable (current month) | `fee_invoices` | SUM(amount_due) WHERE status IN (issued, partial, overdue) |
| Total Collected (current month) | `fee_payments` | SUM(amount) WHERE payment_date in current month |
| Overdue Count | `fee_invoices` | COUNT WHERE status = overdue |
| Collection Rate | Computed | (Total Collected / Total Receivable) * 100 |
| Recent Payments | `fee_payments` | Last 10 payments with student name, amount, method, date |
| Overdue Invoices | `fee_invoices` | Top 20 overdue invoices sorted by days overdue |

**Actions:**

- Create new fee plan
- Generate invoices (bulk by classroom or individual)
- Record payment
- Export fee report (CSV/PDF)

**Filters:**

- Academic year
- Classroom
- Date range
- Invoice status

**Permissions:**

- accountant: Full CRUD on fee plans, invoices, payments
- school_admin: Full CRUD (existing)
- principal: Read-only view of fee summaries

**Validations:**

- Payment amount must be > 0 and <= remaining balance on the invoice
- Fee plan amount must be > 0
- Invoice due_date must not be in the past when creating
- Duplicate invoice for same student + fee_plan + period must be blocked

**Acceptance Criteria:**

- Accountant can log in and see the accountant dashboard with real-time financial KPIs.
- Accountant can create fee plans scoped to academic year and optionally to classroom.
- Accountant can generate invoices individually or in bulk for a classroom.
- Accountant can record cash, bank, or online payments against an invoice.
- Invoice status auto-transitions (issued → partial → paid) on payment.
- Overdue invoices are highlighted with days-overdue count.
- All financial operations are audit logged.

### A.6 Admissions Dashboard — Detail

**Fields displayed:**

| Card | Data Source | Fields |
|------|------------|--------|
| Active Inquiries | `students` WHERE admission_status = inquiry | COUNT |
| Applications Pending | `students` WHERE admission_status IN (applied, under_review) | COUNT |
| Accepted This Month | `students` WHERE admission_status = accepted | COUNT |
| Admitted This Year | `students` WHERE admission_status = admitted | COUNT for current academic year |
| Pipeline Board | `students` | Kanban by admission_status |

**Actions:**

- Create new inquiry/application
- Move applicant through pipeline stages
- Convert accepted applicant to admitted student (creates enrollment)
- Schedule entrance test
- Reject applicant with reason

**Filters:**

- Admission status
- Grade applying for
- Date range
- Gender

**Permissions:**

- front_desk: Create inquiries, manage pipeline through to accepted
- school_admin: Full pipeline access including reject and admit
- principal: Approve acceptance, view pipeline

**Validations:**

- Student code must be unique within school on admission
- Grade applying for must match an existing classroom grade_label
- Cannot move to `admitted` without assigning a classroom and academic year
- Cannot reject after admission

**Acceptance Criteria:**

- Front desk can create a new inquiry with minimal fields (name, grade, guardian contact).
- Front desk can move applicants through stages (inquiry → applied → under_review → accepted).
- School admin or principal can approve or reject applicants.
- Upon admission, the system creates a student enrollment in the selected classroom.
- Parent account is auto-created if guardian email/phone is provided.
- Pipeline view shows a Kanban board with stage counts.
- All stage transitions are audit logged.

### A.7 Implementation Notes for Codex

- Add `accountant` to fee route guards in `src/routes/fees.js`.
- Add `principal` as read-only to fee plan list and invoice list endpoints.
- Use the existing `students.admission_status` field as the pipeline state. No new table needed for basic pipeline.
- Create a new route file `src/routes/admissions.js` for pipeline-specific endpoints (stage transitions, pipeline view).
- The admission pipeline Kanban is a web-only view. Mobile does not need this.

---

## Module B: Teacher Workspace

### B.1 Overview

A dedicated workspace for teachers that consolidates all classroom operations into a single, efficient interface.

### B.2 Target Users

- **Teacher** (`teacher` role): Views and manages only their assigned classrooms and subjects.

### B.3 Business Problem Solved

- Teachers currently use the generic dashboard pages shared with school_admin, seeing the same UI without teacher-specific prioritization.
- No quick-access view for "my classrooms today" or "my pending tasks."
- No lesson planning or timetable reference.

### B.4 Screen List

| Screen | Path | Role |
|--------|------|------|
| Teacher Dashboard | `/dashboard/teacher` | teacher |
| My Classrooms | `/dashboard/teacher/classrooms` | teacher |
| Classroom Detail | `/dashboard/teacher/classrooms/:id` | teacher |
| Attendance Sheet | `/dashboard/teacher/attendance` | teacher |
| My Homework | `/dashboard/teacher/homework` | teacher |
| Grading Center | `/dashboard/teacher/grading` | teacher |
| Student Quick Profile | `/dashboard/teacher/students/:id` | teacher |

### B.5 Teacher Dashboard — Detail

**Fields displayed:**

| Card | Data Source |
|------|------------|
| My Classrooms Today | `classroom_subjects` + `classrooms` filtered to teacher |
| Attendance Pending | Classrooms where today's attendance is not yet submitted |
| Homework Due This Week | `homework` created by this teacher with due_at in current week |
| Ungraded Submissions | `homework_submissions` WHERE status = submitted for teacher's homework |
| Recent Messages | `conversations` with unread count |
| Upcoming Events | `events` targeting teacher's classrooms or school-wide |

**Actions:**

- Mark attendance (quick link to attendance sheet)
- Create homework
- Grade submissions
- View student profile
- Send message to parent

**Filters:**

- Classroom selector (only assigned classrooms)
- Subject selector (only assigned subjects)
- Date range

**Permissions:**

- Teacher sees only their assigned classrooms via `classroom_subjects.teacher_id` and `staff_classroom_assignments`.
- Teacher can CRUD homework, attendance, and assessments for their classrooms only.
- Teacher cannot view other teachers' classrooms or students not in their classes.

**Validations:**

- Teacher can only submit attendance for classrooms they are assigned to.
- Homework can only be created for classrooms the teacher is assigned to.
- Assessment scores can only be entered for students enrolled in the teacher's classrooms.

**Acceptance Criteria:**

- Teacher logs in and sees a dashboard with their classrooms, pending tasks, and quick actions.
- Attendance sheet shows enrolled students with status toggles (present, absent, late, leave).
- Homework creation pre-fills the teacher's assigned classrooms and subjects.
- Grading center lists all ungraded submissions across all teacher's homework.
- Student quick profile shows academic summary, attendance record, and parent contact for a student in the teacher's classroom.
- All actions are scoped to the teacher's assigned classrooms.

### B.6 Implementation Notes for Codex

- No new API endpoints needed. Use existing endpoints with teacher-scoped filtering.
- The teacher dashboard is a web-only view. Mobile already serves teachers via the generic pages.
- Use `classroom_subjects` and `staff_classroom_assignments` to determine which classrooms and subjects belong to the teacher.
- The student quick profile is a read-only composite view pulling from attendance, homework, marks, and parent data.

---

## Module C: Rich Student Profile

### C.1 Overview

A comprehensive, unified student profile page that aggregates all data about a student across every domain.

### C.2 Target Users

- **School Admin**, **Principal**, **Vice Principal**: Full profile access
- **Headmistress**: Students in their section
- **Teacher**: Students in their classrooms (academic and attendance data only)
- **Parent**: Own child's profile (excluding sensitive internal notes)

### C.3 Business Problem Solved

- Student data is currently scattered across attendance, homework, marks, fees, and people pages.
- No single page shows a student's complete picture.
- Teachers cannot quickly check a student's overall performance and history.

### C.4 Screen List

| Screen | Path | Roles |
|--------|------|-------|
| Student Profile | `/dashboard/students/:id/profile` | school_admin, principal, vice_principal, headmistress, teacher |
| Student Profile (Parent View) | Mobile: Student tab | parent |

### C.5 Profile Sections

| Section | Data Source | Visible To |
|---------|------------|------------|
| Header (photo, name, code, grade, section, status badge) | `students`, `student_enrollments`, `classrooms` | All with access |
| Personal Information (DOB, gender, address, medical alert) | `students` | school_admin, principal, homeroom teacher, parent |
| Guardian Information | `parents`, `parent_students` | school_admin, principal, headmistress, homeroom teacher |
| Enrollment History | `student_enrollments`, `academic_years` | All with access |
| Attendance Summary | `attendance_records` (aggregated) | All with access |
| Attendance Calendar | `attendance_records` (daily grid) | All with access |
| Homework Tracker | `homework_submissions` with homework details | All with access |
| Marks Overview | `assessment_scores` with trend chart | All with access |
| Fee Ledger | `fee_invoices`, `fee_payments` | school_admin, accountant, parent |
| Discipline Record | `discipline_incidents` (when built) | school_admin, principal, headmistress, homeroom teacher, parent (summary only) |
| Documents | `documents` (when built) | school_admin, principal, parent |
| Notes | Internal notes (when built) | school_admin, principal, homeroom teacher |

**Actions:**

- Edit student details (school_admin, front_desk)
- Change student status (school_admin, principal)
- Message parent (teacher, school_admin)
- Export student report card (school_admin, teacher)
- View full attendance history
- View full marks history

**Permissions:**

- Medical alert and emergency contact fields are restricted to school_admin, principal, homeroom teacher, and parent.
- Fee ledger is restricted to school_admin, accountant, and parent.
- Internal notes are never visible to parents or students.

**Acceptance Criteria:**

- Student profile page loads all sections in a single view with tab navigation for dense sections.
- Attendance section shows a monthly calendar heat map and percentage summary.
- Marks section shows a trend line chart and subject-wise breakdown.
- Fee section shows outstanding balance, payment history, and next due date.
- Data is filtered based on the viewer's role and permissions.
- Profile can be accessed from any student list (people, attendance, homework, marks pages).

### C.6 Implementation Notes for Codex

- Create a composite API endpoint `GET /students/:studentId/profile` that aggregates data from multiple tables in a single response, OR let the frontend make parallel calls to existing endpoints.
- The recommended approach is a single composite endpoint to reduce client round-trips.
- The mobile app should use the same endpoint but render a simplified view.

---

## Module D: Discipline and Pastoral Care

### D.1 Overview

A module for tracking behavioral incidents, consequences, and pastoral care notes for students.

### D.2 Target Users

- **School Admin**, **Principal**: Full access to all discipline records
- **Vice Principal**: Full access with school-wide scope
- **Headmistress**: Section-scoped discipline access
- **Teacher**: Can report incidents for students in their classrooms
- **Parent**: Can see their child's discipline summary (non-sensitive)

### D.3 Business Problem Solved

- No structured way to record, track, or analyze student behavior.
- Discipline decisions are made without historical context.
- Parents are not informed about behavioral patterns in a structured way.

### D.4 Screen List

| Screen | Path | Roles |
|--------|------|-------|
| Discipline Dashboard | `/dashboard/discipline` | school_admin, principal, vice_principal, headmistress |
| Incident Form | `/dashboard/discipline/incidents/new` | school_admin, principal, teacher |
| Incident Detail | `/dashboard/discipline/incidents/:id` | school_admin, principal, vice_principal, headmistress, teacher (own) |
| Student Discipline View | embedded in Student Profile | per profile permissions |

### D.5 New Database Tables

**`discipline_incidents`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| school_id | UUID FK schools | Tenant |
| student_id | UUID FK students | Subject student |
| reported_by_user_id | UUID FK users | Teacher or admin who reported |
| incident_date | DATE | When the incident occurred |
| incident_type | TEXT | Category: `minor_infraction`, `major_infraction`, `positive_behavior`, `bullying`, `safety_concern` |
| description | TEXT | What happened |
| location | TEXT | Where it happened |
| witnesses | TEXT | Other students or staff involved (names redacted in parent view) |
| severity | TEXT | `low`, `medium`, `high`, `critical` |
| status | TEXT | `reported`, `under_review`, `resolved`, `escalated` |
| resolution_notes | TEXT | How it was resolved (internal only) |
| resolved_by_user_id | UUID FK users nullable | Who resolved |
| resolved_at | TIMESTAMPTZ nullable | |
| is_sensitive | BOOLEAN default FALSE | If true, hidden from parent view |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`discipline_consequences`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| school_id | UUID FK schools | |
| incident_id | UUID FK discipline_incidents | |
| consequence_type | TEXT | `verbal_warning`, `written_warning`, `detention`, `suspension`, `parent_meeting`, `community_service`, `other` |
| description | TEXT | Details |
| starts_on | DATE | When consequence begins |
| ends_on | DATE nullable | When consequence ends |
| administered_by_user_id | UUID FK users | |
| parent_notified | BOOLEAN default FALSE | |
| parent_notified_at | TIMESTAMPTZ nullable | |
| created_at | TIMESTAMPTZ | |

**Fields displayed on dashboard:**

| Card | Data |
|------|------|
| Open Incidents | COUNT WHERE status IN (reported, under_review) |
| Resolved This Month | COUNT WHERE resolved_at in current month |
| Escalated | COUNT WHERE status = escalated |
| Incidents by Type | Breakdown chart by incident_type |
| Recent Incidents | Last 10 incidents with student name, type, severity, status |

**Actions:**

- Report new incident
- Review and resolve incident
- Assign consequence
- Notify parent
- Export discipline report

**Filters:**

- Date range, severity, status, incident_type, classroom, section

**Validations:**

- incident_date cannot be in the future
- severity is required
- resolution_notes required when marking as resolved
- consequence starts_on must be >= incident_date

**Acceptance Criteria:**

- Teachers can report incidents for students in their classrooms.
- Leadership can review, assign consequences, and resolve incidents.
- Parents see a summary of consequences for their child but not internal investigation notes or sensitive incidents.
- Discipline data appears in the student profile under a dedicated section.
- All discipline actions are audit logged.

### D.6 Implementation Notes for Codex

- Create `src/routes/discipline.js` for discipline endpoints.
- Add new permission codes: `discipline.incidents.view`, `discipline.incidents.manage`.
- Seed the new permissions in a migration.
- The `is_sensitive` flag on incidents controls parent visibility. Sensitive incidents and their consequences are hidden from parent-facing views.
- Add `discipline_incidents` and `discipline_consequences` to the RLS policy list.

---

## Module E: Parent Daily Timeline

### E.1 Overview

A chronological daily feed for parents showing everything that happened to their child on a given day.

### E.2 Target Users

- **Parent** (`parent` role): Primary consumer
- **Student** (`student` role): Can view their own timeline on mobile

### E.3 Business Problem Solved

- Parents currently must navigate to separate pages (attendance, homework, marks, events) to understand their child's day.
- No single "what happened today" view exists.

### E.4 Screen List

| Screen | Platform | Path |
|--------|----------|------|
| Daily Timeline | Mobile | Home tab (default view) |
| Daily Timeline | Web | `/dashboard/parent/timeline` (if parent logs into web) |

### E.5 Timeline Events

| Event Type | Source | Display |
|-----------|--------|---------|
| Attendance | `attendance_records` | Status badge with check-in time |
| Homework Assigned | `homework` WHERE classroom = child's classroom | Title, subject, due date |
| Homework Submitted | `homework_submissions` | Submission status, grade if reviewed |
| Assessment Score | `assessment_scores` | Subject, marks obtained / max marks |
| Event | `events` WHERE target = child's classroom or school | Title, time, type |
| Notification | `notifications` WHERE user = parent | Title, body |
| Discipline (non-sensitive) | `discipline_incidents` WHERE is_sensitive = false | Type, consequence summary |
| Fee Due Reminder | `fee_invoices` WHERE status = overdue or due soon | Amount, due date |

**Actions:**

- View homework detail
- View assessment detail
- Message teacher
- View fee invoice
- Navigate to previous/next day

**Filters:**

- Child selector (for multi-child parents)
- Date picker

**Permissions:**

- Parent sees only their linked children's data.
- Student sees only their own data.
- Sensitive discipline incidents are excluded.
- Internal notes and investigation details are never shown.

**Acceptance Criteria:**

- Parent opens the app and sees today's timeline for their first child.
- Timeline shows all events in chronological order with time stamps.
- Multi-child parents can switch between children.
- Date navigation allows viewing past days.
- Each timeline event has a tap action to see more detail.
- Empty days show an appropriate empty state message.
- Timeline loads within 2 seconds for a typical day.

### E.6 Implementation Notes for Codex

- Create a composite API endpoint `GET /timeline/:studentId?date=YYYY-MM-DD` that aggregates data from attendance, homework, submissions, scores, events, and notifications.
- The endpoint should return a sorted array of timeline events with a `type` discriminator.
- The endpoint must verify that the requesting user (parent or student) has access to the student.
- This is primarily a mobile feature. The web view is optional but should use the same API.

---

## Module F: Document Vault

### F.1 Overview

A secure document library for storing and organizing school and student documents.

### F.2 Target Users

- **School Admin**: Full access to all documents
- **Principal**: Full access
- **Teacher**: Access to classroom and student documents they own
- **Parent**: Access to their child's documents and school-wide public documents
- **Front Desk**: Access to admission-related documents

### F.3 Business Problem Solved

- Files currently exist only as inline attachments within homework, submissions, and messages.
- No organized document library for certificates, ID copies, medical records, or official letters.
- No document sharing or access control.

### F.4 Screen List

| Screen | Path | Roles |
|--------|------|-------|
| Document Library | `/dashboard/documents` | school_admin, principal |
| Student Documents | embedded in Student Profile | school_admin, principal, teacher, parent |
| Upload Document | modal/drawer from Document Library or Student Profile | school_admin, principal, teacher, front_desk |

### F.5 New Database Tables

**`documents`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| school_id | UUID FK schools | Tenant |
| title | TEXT | Display name |
| description | TEXT nullable | Optional description |
| file_key | TEXT | Storage key (used with Files module for signed URLs) |
| file_name | TEXT | Original file name |
| file_size_bytes | INTEGER | File size |
| mime_type | TEXT | MIME type |
| category | TEXT | `certificate`, `id_copy`, `medical_record`, `report_card`, `official_letter`, `admission_form`, `fee_receipt`, `other` |
| scope_type | TEXT | `school`, `student`, `staff`, `classroom` |
| scope_id | UUID nullable | The entity ID the document belongs to |
| uploaded_by_user_id | UUID FK users | |
| is_archived | BOOLEAN default FALSE | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`document_access_rules`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| document_id | UUID FK documents | |
| access_type | TEXT | `role` or `user` |
| role_code | TEXT nullable | If access_type = role |
| user_id | UUID nullable | If access_type = user |
| can_view | BOOLEAN default TRUE | |
| can_download | BOOLEAN default FALSE | |
| created_at | TIMESTAMPTZ | |

**Actions:**

- Upload document (with category and scope)
- View document metadata
- Download document (via signed URL)
- Archive document (soft delete)
- Set access rules

**Filters:**

- Category, scope_type, scope_id, date range, uploaded_by

**Validations:**

- File size must not exceed the storage limit (15 MB default).
- Category must be a valid value from the defined list.
- scope_type and scope_id must reference a valid entity.
- Duplicate file detection (same file_name + scope_type + scope_id) should warn but not block.

**Acceptance Criteria:**

- School admin can upload documents to the school library or to a specific student's profile.
- Documents can be categorized and filtered.
- Access rules control who can view and download each document.
- Parents can see their child's documents (report cards, certificates) but not other students' documents.
- Teachers can upload documents to their classroom scope.
- All document uploads, downloads, and access changes are audit logged.

### F.6 Implementation Notes for Codex

- Create `src/routes/documents.js` for document endpoints.
- Reuse the existing Files module (`src/routes/files.js`) for actual file upload/download. The Document Vault adds metadata, categorization, and access control on top.
- Add new permission codes: `documents.vault.view`, `documents.vault.manage`.
- Add `documents` and `document_access_rules` to the RLS policy list.
- The `file_key` column stores the same storage object key format used by the Files module: `{schoolId}/{scope}/{yyyy}/{mm}/{dd}/{uuid}-{sanitizedFileName}`.
