# Lifecycle State Matrix

> Agora — State definitions, transitions, and governance for all stateful entities

---

## 1. Staff (staff_profiles.employment_status)

| State | Meaning |
|-------|---------|
| `active` | Currently employed and working |
| `on_leave` | Temporarily on leave (maternity, medical, sabbatical) |
| `suspended` | Suspended pending investigation or disciplinary action |
| `resigned` | Voluntarily left the school |
| `terminated` | Employment ended by the school |

### Transitions

| From | To | Who Can Trigger | Notes |
|------|----|----------------|-------|
| `active` | `on_leave` | school_admin, hr_admin | Record leave reason in metadata |
| `active` | `suspended` | school_admin, principal | Must log reason in audit |
| `active` | `resigned` | school_admin, hr_admin | Set end date |
| `active` | `terminated` | school_admin | Must log reason in audit |
| `on_leave` | `active` | school_admin, hr_admin | Return from leave |
| `suspended` | `active` | school_admin, principal | Reinstatement |
| `suspended` | `terminated` | school_admin | After investigation |

### History

- All status changes must be audit logged with old_status and new_status in metadata.
- Staff records are never deleted. Terminal states (`resigned`, `terminated`) are permanent.
- The user account associated with a terminated/resigned staff member should have `is_active` set to `false`.

### UI Badge Behavior

| State | Color | Icon |
|-------|-------|------|
| `active` | Green | Checkmark |
| `on_leave` | Amber | Clock |
| `suspended` | Red | Pause |
| `resigned` | Gray | Arrow-right |
| `terminated` | Dark Gray | X |

---

## 2. Student (students.status)

| State | Meaning |
|-------|---------|
| `active` | Currently enrolled and attending |
| `inactive` | Temporarily inactive (extended leave, transfer pending) |
| `graduated` | Completed schooling at this institution |
| `withdrawn` | Voluntarily withdrawn by parent/guardian |
| `expelled` | Removed by the school for disciplinary reasons |
| `transferred_out` | Transferred to another school |

### Transitions

| From | To | Who Can Trigger | Notes |
|------|----|----------------|-------|
| `active` | `inactive` | school_admin, front_desk | Temporary. Must record reason. |
| `active` | `graduated` | school_admin | End-of-year batch or individual |
| `active` | `withdrawn` | school_admin, front_desk | Parent-initiated |
| `active` | `expelled` | school_admin, principal | Requires documented reason |
| `active` | `transferred_out` | school_admin, front_desk | Record destination school if known |
| `inactive` | `active` | school_admin, front_desk | Reactivation |
| `inactive` | `withdrawn` | school_admin | If leave becomes permanent |

### History

- All status changes must be audit logged.
- Students in terminal states (`graduated`, `withdrawn`, `expelled`, `transferred_out`) are never deleted.
- The `student_enrollments.left_on` field should be set when a student leaves a classroom.
- The `student_user_accounts` link remains intact for historical data access.

### UI Badge Behavior

| State | Color | Icon |
|-------|-------|------|
| `active` | Green | Checkmark |
| `inactive` | Amber | Pause |
| `graduated` | Blue | Cap |
| `withdrawn` | Gray | Arrow-left |
| `expelled` | Red | X-circle |
| `transferred_out` | Gray | Arrow-right |

---

## 3. Parent

Parents do not have an independent lifecycle status in the current schema. Their visibility is determined by:

1. `users.is_active` — whether the user account is enabled.
2. `parent_students` link — whether they have active student links.

### Effective States

| State | Condition | Meaning |
|-------|-----------|---------|
| Active | `users.is_active = true` AND at least one linked student is `active` | Can log in, view data, receive notifications |
| Dormant | `users.is_active = true` AND all linked students are in terminal states | Can log in but sees historical data only |
| Disabled | `users.is_active = false` | Cannot log in |

### Notes for Codex

- No `status` column exists on the `parents` table. Parent lifecycle is derived.
- When all of a parent's children graduate or withdraw, the system should not auto-disable the parent account. The school admin must do this manually.

---

## 4. Academic Year (academic_years)

| State | Meaning |
|-------|---------|
| `upcoming` | Defined but not yet started (starts_on is in the future) |
| `current` | The active academic year (`is_current = true`) |
| `completed` | Past academic year (ends_on is in the past) |

