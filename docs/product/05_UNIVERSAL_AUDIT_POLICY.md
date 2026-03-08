# Universal Audit Policy

> Agora — Audit logging standard, gap analysis, and implementation guidance

---

## 1. Current Audit State

### What Exists

Agora has an automatic audit logging system implemented in `src/middleware/audit.js` and data stored in the `audit_logs` table.

**Table schema:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `school_id` | UUID (nullable) | Tenant scope (null for platform-level events) |
| `actor_user_id` | UUID (nullable) | User who performed the action (null for device/system events) |
| `action` | TEXT | The action identifier |
| `entity_name` | TEXT | The type of entity affected |
| `entity_id` | UUID (nullable) | The specific entity record ID |
| `metadata` | JSONB | Sanitized request/response payload |
| `created_at` | TIMESTAMPTZ | When the event occurred |

**Automatic logging behavior:**

- Fires on every POST, PATCH, PUT, DELETE request to `/api/v1/*` routes where the user is authenticated.
- Hooks into `res.on('finish')` to capture the response status after the handler completes.
- Skips responses with HTTP 5xx status (server errors are not business events).
- Skips `/internal/*` paths (observability, notification triggers).
- The `action` field is set to `{HTTP_METHOD} {route_path}` (e.g., `POST /api/v1/attendance/bulk`).
- The `entity_name` is derived from the route path segments.
- The `entity_id` is extracted from route parameters (`:id`, `:staffId`, `:invoiceId`, etc.).

**Payload sanitization:**

- Sensitive keys are redacted: `password`, `token`, `secret`, `authorization`, `api_key`, `refresh_token`, `access_token`, `password_hash`.
- Maximum 30 keys per object.
- Maximum nesting depth of 3.
- Strings truncated at 500 characters.
- Arrays truncated at 20 elements.

**Manual logging:**

- Device attendance ingest calls `createAuditLog()` directly with `actorUserId: null` and action `DEVICE_ATTENDANCE_INGEST`.

**Viewing:**

- `GET /admin/audit-logs` — paginated, filterable by `actor_user_id`, `action`, `entity_name`, date range. School_admin only.
- `GET /admin/audit-logs/export` — CSV or PDF export. School_admin only.

---

## 2. Gaps

### Missing from Automatic Logging

| Gap | Detail |
|-----|--------|
| No business event codes | The `action` field stores raw HTTP method + path, not semantic business events. This makes it hard to filter by business meaning. |
| No old-value capture | Changes (PATCH/PUT) do not record the previous state of the entity, only the new values from the request body. |
| No delegation context | When a user acts under a delegated permission, the audit log does not indicate which delegation authorized the action. |
| No bulk operation detail | Bulk operations (bulk attendance, bulk scores) log a single audit entry for the entire batch, not per-record. |
| Login/logout events are not logged | Auth routes are excluded from automatic audit because they fire before `req.auth` is populated (login) or use a different middleware path. |
| WebSocket events are not audited | Message sends via WebSocket emit realtime events but do not create audit log entries (message creation via HTTP POST is audited). |
| Worker actions are not audited | Notification dispatch, reminder creation, and metric publishing happen in workers without audit context. |
| Report exports are not audited | GET requests are not captured by the automatic audit middleware. Data export (CSV/PDF) should be logged as a sensitive read operation. |

### Missing from the Audit View

| Gap | Detail |
|-----|--------|
| No audit dashboard for principal | Only `school_admin` can view audit logs. `principal` should have read access. |
| No entity-scoped audit view | Cannot view all audit events for a specific student, staff member, or invoice from a profile page. |
| No diff view | The metadata stores request body but not a before/after comparison, so reviewers cannot see what changed. |

---

## 3. Target Audit Standard

### Principles

