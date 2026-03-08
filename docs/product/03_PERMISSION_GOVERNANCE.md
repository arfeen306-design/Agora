# Permission Governance

> Agora — Full permission matrix, delegation rules, and required corrections

---

## 1. Role Hierarchy

Roles in Agora do not form a strict hierarchy but follow a tiered authority model.

| Tier | Roles | Scope |
|------|-------|-------|
| Platform | `super_admin` | All schools (not yet operationalized) |
| School Leadership | `school_admin`, `principal`, `vice_principal` | Entire school |
| Section Leadership | `headmistress` | Own section(s) only |
| Operations | `accountant`, `front_desk`, `hr_admin` | Module-specific within school |
| Teaching | `teacher` | Assigned classrooms only |
| Consumer | `parent`, `student` | Linked student data only |

---

## 2. Permission Code Registry

All 19 permission codes currently seeded in the database.

| Code | Module | Description |
|------|--------|-------------|
| `institution.profile.view` | institution | View school profile |
| `institution.profile.manage` | institution | Edit school profile |
| `institution.sections.manage` | institution | Create and edit sections |
| `institution.classrooms.manage` | institution | Create and edit classrooms |
| `people.staff.view` | people | View staff records |
| `people.staff.manage` | people | Create and edit staff records |
| `people.students.view` | people | View student records |
| `people.students.manage` | people | Create and edit student records |
| `academics.attendance.manage` | academics | Manage attendance records |
| `academics.homework.manage` | academics | Manage homework and submissions |
| `academics.marks.manage` | academics | Manage assessments and scores |
| `finance.fees.view` | finance | View fee plans, invoices, payments |
| `finance.fees.manage` | finance | Create and edit fees |
| `leadership.principal.dashboard` | leadership | Access principal dashboard |
| `leadership.section.dashboard` | leadership | Access section dashboard |
| `rbac.permissions.manage` | security | Manage RBAC role templates |
| `rbac.delegation.manage` | security | Manage delegated permissions |
| `reports.analytics.view` | reports | Access reports and exports |
| `audit.logs.view` | security | View audit logs |

### Planned Permission Codes (Not Yet Seeded)

| Code | Module | For |
|------|--------|-----|
| `discipline.incidents.view` | discipline | View discipline records |
| `discipline.incidents.manage` | discipline | Create and manage incidents |
| `documents.vault.view` | documents | View document vault |
| `documents.vault.manage` | documents | Upload and manage documents |
| `admissions.applications.view` | admissions | View admission pipeline |
| `admissions.applications.manage` | admissions | Process admissions |

---

## 3. Full Permission Matrix by Role

### Current Route-Level Access

