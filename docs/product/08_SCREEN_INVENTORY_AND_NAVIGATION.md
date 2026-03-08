# Screen Inventory and Navigation

> Agora — Complete screen inventory, navigation structure, and role-based routing

---

## 1. Web Screen Inventory

### Existing Screens (Built by Codex)

| # | Screen | Path | Status |
|---|--------|------|--------|
| 1 | Login | `/login` | Built |
| 2 | Dashboard Overview | `/dashboard` | Built |
| 3 | Attendance | `/dashboard/attendance` | Built |
| 4 | Homework | `/dashboard/homework` | Built |
| 5 | Marks (Assessments) | `/dashboard/marks` | Built |
| 6 | Messaging | `/dashboard/messaging` | Built |
| 7 | Notifications | `/dashboard/notifications` | Built |
| 8 | Fee Management | `/dashboard/fees` | Built |
| 9 | Events | `/dashboard/events` | Built |
| 10 | Reports | `/dashboard/reports` | Built |
| 11 | People (Staff + Students) | `/dashboard/people` | Built |
| 12 | Institution | `/dashboard/institution` | Built |
| 13 | Access Control (RBAC) | `/dashboard/access-control` | Built |
| 14 | Admin Audit Logs | `/dashboard/admin-audit` | Built |
| 15 | Observability | `/dashboard/observability` | Built |
| 16 | Students View | `/dashboard/students` | Built |

### Planned Screens (Priority 2)

| # | Screen | Path | Module |
|---|--------|------|--------|
| 17 | Accountant Dashboard | `/dashboard/accountant` | Accountant Center |
| 18 | Fee Plan Manager | `/dashboard/accountant/plans` | Accountant Center |
| 19 | Invoice Center | `/dashboard/accountant/invoices` | Accountant Center |
| 20 | Payment Recorder | `/dashboard/accountant/payments` | Accountant Center |
| 21 | Fee Reports | `/dashboard/accountant/reports` | Accountant Center |
| 22 | Admissions Dashboard | `/dashboard/admissions` | Admissions Center |
| 23 | Admission Pipeline | `/dashboard/admissions/pipeline` | Admissions Center |
| 24 | Applicant Form | `/dashboard/admissions/applicants/new` | Admissions Center |
| 25 | Applicant Detail | `/dashboard/admissions/applicants/:id` | Admissions Center |
| 26 | Teacher Dashboard | `/dashboard/teacher` | Teacher Workspace |
| 27 | My Classrooms | `/dashboard/teacher/classrooms` | Teacher Workspace |
| 28 | Classroom Detail | `/dashboard/teacher/classrooms/:id` | Teacher Workspace |
| 29 | Teacher Attendance Sheet | `/dashboard/teacher/attendance` | Teacher Workspace |
| 30 | My Homework | `/dashboard/teacher/homework` | Teacher Workspace |
| 31 | Grading Center | `/dashboard/teacher/grading` | Teacher Workspace |
| 32 | Student Quick Profile (Teacher) | `/dashboard/teacher/students/:id` | Teacher Workspace |
| 33 | Student Profile (Full) | `/dashboard/students/:id/profile` | Rich Student Profile |
| 34 | Discipline Dashboard | `/dashboard/discipline` | Discipline |
| 35 | Incident Form | `/dashboard/discipline/incidents/new` | Discipline |
| 36 | Incident Detail | `/dashboard/discipline/incidents/:id` | Discipline |
| 37 | Parent Timeline | `/dashboard/parent/timeline` | Parent Timeline |
| 38 | Document Library | `/dashboard/documents` | Document Vault |

---

## 2. Mobile Screen Inventory

### Existing Screens (Built by Codex)

| # | Screen | Navigation | Roles |
|---|--------|-----------|-------|
| 1 | Login | Entry point | All |
| 2 | Home (Dashboard) | Bottom Tab 1 | parent, student |
| 3 | Attendance | Bottom Tab 2 | parent, student |
| 4 | Homework | Bottom Tab 3 | parent, student |
| 5 | Marks | Bottom Tab 4 | parent, student |
| 6 | Messages | Bottom Tab 5 | parent, student |
| 7 | Notifications | AppBar bell icon | parent, student |

### Planned Screens (Priority 2)

| # | Screen | Navigation | Module |
|---|--------|-----------|--------|
| 8 | Daily Timeline | Replace Home tab content for parents | Parent Timeline |
| 9 | Student Profile (simplified) | Tap from Dashboard | Rich Student Profile |
| 10 | Fee Summary | New Tab or Dashboard card | Parent Finance |
| 11 | Invoice Detail | Push from Fee Summary | Parent Finance |
| 12 | Document View | Push from Student Profile | Document Vault |
| 13 | Discipline Summary | Push from Student Profile | Discipline |