1. **Every state change must be logged.** Any creation, modification, deletion, or status transition of a business entity produces an audit event.
2. **Sensitive reads must be logged.** Viewing sensitive data (medical alerts, financial records, discipline records) and exporting data produce audit events.
3. **Actor identity is always recorded.** For authenticated actions, `actor_user_id` is set. For system/device actions, a system actor identifier is used.
4. **Delegation is traceable.** When a delegated permission authorizes an action, the `delegation_id` is included in the audit metadata.
5. **Bulk operations produce per-record logs.** Each individual record affected in a bulk operation gets its own audit entry.
6. **Audit records are immutable.** No UPDATE or DELETE operations are permitted on the `audit_logs` table.

---

## 4. Event Code Naming Pattern

Replace raw HTTP method + path with structured business event codes.

### Format

```
{domain}.{entity}.{action}
```

### Event Code Registry

| Event Code | When Fired |
|-----------|------------|
| `auth.session.login` | Successful login |
| `auth.session.logout` | User logout |
| `auth.session.refresh` | Token refresh |
| `auth.session.login_failed` | Failed login attempt |
| `institution.profile.updated` | School profile edited |
| `institution.section.created` | Section created |
| `institution.section.updated` | Section edited |
| `institution.classroom.created` | Classroom created |
| `institution.classroom.updated` | Classroom edited |
| `people.staff.created` | Staff profile created |
| `people.staff.updated` | Staff profile updated |
| `people.staff.status_changed` | Staff employment status changed |
| `people.student.created` | Student record created |
| `people.student.updated` | Student record updated |
| `people.student.status_changed` | Student status changed |
| `people.enrollment.created` | Student enrolled in classroom |
| `people.enrollment.updated` | Enrollment modified |
| `people.import.previewed` | Import file uploaded and parsed |
| `people.import.executed` | Import job executed |
| `academics.attendance.recorded` | Individual attendance marked |
| `academics.attendance.bulk_recorded` | Bulk attendance submitted |
| `academics.attendance.device_ingested` | Device attendance received |
| `academics.attendance.updated` | Attendance record modified |
| `academics.homework.created` | Homework assigned |
| `academics.homework.updated` | Homework modified |
| `academics.homework.deleted` | Homework removed |
| `academics.submission.created` | Student submission uploaded |
| `academics.submission.graded` | Submission graded by teacher |
| `academics.assessment.created` | Assessment created |
| `academics.assessment.updated` | Assessment modified |
| `academics.scores.bulk_entered` | Bulk score entry |
| `finance.plan.created` | Fee plan created |
| `finance.plan.updated` | Fee plan modified |
| `finance.invoice.created` | Invoice generated |
| `finance.invoice.status_changed` | Invoice status changed |
| `finance.payment.recorded` | Payment received |
| `communication.conversation.created` | Conversation started |
| `communication.message.sent` | Message sent |
| `communication.notification.test_sent` | Test notification dispatched |
| `events.event.created` | Event created |
| `events.event.updated` | Event modified |
| `events.event.deleted` | Event deleted |
| `security.rbac.template_updated` | Role permission template changed |
| `security.delegation.created` | Permission delegated |
| `security.delegation.revoked` | Delegation revoked |
| `security.audit.viewed` | Audit logs accessed |
| `security.audit.exported` | Audit logs exported |
| `reports.data.exported` | Report data exported (CSV/PDF) |
| `files.upload.requested` | File upload URL generated |
| `files.download.requested` | File download URL generated |

---

## 5. What Must Be Logged

### Mandatory Audit Events

| Category | Events | Priority |
|----------|--------|----------|
| Authentication | Login, logout, failed login, token refresh | High |
| People mutations | Create/update/status-change for staff, students, parents | High |
| Financial transactions | Invoice creation, payment recording, status changes | High |
| Permission changes | RBAC template updates, delegation create/revoke | High |
| Academic records | Attendance, scores, homework grades | Medium |
| Data export | Any CSV/PDF export of reports or audit logs | High |
| Bulk operations | Import execution, bulk attendance, bulk scores | High |
| Communication | Conversation creation, broadcast messages | Medium |
| Sensitive data access | Viewing medical alerts, financial records, discipline notes | Medium |

### Mandatory Metadata Fields

Every audit event should include at minimum:

| Field | Required | Description |
|-------|----------|-------------|
| `event_code` | Yes | Structured event code from the registry above |
| `actor_user_id` | Yes (nullable for system) | Who performed the action |
| `school_id` | Yes (nullable for platform) | Tenant scope |
| `entity_name` | Yes | Affected entity type |
| `entity_id` | Yes (nullable for bulk) | Specific record ID |
| `ip_address` | Recommended | Client IP for security audit |
| `user_agent` | Recommended | Client identifier |
| `delegation_id` | If applicable | Which delegation authorized this action |
| `old_values` | If applicable | Previous state for update operations |
| `new_values` | Yes for mutations | New state or request payload (sanitized) |

---

## 6. Delegated Action Representation

When a user acts under a delegated permission, the audit log must capture:

```json
{
  "event_code": "finance.payment.recorded",
  "actor_user_id": "user-abc",
  "entity_name": "fee_payments",
  "entity_id": "payment-xyz",
  "metadata": {
    "delegated": true,
    "delegation_id": "delegation-123",
    "original_permission": "finance.fees.manage",
    "delegated_by_user_id": "user-principal",
    "new_values": {
      "amount": 5000,
      "method": "cash"
    }
  }
}
```

### Rules

- The `actor_user_id` is always the user who performed the action, not the delegator.
- The `delegation_id` links to the `delegated_permissions` record that authorized the action.
- The `delegated_by_user_id` in metadata identifies the original grantor for quick reference.

---

## 7. Sensitive Event Handling

### Events Classified as Sensitive

| Event | Why Sensitive |
|-------|--------------|
| `auth.session.login_failed` | Potential brute force indicator |
| `people.student.status_changed` (to expelled) | Legal implications |
| `security.rbac.template_updated` | Permission escalation risk |
| `security.delegation.created` | Privilege grant |
| `finance.payment.recorded` | Financial transaction |
| `reports.data.exported` | Data exfiltration risk |
| `security.audit.exported` | Meta-audit sensitivity |

### Handling Rules

1. **Sensitive events must never be suppressed** — even if the request fails with a 4xx status, the attempt should be logged.
2. **Failed login attempts** should log the email attempted (not the password) and the IP address.
3. **Financial events** must include the full amount, method, and invoice reference in metadata.
4. **Export events** must log the report type, date range, and row count.
5. **RBAC changes** must log the before and after permission states.

---

## 8. Implementation Notes for Codex

### Phase 1 — Quick Wins (No Schema Change)

1. **Add login/logout audit logging** in `src/routes/auth.js`. After successful login, call `createAuditLog()` with event code `auth.session.login`. After logout, log `auth.session.logout`. On failed login, log `auth.session.login_failed` with the attempted email.

2. **Add export audit logging** in `src/routes/reports.js` and `src/routes/admin.js`. Before returning CSV/PDF data, call `createAuditLog()` with event code `reports.data.exported` or `security.audit.exported`.

3. **Add delegation context to audit metadata.** In the RBAC middleware or route handlers, when a user's effective permissions include a delegation, add `delegation_id` to the audit metadata.

### Phase 2 — Structured Event Codes

1. **Introduce an event code enum or constant map** in a new file `src/utils/audit-events.js`. Define all event codes from the registry in Section 4.

2. **Update the automatic audit middleware** to resolve the HTTP method + path into a structured event code. Fall back to the raw format for unrecognized routes.

3. **Add `event_code` column to `audit_logs` table** (TEXT, indexed). Populate from the event code map. Keep the existing `action` column for backward compatibility during migration.

### Phase 3 — Old Value Capture

1. **For PATCH/PUT routes that update a single entity**, fetch the current state before applying the update. Store `old_values` and `new_values` in the audit metadata.

2. **For bulk operations**, generate per-record audit entries with individual `entity_id` values. This may require batching the audit inserts.

3. **Consider a trigger-based approach** for critical tables (e.g., `fee_invoices`, `staff_profiles`) where a PostgreSQL trigger captures old row values into the audit log.