| Capability | super_admin | school_admin | principal | vice_principal | headmistress | teacher | accountant | front_desk | hr_admin | parent | student |
|-----------|:-----------:|:------------:|:---------:|:--------------:|:------------:|:-------:|:----------:|:----------:|:--------:|:------:|:-------:|
| **Auth** | | | | | | | | | | | |
| Login / Refresh / Me | * | * | * | * | * | * | * | * | * | * | * |
| **Institution** | | | | | | | | | | | |
| View school profile | — | Y | Y | Y | Y | Y | — | — | — | — | — |
| Edit school profile | — | Y | Y | Y | — | — | — | — | — | — | — |
| View sections | — | Y | Y | Y | Y (own) | Y | — | — | — | — | — |
| Create/edit sections | — | Y | Y | Y | Y | — | — | — | — | — | — |
| View classrooms | — | Y | Y | Y | Y | Y | — | — | — | — | — |
| Create/edit classrooms | — | Y | Y | Y | Y | — | — | — | — | — | — |
| Principal dashboard | — | Y | Y | Y | — | — | — | — | — | — | — |
| Section dashboard | — | Y | Y | Y | Y | — | — | — | — | — | — |
| **People** | | | | | | | | | | | |
| View staff | — | Y | Y | Y | Y | — | — | — | Y | — | — |
| Create/edit staff | — | Y | Y | Y | — | — | — | — | Y | — | — |
| View students | — | Y | Y | Y | Y | Y | — | Y | — | — | — |
| Create/edit students | — | Y | Y | Y | — | — | — | Y | — | — | — |
| Student imports | — | Y | Y | Y | — | — | — | Y | — | — | — |
| **Academics** | | | | | | | | | | | |
| View attendance | — | Y | — | — | — | Y (own cls) | — | — | — | Y (own child) | Y (own) |
| Manage attendance | — | Y | — | — | — | Y (own cls) | — | — | — | — | — |
| Device attendance ingest | — | — | — | — | — | — | — | — | — | — | — |
| View homework | — | Y | — | — | — | Y | — | — | — | Y | Y |
| Create/edit homework | — | Y | — | — | — | Y | — | — | — | — | — |
| Submit homework | — | Y | — | — | — | Y | — | — | — | — | Y |
| View assessments | — | Y | — | — | — | Y | — | — | — | Y | Y |
| Create assessments/scores | — | Y | — | — | — | Y | — | — | — | — | — |
| Student marks summary | — | Y | — | — | — | Y | — | — | — | Y | Y |
| **Finance** | | | | | | | | | | | |
| View fee plans | — | Y | — | — | — | — | — | — | — | — | — |
| Create/edit fee plans | — | Y | — | — | — | — | — | — | — | — | — |
| View invoices | — | Y | — | — | — | — | — | — | — | Y (own) | — |
| Create invoices | — | Y | — | — | — | — | — | — | — | — | — |
| Record payments | — | Y | — | — | — | — | — | — | — | — | — |
| View payments | — | Y | — | — | — | — | — | — | — | — | — |
| **Communication** | | | | | | | | | | | |
| Conversations & messages | — | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Notifications (own) | — | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Test notification send | — | Y | — | — | — | Y | — | — | — | — | — |
| **Events** | | | | | | | | | | | |
| View events | — | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Create events | — | Y | — | — | — | Y | — | — | — | — | — |
| Edit events | — | Y (any) | — | — | — | Y (own) | — | — | — | — | — |
| Delete events | — | Y | — | — | — | — | — | — | — | — | — |
| **Reports** | | | | | | | | | | | |
| View summaries | — | Y | — | — | — | Y | — | — | — | Y | Y |
| Export reports | — | Y | — | — | — | Y | — | — | — | Y | Y |
| **Security** | | | | | | | | | | | |
| View RBAC templates | — | Y | Y | Y | — | — | — | — | Y | — | — |
| Edit RBAC templates | — | Y | Y | Y | — | — | — | — | — | — | — |
| View delegations | — | Y | Y | Y | — | — | — | — | Y | — | — |
| Create/revoke delegations | — | Y | Y | Y | — | — | — | — | — | — | — |
| View effective permissions | — | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| View audit logs | — | Y | — | — | — | — | — | — | — | — | — |
| Export audit logs | — | Y | — | — | — | — | — | — | — | — | — |
| **Lookups** | | | | | | | | | | | |
| Lookup classrooms | — | Y | Y | Y | Y | Y (own) | Y | Y | Y | — | — |
| Lookup students | — | Y | Y | Y | Y | Y (own cls) | Y | Y | Y | — | — |
| Lookup subjects | — | Y | Y | Y | Y | Y | Y | Y | Y | — | — |
| Lookup sections | — | Y | Y | Y | Y (own) | — | — | — | — | — | — |
| Lookup staff | — | Y | Y | Y | Y (own sec) | — | — | — | Y | — | — |
| Lookup academic years | — | Y | Y | Y | Y | Y | Y | Y | Y | — | — |

Legend: Y = Full access, Y (own) = Scoped to own data, Y (own cls) = Scoped to assigned classrooms, Y (own sec) = Scoped to own section, * = All authenticated, — = No access

---

## 4. Finance Permissions — Detailed

### Current State

Only `school_admin` has access to all finance operations. This is a gap.

### Required Corrections

| Operation | school_admin | principal | accountant | parent | Others |
|-----------|:------------:|:---------:|:----------:|:------:|:------:|
| View fee plans | Y | Y (read) | Y | — | — |
| Create fee plans | Y | — | Y | — | — |
| Edit fee plans | Y | — | Y | — | — |
| View invoices (all) | Y | Y (read) | Y | — | — |
| View invoices (own child) | — | — | — | Y | — |
| Create invoices | Y | — | Y | — | — |
| Record payments | Y | — | Y | — | — |
| View payments | Y | Y (read) | Y | — | — |
| Fee summary report | Y | Y | Y | — | — |
| Fee export | Y | — | Y | — | — |

**Action required:** Add `accountant` to fee route guards. Add `principal` as read-only to fee plan and invoice list endpoints. See `11_NEXT_ACTIONS_FOR_CODEX.md`.

---

## 5. Reports Permissions — Detailed

### Current State

Reports endpoints use role-scoped data filtering. All authenticated users with attendance/homework/marks/fees access can view summaries.

### Target State

| Report | school_admin | principal | vice_principal | headmistress | teacher | accountant | parent | student |
|--------|:------------:|:---------:|:--------------:|:------------:|:-------:|:----------:|:------:|:-------:|
| Attendance summary | Y (all) | Y (all) | Y (all) | Y (section) | Y (own cls) | — | Y (own child) | Y (own) |
| Homework summary | Y (all) | Y (all) | Y (all) | Y (section) | Y (own cls) | — | Y (own child) | Y (own) |
| Marks summary | Y (all) | Y (all) | Y (all) | Y (section) | Y (own cls) | — | Y (own child) | Y (own) |
| Fees summary | Y (all) | Y (all) | — | — | — | Y (all) | — | — |
| CSV/PDF export | Y | Y | Y | Y (section) | Y (own cls) | Y (fees) | Y (own) | Y (own) |