### Transitions

| From | To | Who Can Trigger | Notes |
|------|----|----------------|-------|
| `upcoming` | `current` | school_admin | Set `is_current = true`. Must unset previous current year. |
| `current` | `completed` | school_admin | Set `is_current = false`. Only after end date has passed or manually closed. |

### Rules

- Only one academic year can have `is_current = true` at any time.
- Classrooms, enrollments, and fee plans are scoped to an academic year.
- Switching academic years is a high-impact operation. All active enrollments in the old year should be reviewed.
- Historical academic years and their data must never be deleted.

### UI Badge Behavior

| State | Color | Icon |
|-------|-------|------|
| Current | Green | Calendar-check |
| Upcoming | Blue | Calendar-plus |
| Completed | Gray | Calendar-x |

---

## 5. Section (school_sections)

| State | Field | Meaning |
|-------|-------|---------|
| `active` | `is_active = true` | Section is operational |
| `inactive` | `is_active = false` | Section is deactivated (hidden from most views) |

### Transitions

| From | To | Who Can Trigger | Notes |
|------|----|----------------|-------|
| `active` | `inactive` | school_admin, principal | All classrooms in the section should be reviewed |
| `inactive` | `active` | school_admin, principal | Reactivation |

### Rules

- Deactivating a section does not delete it or its classrooms.
- Inactive sections should be hidden from dropdowns and navigation but remain visible in historical data.
- A section with active classrooms containing enrolled students should warn before deactivation.

### UI Badge Behavior

| State | Color |
|-------|-------|
| Active | Green |
| Inactive | Gray |

---

## 6. Classroom (classrooms)

| State | Field | Meaning |
|-------|-------|---------|
| `active` | `is_active = true` | Classroom is operational for the current academic year |
| `inactive` | `is_active = false` | Classroom is deactivated |

### Transitions

| From | To | Who Can Trigger | Notes |
|------|----|----------------|-------|
| `active` | `inactive` | school_admin, principal, headmistress (own section) | Review enrolled students first |
| `inactive` | `active` | school_admin, principal | Reactivation |

### Rules

- Classrooms are tied to an academic year. At year-end, classrooms for the completed year become implicitly inactive.
- New academic year classrooms should be created fresh, not recycled from previous years.
- Deactivating a classroom with active enrollments should produce a warning.

### UI Badge Behavior

| State | Color |
|-------|-------|
| Active | Green |
| Inactive | Gray |

---

## 7. Import Job (import_jobs.status)

| State | Meaning |
|-------|---------|
| `queued` | Job created, file uploaded, awaiting processing |
| `validating` | System is parsing and validating rows |
| `validated` | Validation complete. Awaiting user confirmation to execute. |
| `executing` | System is inserting valid rows into the database |
| `completed` | All valid rows successfully imported |
| `failed` | Job failed during validation or execution |

### Transitions

| From | To | Trigger | Notes |
|------|----|---------|-------|
| `queued` | `validating` | System (on preview call) | Automatic |
| `validating` | `validated` | System | After successful parsing |
| `validating` | `failed` | System | If file is unparseable or all rows are invalid |
| `validated` | `executing` | User (execute call) | User reviews preview and confirms |
| `executing` | `completed` | System | After all valid rows are processed |
| `executing` | `failed` | System | If a critical error occurs (individual row errors do not fail the job) |

### History

- Import jobs are never deleted.
- `import_errors` records are retained for audit and re-import guidance.
- The `summary` JSONB field on the job stores aggregate stats after completion.

### UI Badge Behavior

| State | Color | Icon |
|-------|-------|------|
| `queued` | Gray | Clock |
| `validating` | Blue | Spinner |
| `validated` | Amber | Check-circle |
| `executing` | Blue | Spinner |
| `completed` | Green | Check |
| `failed` | Red | X-circle |

---

## 8. Delegation (delegated_permissions)

| State | Condition | Meaning |
|-------|-----------|---------|
| `active` | `is_active = true` AND `starts_at <= now` AND (`ends_at IS NULL` OR `ends_at > now`) | Permission is currently in effect |
| `scheduled` | `is_active = true` AND `starts_at > now` | Permission is set to activate in the future |
| `expired` | `is_active = true` AND `ends_at <= now` | Permission has passed its end date |
| `revoked` | `is_active = false` | Manually revoked by an authorized user |

