# Edge Case and Failure Library

> Agora — Comprehensive edge cases, failure scenarios, and expected system behavior

---

## 1. Authentication and Sessions

### EC-AUTH-01: Concurrent sessions from multiple devices

**Scenario:** A user logs in from a phone and a laptop simultaneously.
**Expected behavior:** Both sessions are valid. Each has its own refresh token. Logging out on one device does not affect the other. The `user_sessions` table stores one row per active session.
**UI behavior:** No cross-device notification. Each device operates independently.
**Audit:** Each login produces a separate audit event.

### EC-AUTH-02: Refresh token reuse (replay attack)

**Scenario:** An attacker captures a refresh token and tries to use it after the legitimate user has already refreshed.
**Expected behavior:** The server stores only the latest refresh token hash per session. The replayed token fails hash comparison. Return 401. The session should be revoked (force re-login on all devices for that session).
**UI behavior:** Redirect to login with "Session expired" message.

### EC-AUTH-03: User account deactivated while session is active

**Scenario:** School admin sets `users.is_active = false` while the user has a valid JWT.
**Expected behavior:** The JWT remains valid until expiry (max 15 minutes). On next token refresh, the server checks `is_active` and rejects the refresh. Alternatively, the `requireAuth` middleware should check `is_active` on every request.
**Recommendation:** Check `is_active` in `requireAuth` middleware for immediate effect.
**UI behavior:** Next API call returns 401. Redirect to login with "Account deactivated" message.

### EC-AUTH-04: Login with wrong school code

**Scenario:** User enters correct email and password but wrong school code.
**Expected behavior:** Return 401 "Invalid credentials." Do not reveal whether the school code exists.
**Audit:** Log `auth.session.login_failed` with the attempted school_code and email.

---

## 2. Multi-Tenancy and Isolation

### EC-TENANT-01: API request with mismatched school_id

**Scenario:** A user authenticated under School A tries to access a resource belonging to School B by guessing the resource UUID.
**Expected behavior:** RLS policies prevent the query from returning results. The API returns 404 (not 403) to avoid leaking existence information. The middleware returns `TENANT_SCOPE_MISMATCH` (403) if the school_id in the URL parameter mismatches the JWT.
**Audit:** Log the attempt with the mismatched school_id.

### EC-TENANT-02: Device attendance ingest with wrong API key

**Scenario:** An RFID device sends attendance data with an invalid `X-Device-Api-Key`.
**Expected behavior:** Return 401. No data is written. No audit log is created (no actor context).
**Permission implication:** Device API key validation happens before any DB operation.

### EC-TENANT-03: RLS not enabled on a table

**Scenario:** A new table is created but not added to the RLS policy migration.
**Expected behavior:** Queries against that table bypass tenant isolation. This is a security vulnerability.
**Prevention:** Every new table with a `school_id` column MUST be added to the tenant RLS policy. Add to the Codex checklist.

---

## 3. Attendance

### EC-ATT-01: Duplicate attendance for the same student and date

**Scenario:** A teacher submits attendance, then the RFID device also ingests attendance for the same student on the same day.
**Expected behavior:** The `UNIQUE(school_id, student_id, attendance_date)` constraint prevents duplicates. The bulk upsert uses `ON CONFLICT DO UPDATE`, so the later submission overwrites the earlier one. Device ingest does the same.
**UI behavior:** Teacher sees the most recent status. If the device overwrites the teacher's entry, the teacher may not be aware.
**Recommendation:** Add a `source` indicator in the attendance list so teachers can see if a record was manually entered or device-ingested.

### EC-ATT-02: Attendance for a student not enrolled in the classroom

**Scenario:** A student was withdrawn but the teacher tries to mark attendance.
**Expected behavior:** The API should validate that the student has an active enrollment in the specified classroom. Return 422 "Student is not enrolled in this classroom."
**UI behavior:** Student should not appear in the attendance sheet if not actively enrolled.

### EC-ATT-03: Attendance submission after school hours cutoff

**Scenario:** A teacher submits attendance at 11 PM for today.
**Expected behavior:** Currently no time restriction exists. Attendance can be submitted for any past date within 7 days.
**Recommendation:** Consider a configurable cutoff (e.g., school_ends_at + 4 hours). After cutoff, require school_admin override.