---

## 3. Role-Based Sidebar Structure (Web)

### School Admin Sidebar

```
Dashboard Overview
─────────────────
Institution
  School Profile
  Sections
  Classrooms
People
  Staff
  Students
  Imports
Academics
  Attendance
  Homework
  Marks / Assessments
Finance
  Fee Plans
  Invoices
  Payments
Communication
  Messaging
  Notifications
Events
Reports
─────────────────
Security
  Access Control
  Audit Logs
  Observability
```

### Principal Sidebar

```
Dashboard Overview
─────────────────
Institution
  School Profile
  Sections
  Classrooms
  Principal Dashboard
People
  Staff
  Students
Academics
  Attendance (view)
  Homework (view)
  Marks (view)
Finance (read-only)
  Fee Summary
Communication
  Messaging
  Notifications
Events
Reports
─────────────────
Security
  Access Control
  Delegations
```

### Vice Principal Sidebar

Same as Principal but without Institution Profile edit access.

### Headmistress Sidebar

```
Dashboard Overview
─────────────────
Section Dashboard
People
  Staff (section)
  Students (section)
Academics
  Attendance (section)
  Homework (section)
  Marks (section)
Communication
  Messaging
  Notifications
Events
Reports (section)
```

### Teacher Sidebar

```
Teacher Dashboard
─────────────────
My Classrooms
Attendance
Homework
  My Homework
  Grading Center
Marks / Assessments
Communication
  Messaging
  Notifications
Events
Reports (own classrooms)
```

### Accountant Sidebar

```
Accountant Dashboard
─────────────────
Fee Plans
Invoices
Payments
Fee Reports
Communication
  Messaging
  Notifications
```

### Front Desk Sidebar

```
Admissions Dashboard
─────────────────
Pipeline
New Applicant
People
  Students
  Imports
Communication
  Messaging
  Notifications
```

### HR Admin Sidebar

```
Dashboard Overview
─────────────────
People
  Staff
Communication
  Messaging
  Notifications
Security
  Access Control (view)
```

### Parent (Web — if accessing web dashboard)

```
Dashboard
─────────────────
Timeline
Attendance
Homework
Marks
Fees
  Invoices
  Payments
Communication
  Messaging
  Notifications
Events
```

---

## 4. Screen Relationships

### Navigation Flow Diagram

```
Login
  ├── [school_admin] → Dashboard Overview
  │     ├── Institution → Profile / Sections / Classrooms
  │     ├── People → Staff List ──→ Staff Detail
  │     │            Students List ──→ Student Profile
  │     │            Imports ──→ Preview ──→ Execute
  │     ├── Attendance → Date + Classroom selector → Bulk mark
  │     ├── Homework → Create / List → Submissions → Grade
  │     ├── Marks → Assessments → Bulk Score Entry
  │     ├── Fees → Plans / Invoices / Payments
  │     ├── Messaging → Conversation List → Thread
  │     ├── Events → List / Create
  │     ├── Reports → Summary + Export
  │     ├── Access Control → Templates / Delegations
  │     └── Audit Logs → Filter + Export
  │
  ├── [teacher] → Teacher Dashboard
  │     ├── My Classrooms → Classroom Detail → Student Quick Profile
  │     ├── Attendance → Class selector → Mark attendance
  │     ├── Homework → Create / Grade submissions
  │     ├── Marks → Create assessment / Enter scores
  │     └── Messaging → Conversations
  │
  ├── [accountant] → Accountant Dashboard
  │     ├── Fee Plans → Create / Edit
  │     ├── Invoices → Generate / View
  │     ├── Payments → Record
  │     └── Fee Reports → Summary + Export
  │
  ├── [front_desk] → Admissions Dashboard
  │     ├── Pipeline → Kanban view
  │     ├── New Applicant → Form
  │     ├── Applicant Detail → Stage transition
  │     └── Students → List / Import
  │
  └── [parent] → Parent Dashboard / Timeline
        ├── Timeline → Day navigation
        ├── Attendance → Calendar view
        ├── Homework → List + submission status
        ├── Marks → Scores + trend
        ├── Fees → Invoices + payment history
        └── Messaging → Conversations with teachers
```

---

## 5. Deep Links

Deep links allow direct navigation to specific resources. These should work from notifications, emails, and inter-page references.