### Transitions

| From | To | Who Can Trigger | Notes |
|------|----|----------------|-------|
| `scheduled` | `active` | System (time-based) | Automatic when `starts_at` is reached |
| `active` | `expired` | System (time-based) | Automatic when `ends_at` is reached |
| `active` | `revoked` | school_admin, principal, vice_principal | Manual revocation |
| `scheduled` | `revoked` | school_admin, principal, vice_principal | Cancel before activation |

### History

- Delegations are never deleted. Revoked and expired delegations remain in the table for audit.
- Revocation must be audit logged with the revoking user's ID and reason.

### UI Badge Behavior

| State | Color | Icon |
|-------|-------|------|
| Active | Green | Shield-check |
| Scheduled | Blue | Clock |
| Expired | Gray | Clock-off |
| Revoked | Red | Shield-x |

---

## 9. Admission (students.admission_status) — Planned

| State | Meaning |
|-------|---------|
| `inquiry` | Initial contact or interest registered |
| `applied` | Application form submitted |
| `under_review` | Application is being evaluated |
| `test_scheduled` | Entrance test or interview scheduled |
| `accepted` | Admission offered |
| `rejected` | Admission denied |
| `admitted` | Student formally admitted and enrolled (current default) |
| `waitlisted` | On the waiting list |

### Transitions

| From | To | Who Can Trigger |
|------|----|----------------|
| `inquiry` | `applied` | front_desk, school_admin |
| `applied` | `under_review` | front_desk, school_admin |
| `under_review` | `test_scheduled` | school_admin, principal |
| `under_review` | `accepted` | school_admin, principal |
| `under_review` | `rejected` | school_admin, principal |
| `under_review` | `waitlisted` | school_admin, principal |
| `test_scheduled` | `accepted` | school_admin, principal |
| `test_scheduled` | `rejected` | school_admin, principal |
| `waitlisted` | `accepted` | school_admin, principal |
| `waitlisted` | `rejected` | school_admin |
| `accepted` | `admitted` | school_admin, front_desk |

### Notes for Codex

- The `students.admission_status` field currently defaults to `admitted` and is not used by any route.
- When the Admissions module is built, this field becomes the source of truth for admission state.
- An `admission_applications` table may be needed if stages require storing per-stage metadata (test scores, interviewer notes).

---

## 10. Fee Invoice (fee_invoices.status)

| State | Meaning |
|-------|---------|
| `draft` | Invoice created but not yet visible to parent |
| `issued` | Invoice sent/visible to parent |
| `partial` | Some payment received but balance remains |
| `paid` | Fully paid |
| `overdue` | Past due date and not fully paid |
| `cancelled` | Invoice voided |

### Transitions

| From | To | Who Can Trigger | Notes |
|------|----|----------------|-------|
| `draft` | `issued` | school_admin, accountant | Makes visible to parent |
| `issued` | `partial` | System (on payment receipt) | Automatic when `amount_paid > 0 AND amount_paid < amount_due` |
| `issued` | `paid` | System (on payment receipt) | Automatic when `amount_paid >= amount_due` |
| `issued` | `overdue` | System (daily check) or manual | When `due_date < today AND status = issued` |
| `partial` | `paid` | System (on payment receipt) | Automatic |
| `partial` | `overdue` | System (daily check) | When `due_date < today AND status = partial` |
| `overdue` | `partial` | System (on payment receipt) | Payment received after overdue |
| `overdue` | `paid` | System (on payment receipt) | Full payment received after overdue |
| Any active | `cancelled` | school_admin, accountant | Requires reason |

### History

- Invoices are never deleted. Cancelled invoices remain for audit.
- All payments against an invoice are recorded in `fee_payments` and never deleted.
- Status transitions triggered by payments are automatic and must be audit logged.

### UI Badge Behavior

| State | Color | Icon |
|-------|-------|------|
| `draft` | Gray | File |
| `issued` | Blue | Send |
| `partial` | Amber | Coins |
| `paid` | Green | Check-circle |
| `overdue` | Red | Alert-triangle |
| `cancelled` | Dark Gray | X |