**Action required:** Add `principal`, `vice_principal`, and `headmistress` to report endpoint role guards with appropriate scoping. Add `accountant` to fees summary.

---

## 6. Delegation Rules

### How Delegation Works

1. A school leader (`school_admin`, `principal`, `vice_principal`) can grant specific permissions to another user for a defined period.
2. Delegated permissions are stored in `delegated_permissions` with start/end dates and a grant reason.
3. The `GET /rbac/me/effective-permissions` endpoint merges role-template permissions with active delegations.
4. Delegations can be scoped to a specific entity (e.g., a section_id or classroom_id) via `scope_type` and `scope_id`.

### Delegation Constraints

| Rule | Detail |
|------|--------|
| Who can delegate | `school_admin`, `principal`, `vice_principal` |
| Sensitive permissions | `rbac.permissions.manage`, `rbac.delegation.manage`, `audit.logs.view` — only `school_admin` can delegate these |
| Time-bound | `starts_at` is required. `ends_at` is optional (permanent delegation if null). |
| Revocation | Any user with `rbac.delegation.manage` can revoke any delegation within the school. |
| Audit | Delegation creation and revocation are logged in `audit_logs`. |
| Self-delegation | Not explicitly blocked. Should be prevented in validation. |

### Delegation Scenarios

| Scenario | Delegator | Recipient | Permission | Scope |
|----------|-----------|-----------|------------|-------|
| VP covering for absent headmistress | principal | vice_principal | leadership.section.dashboard | section_id = X |
| Teacher given temporary marks access | school_admin | teacher | academics.marks.manage | classroom_id = Y |
| HR given temporary audit access | school_admin | hr_admin | audit.logs.view | school |
| Accountant given report export | principal | accountant | reports.analytics.view | school |

---

## 7. Discipline Visibility Rules (Planned)

When the Discipline module is implemented, these visibility rules must apply.

| Data | school_admin | principal | vice_principal | headmistress | teacher | parent | student |
|------|:------------:|:---------:|:--------------:|:------------:|:-------:|:------:|:-------:|
| All incidents | Y | Y | Y | Y (section) | Y (own cls) | — | — |
| Own child incidents | — | — | — | — | — | Y (non-sensitive) | — |
| Sensitive pastoral notes | Y | Y | — | — | — | — | — |
| Consequence records | Y | Y | Y | Y (section) | Y (own cls) | Y (own child, summary) | — |

**Rule:** Parents should see that a consequence was applied to their child but should not see internal investigation notes or names of other students involved.

---

## 8. Sensitive Data Visibility Rules

| Data Category | Who Can See | Notes |
|---------------|------------|-------|
| Student medical alerts | school_admin, principal, homeroom teacher, parent (own child) | Not visible to accountant, front_desk, other teachers |
| Emergency contact info | school_admin, principal, homeroom teacher, parent (own child) | Not visible to general teacher list views |
| Fee payment history (student) | school_admin, accountant, parent (own child) | Not visible to teachers or other parents |
| Staff salary/HR data | school_admin, hr_admin (when built) | Not visible to any other role |
| Audit logs | school_admin only | Not delegatable to teacher, parent, student |
| Parent contact details | school_admin, principal, headmistress (section), homeroom teacher | Not visible to students or other parents |
| Student home address | school_admin, principal, parent (own child) | Not visible in general list views |

---

## 9. Immediate Corrections Needed in Current Code

| # | Issue | Location | Correction |
|---|-------|----------|------------|
| 1 | `accountant` role has no access to any fee route | `src/routes/fees.js` | Add `accountant` to `requireRoles()` on all fee endpoints |
| 2 | `principal` and `vice_principal` cannot view fee summaries | `src/routes/fees.js`, `src/routes/reports.js` | Add read-only access for leadership roles to fee plan list and fee summary |
| 3 | `principal` and `vice_principal` cannot view reports | `src/routes/reports.js` | Add leadership roles to report route guards with full-school scope |
| 4 | `headmistress` cannot view reports for own section | `src/routes/reports.js` | Add `headmistress` with section-scoped filtering |
| 5 | `accountant` cannot view fee reports | `src/routes/reports.js` | Add `accountant` to fee summary and fee export endpoints |
| 6 | Self-delegation is not blocked | `src/routes/rbac.js` | Add validation: `granted_to_user_id !== granted_by_user_id` |
| 7 | `super_admin` role is seeded but not operationalized | Multiple files | No immediate fix needed, but do not add routes for it until platform-level admin is designed |
| 8 | Device ingest has no per-school API key scoping | `src/routes/attendance.js` | Currently uses a single `DEVICE_API_KEY` env var. Should be per-school for multi-tenant safety. |