### EC-ATT-04: Late arrival auto-classification

**Scenario:** A student checks in at 8:45 AM. The school's `late_arrival_cutoff` is 8:30 AM.
**Expected behavior:** Device ingest compares `check_in_at` to `school_starts_at` and `late_arrival_cutoff`. If `check_in_at > late_arrival_cutoff`, status is set to `late`. If `check_in_at <= school_starts_at`, status is `present`.
**Edge case:** If `late_arrival_cutoff` is not configured on the school, default to `present`.

---

## 4. Finance

### EC-FIN-01: Payment exceeding invoice balance

**Scenario:** Invoice has amount_due = 5000, amount_paid = 3000, and someone tries to record a payment of 3000 (remaining is 2000).
**Expected behavior:** Reject with 422 "Payment amount exceeds remaining balance." Remaining = amount_due - amount_paid.
**UI behavior:** Payment form should show the remaining balance and pre-fill or cap the amount field.

### EC-FIN-02: Duplicate payment recording

**Scenario:** Accountant clicks "Record Payment" twice rapidly.
**Expected behavior:** No unique constraint on `fee_payments` prevents this because duplicate payments for different amounts on different dates are legitimate. Implement frontend debouncing. Backend could check for identical payments (same amount, date, method, reference_no) within a 1-minute window and warn.
**UI behavior:** Disable the submit button after first click until the API responds.

### EC-FIN-03: Fee plan amount change after invoices generated

**Scenario:** Accountant changes a fee plan amount from 5000 to 6000 after invoices have already been issued.
**Expected behavior:** Existing invoices are NOT retroactively updated. Only new invoices created from the updated plan use the new amount. The plan update should warn about existing invoices.
**UI behavior:** Show a confirmation dialog: "X invoices have already been generated with the previous amount. They will not be updated."

### EC-FIN-04: Invoice status when overdue payment arrives

**Scenario:** An invoice is marked `overdue`. A partial payment is recorded.
**Expected behavior:** Status transitions from `overdue` to `partial` (if balance remains) or `paid` (if fully paid). The overdue marker is replaced by the payment status.
**Audit:** Log both the payment and the status transition.

### EC-FIN-05: Cancelling an invoice with payments

**Scenario:** An invoice has partial payments recorded and the school admin wants to cancel it.
**Expected behavior:** Cancellation should be allowed but recorded payments remain in the system for audit. The cancelled invoice shows the payments as historical entries. A note is required explaining the cancellation.
**UI behavior:** Show a warning: "This invoice has X payments recorded. Cancelling will not reverse the payments."

---

## 5. People and Imports

### EC-PEOPLE-01: Student code collision during import

**Scenario:** An import CSV contains a student_code that already exists in the school.
**Expected behavior:** The import engine marks that row as invalid with error "student_code already exists." The row is skipped during execution. Other valid rows proceed.
**UI behavior:** Import preview table highlights the row in red with the error message.

### EC-PEOPLE-02: Parent auto-creation during import with existing phone

**Scenario:** The import creates a parent user, but a user with the same phone number already exists in the school.
**Expected behavior:** The import should link the existing parent user to the new student instead of creating a duplicate. The `UNIQUE(school_id, phone)` constraint on `users` prevents duplicate creation.
**UI behavior:** Import preview should note "Parent account already exists, will be linked."

### EC-PEOPLE-03: Teacher assigned to classroom in wrong section

**Scenario:** A teacher's staff profile is in Section "Junior" but they are assigned to a classroom in Section "Senior."
**Expected behavior:** Currently no cross-section validation exists. The assignment is allowed.
**Recommendation:** Add a soft warning (not a hard block) when assigning staff across sections.

### EC-PEOPLE-04: Student withdrawal with active fee invoices

**Scenario:** A student is being withdrawn but has outstanding invoices.
**Expected behavior:** Student status can be changed to `withdrawn`. Outstanding invoices should NOT be auto-cancelled (they represent real debt). A warning should be shown: "Student has X outstanding invoices totaling Y."
**Audit:** Log both the student status change and a note about outstanding invoices.

### EC-PEOPLE-05: Import job with all rows invalid

**Scenario:** Every row in the uploaded CSV fails validation.
**Expected behavior:** Import job status transitions to `validated` with `valid_rows = 0`. The execute endpoint should reject with "No valid rows to import."
**UI behavior:** Import preview shows all rows in red. Execute button is disabled.