| Pattern | Resolves To | Example |
|---------|------------|---------|
| `/dashboard/students/:id/profile` | Student profile page | Click student name anywhere → opens profile |
| `/dashboard/homework/:id` | Homework detail (if page exists) | Notification about homework → opens detail |
| `/dashboard/fees/invoices/:id` | Invoice detail | Fee reminder notification → opens invoice |
| `/dashboard/discipline/incidents/:id` | Incident detail | Discipline notification → opens incident |
| `/dashboard/messaging/:conversationId` | Specific conversation thread | New message notification → opens thread |
| `/dashboard/attendance?date=YYYY-MM-DD` | Attendance for a specific date | Quick action from dashboard |

### Mobile Deep Links

| Pattern | Screen | Trigger |
|---------|--------|---------|
| `agora://attendance?date=YYYY-MM-DD` | Attendance screen with date | Push notification |
| `agora://homework/:id` | Homework detail | Push notification |
| `agora://messages/:conversationId` | Conversation thread | Push notification |
| `agora://notifications` | Notification list | Push notification tap |

---

## 6. Dashboard Entry Points

Each role's dashboard should surface quick-access cards to the most important screens.

### School Admin Dashboard Cards

| Card | Links To | Data |
|------|---------|------|
| Student Count | `/dashboard/people` (students tab) | Total active students |
| Staff Count | `/dashboard/people` (staff tab) | Total active staff |
| Today's Attendance | `/dashboard/attendance` | Present/absent/late counts |
| Fee Collection (Month) | `/dashboard/fees` | Total collected / total due |
| Unread Messages | `/dashboard/messaging` | Unread conversation count |
| Pending Imports | `/dashboard/people` (imports tab) | Import jobs in validated state |

### Teacher Dashboard Cards

| Card | Links To | Data |
|------|---------|------|
| My Classrooms | `/dashboard/teacher/classrooms` | Classroom count |
| Attendance Pending | `/dashboard/teacher/attendance` | Classrooms without today's attendance |
| Ungraded Submissions | `/dashboard/teacher/grading` | Submission count |
| Homework Due This Week | `/dashboard/teacher/homework` | Count of homework with due_at this week |

### Parent Dashboard Cards

| Card | Links To | Data |
|------|---------|------|
| Today's Attendance | Attendance tab | Status badge |
| Homework Due | Homework tab | Due homework count |
| Latest Score | Marks tab | Most recent assessment result |
| Outstanding Fees | Fee tab | Total outstanding amount |
| Unread Messages | Messages tab | Unread count |

---

## 7. Quick Actions

Quick actions are contextual shortcuts surfaced on dashboards and list pages.

| Context | Quick Action | Target |
|---------|-------------|--------|
| Student list row | View Profile | Student profile page |
| Student list row | Mark Attendance | Attendance page with student pre-selected |
| Student list row | Message Parent | New conversation with parent |
| Homework list row | View Submissions | Submissions list for that homework |
| Invoice list row | Record Payment | Payment form for that invoice |
| Incident list row | Resolve | Incident detail with resolve form |
| Staff list row | View Profile | Staff detail page |
| Classroom list row | View Students | Students filtered by classroom |

---

## 8. Navigation Logic

### Role-Based Redirect After Login

| Role | Redirect To |
|------|------------|
| school_admin | `/dashboard` |
| principal | `/dashboard` |
| vice_principal | `/dashboard` |
| headmistress | `/dashboard` |
| teacher | `/dashboard/teacher` |
| accountant | `/dashboard/accountant` |
| front_desk | `/dashboard/admissions` |
| hr_admin | `/dashboard` |
| parent | `/dashboard/parent/timeline` |
| student | `/dashboard` |

### Multi-Role Users

If a user has multiple roles, redirect to the highest-priority role's dashboard:

Priority order: `school_admin` > `principal` > `vice_principal` > `headmistress` > `teacher` > `accountant` > `front_desk` > `hr_admin` > `parent` > `student`

### Route Guards

- Every `/dashboard/*` route must check `isAuthenticated`.
- Role-specific routes (e.g., `/dashboard/teacher/*`) must check that the user has the required role.
- If a user navigates to a route they do not have access to, redirect to their default dashboard with a toast notification.

### Sidebar Active State

- The sidebar item matching the current route should be visually highlighted.
- Nested routes highlight the parent item (e.g., `/dashboard/accountant/plans` highlights the "Fee Plans" sidebar item under "Accountant").
- On mobile, the bottom tab matching the current screen is highlighted.

### Breadcrumbs (Web)

Format: `Home > Section > Page > Detail`

Examples:
- `Dashboard > People > Students > Student Profile`
- `Dashboard > Finance > Invoices > Invoice #INV-001`
- `Dashboard > Discipline > Incidents > Incident Detail`