---

## 6. Academics

### EC-ACAD-01: Assessment scores submitted for unenrolled student

**Scenario:** Bulk score entry includes a student who has since been unenrolled from the classroom.
**Expected behavior:** The API validates enrollment status. Return 422 for the specific student. If using bulk entry, other valid scores should still be saved (partial success).
**UI behavior:** The student's score row shows an error indicator.

### EC-ACAD-02: Marks obtained exceeds max marks

**Scenario:** A teacher enters marks_obtained = 12 for an assessment with max_marks = 10.
**Expected behavior:** Zod validation rejects: "marks_obtained must be <= max_marks." Return 422.
**UI behavior:** Input field shows error styling immediately. Form cannot be submitted.

### EC-ACAD-03: Homework deleted after submissions exist

**Scenario:** A teacher deletes homework that has student submissions.
**Expected behavior:** Currently, homework deletion is allowed. Submissions become orphaned (homework_id references a deleted record). Soft delete is preferred.
**Recommendation:** Implement soft delete for homework (add `deleted_at` field) or prevent deletion if submissions exist.

### EC-ACAD-04: Academic year switch mid-term

**Scenario:** School admin sets a new academic year as current while the old year has ongoing activities.
**Expected behavior:** The system should warn about active enrollments, open homework, and pending invoices in the current year. The switch should not auto-migrate anything. Classrooms, enrollments, and plans for the new year must be created explicitly.
**UI behavior:** Multi-step confirmation dialog listing counts of active entities in the current year.

---

## 7. Communication

### EC-COMM-01: WebSocket connection lost

**Scenario:** A user's internet drops while in a conversation.
**Expected behavior:** The WebSocket client should attempt reconnection with exponential backoff. Messages sent during disconnection are not lost (they exist in the database). On reconnection, the client fetches missed messages via HTTP.
**UI behavior:** Show a "Reconnecting..." banner. Hide it when reconnected.

### EC-COMM-02: Message sent to a deactivated user

**Scenario:** A teacher sends a message to a parent whose account has been deactivated.
**Expected behavior:** The message is stored in the database. The WebSocket delivery to the deactivated user fails silently (no active connection). Push notifications to the user's devices still attempt delivery (the push token may still be valid).
**Recommendation:** When a user account is deactivated, revoke their push tokens.

### EC-COMM-03: Broadcast to large group

**Scenario:** School admin sends a broadcast message to all parents (potentially hundreds).
**Expected behavior:** The conversation is created with kind = `broadcast`. All parents are added as participants. Message delivery via WebSocket iterates through all connected parents. Push notifications are queued in the `notifications` table for batch processing by the worker.
**Performance concern:** If 500 parents are connected, the server sends 500 WebSocket frames. This should be optimized to avoid blocking the event loop.

---

## 8. RBAC and Permissions

### EC-RBAC-01: Delegation expires during an active session

**Scenario:** A delegated permission expires while the user is actively using a feature that requires it.
**Expected behavior:** The next API call that checks the delegation's `ends_at` field will reject the request. Return 403.
**UI behavior:** Show a toast: "Your delegated access to [permission] has expired." Redirect to the default dashboard.

### EC-RBAC-02: Revoking a delegation while the user is online

**Scenario:** A principal revokes a teacher's delegated finance access while the teacher is viewing invoices.
**Expected behavior:** On the next API call, the effective permissions check excludes the revoked delegation. Return 403.
**UI behavior:** Same as EC-RBAC-01.

### EC-RBAC-03: Role template update affecting active users

**Scenario:** School admin updates the teacher role template to remove `academics.homework.manage`.
**Expected behavior:** All teachers immediately lose homework management access. The RBAC check reads the current template on every request. No cached permissions.
**UI behavior:** Teachers see an error if they try to create homework. The sidebar item may need to be hidden dynamically.

### EC-RBAC-04: User with no roles

**Scenario:** A user exists in the `users` table but has no entries in `user_roles`.
**Expected behavior:** The user can authenticate but has zero permissions. Every `requireRoles()` check returns 403. The `getMe` endpoint returns an empty `roles` array.
**UI behavior:** User sees an empty dashboard with a message: "No permissions assigned. Contact your school administrator."

---

## 9. Imports

### EC-IMPORT-01: File exceeds maximum size

**Scenario:** A user uploads a 10 MB CSV file (limit is 5 MB).
**Expected behavior:** Return 422 "File size exceeds the maximum allowed (5 MB)."
**UI behavior:** Show error before upload starts (client-side check).

### EC-IMPORT-02: CSV with unexpected column headers

**Scenario:** The CSV has columns that do not match any expected field names.
**Expected behavior:** The import engine's auto-mapping attempts to match columns using fuzzy matching (e.g., "Student Name" maps to `student_full_name`). Unrecognized columns are ignored. If required columns are missing, all rows are marked invalid.
**UI behavior:** Import preview shows the column mapping. User can manually correct mappings before execution.

### EC-IMPORT-03: Import execution interrupted

**Scenario:** The server crashes during import execution after processing 500 of 1000 rows.
**Expected behavior:** Each row is processed within a savepoint. Successfully inserted rows remain. The import job stays in `executing` status. On server restart, the job should be detected and either resumed or marked as `failed` with a note about partial completion.
**Recommendation:** Add a `processed_rows` counter that updates during execution.

### EC-IMPORT-04: Concurrent imports for the same school

**Scenario:** Two school admins start student imports simultaneously.
**Expected behavior:** Both imports proceed independently. Student code uniqueness is enforced at the database level. If both imports contain the same student_code, the second one to execute will fail for that row.
**UI behavior:** Each admin sees their own import status independently.

---

## 10. Device Attendance Ingest

### EC-DEV-01: Unknown student identifier from device

**Scenario:** An RFID tag scans a card with a student_code that does not exist in the system.
**Expected behavior:** The ingest endpoint should log the unknown identifier and skip the record. Do not create a student. Return a partial success response listing unresolved identifiers.
**Audit:** Log `academics.attendance.device_ingested` with metadata indicating unresolved IDs.

### EC-DEV-02: Device sends attendance for a holiday

**Scenario:** A student scans their card on a configured weekly holiday.
**Expected behavior:** Currently no holiday check exists. The attendance record is created as normal.
**Recommendation:** Check `schools.weekly_holidays` array against the attendance date. If it is a holiday, either skip the record or flag it with a note.

### EC-DEV-03: Multiple scans from the same student in one day

**Scenario:** A student scans their RFID card at entry (8:00 AM) and again at re-entry after lunch (1:00 PM).
**Expected behavior:** The `UNIQUE(school_id, student_id, attendance_date)` constraint means only one record per day. The second scan triggers `ON CONFLICT DO UPDATE`, updating the `check_in_at` to the latest scan. This may not be desirable.
**Recommendation:** Consider keeping only the first scan as the check-in time. Add a `check_out_at` field for the last scan.

---

## 11. System and Infrastructure

### EC-SYS-01: Database connection pool exhaustion

**Scenario:** All database connections are in use during a traffic spike.
**Expected behavior:** New queries wait in the pool queue. If the queue exceeds a timeout, return 503 "Service temporarily unavailable."
**UI behavior:** Show a generic error page with retry option.

### EC-SYS-02: Notification worker crash

**Scenario:** The notification worker process crashes and does not restart.
**Expected behavior:** Notifications remain in `queued` status indefinitely. The SLO endpoint's `oldest_queued_minutes` alarm triggers after the configured threshold (default 30 min). CloudWatch alarms fire and notify via SNS.
**UI behavior:** Users stop receiving push notifications. In-app notifications are not affected (they are already in the database).

### EC-SYS-03: File storage provider unavailable

**Scenario:** S3 is temporarily unreachable when a user requests an upload URL.
**Expected behavior:** Return 503 with a clear error message. Do not expose S3-specific error details to the client.
**UI behavior:** Show "File upload temporarily unavailable. Please try again."

### EC-SYS-04: JWT secret rotation

**Scenario:** The JWT_ACCESS_SECRET is rotated to a new value.
**Expected behavior:** All existing access tokens become invalid immediately. Users are forced to re-authenticate via their refresh token (signed with JWT_REFRESH_SECRET). If both secrets are rotated simultaneously, all sessions are invalidated.
**Recommendation:** Rotate access and refresh secrets separately with overlap periods.
