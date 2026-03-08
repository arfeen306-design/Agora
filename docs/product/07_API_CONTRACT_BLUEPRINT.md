# API Contract Blueprint

> Agora — Missing endpoints, permission corrections, and contract standards

---

## 1. Missing Endpoints

### Accountant Finance Access

These endpoints exist but the `accountant` role is not in their route guards.

| Method | Path | Current Roles | Required Roles |
|--------|------|--------------|----------------|
| GET | `/fees/plans` | school_admin | school_admin, accountant, principal (read) |
| POST | `/fees/plans` | school_admin | school_admin, accountant |
| PATCH | `/fees/plans/:planId` | school_admin | school_admin, accountant |
| GET | `/fees/invoices` | school_admin, parent (own) | school_admin, accountant, principal (read), parent (own) |
| POST | `/fees/invoices` | school_admin | school_admin, accountant |
| POST | `/fees/invoices/:invoiceId/payments` | school_admin | school_admin, accountant |
| GET | `/fees/invoices/:invoiceId/payments` | school_admin | school_admin, accountant |

### Leadership Report Access

| Method | Path | Current Roles | Required Roles |
|--------|------|--------------|----------------|
| GET | `/reports/attendance/summary` | scoped by role | Add principal, vice_principal, headmistress (section-scoped) |
| GET | `/reports/homework/summary` | scoped by role | Add principal, vice_principal, headmistress (section-scoped) |
| GET | `/reports/marks/summary` | scoped by role | Add principal, vice_principal, headmistress (section-scoped) |
| GET | `/reports/fees/summary` | scoped by role | Add principal, vice_principal, accountant |
| GET | `/reports/*/export` | scoped by role | Add principal, vice_principal, headmistress, accountant (fees only) |

### New Endpoints Required

#### Admissions Pipeline

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/admissions/pipeline` | school_admin, principal, front_desk | Pipeline view grouped by admission_status |
| POST | `/admissions/inquiries` | school_admin, front_desk | Create new inquiry |
| PATCH | `/admissions/:studentId/stage` | school_admin, principal, front_desk | Move applicant to next stage |
| POST | `/admissions/:studentId/admit` | school_admin | Convert accepted applicant to admitted student |

#### Student Profile Composite

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/students/:studentId/profile` | school_admin, principal, vice_principal, headmistress (section), teacher (own cls), parent (own child) | Composite profile with all sections |

#### Timeline

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/timeline/:studentId` | parent (own child), student (own) | Daily timeline feed |

#### Discipline

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/discipline/incidents` | school_admin, principal, vice_principal, headmistress (section), teacher (own cls) | List incidents |
| POST | `/discipline/incidents` | school_admin, principal, teacher | Report new incident |
| GET | `/discipline/incidents/:incidentId` | school_admin, principal, vice_principal, headmistress, teacher (own report) | Incident detail |
| PATCH | `/discipline/incidents/:incidentId` | school_admin, principal | Update/resolve incident |
| POST | `/discipline/incidents/:incidentId/consequences` | school_admin, principal | Add consequence |
| GET | `/discipline/students/:studentId/summary` | school_admin, principal, headmistress, teacher (own cls), parent (own child, non-sensitive) | Student discipline summary |

#### Document Vault

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/documents` | school_admin, principal | List all documents |
| POST | `/documents` | school_admin, principal, teacher, front_desk | Upload document metadata |
| GET | `/documents/:documentId` | Per access rules | Document detail |
| PATCH | `/documents/:documentId` | school_admin, principal | Update metadata |
| PATCH | `/documents/:documentId/archive` | school_admin, principal | Archive document |
| GET | `/documents/student/:studentId` | school_admin, principal, teacher (own cls), parent (own child) | Student documents |
| POST | `/documents/:documentId/access` | school_admin, principal | Set access rules |

#### Auth Audit Events

| Method | Path | Current | Required |
|--------|------|---------|----------|
| POST | `/auth/login` | No audit | Add audit log for login and login_failed |
| POST | `/auth/logout` | No audit | Add audit log for logout |

---

## 2. Corrected Endpoint Permissions

Summary of all permission corrections needed in existing routes.

| File | Endpoint | Change |
|------|----------|--------|
| `src/routes/fees.js` | All fee routes | Add `accountant` to `requireRoles()` |
| `src/routes/fees.js` | GET `/fees/plans`, GET `/fees/invoices` | Add `principal` as read-only |
| `src/routes/reports.js` | All summary routes | Add `principal`, `vice_principal` |
| `src/routes/reports.js` | Summary routes | Add `headmistress` with section-scoped filtering |
| `src/routes/reports.js` | Fee summary/export | Add `accountant` |
| `src/routes/admin.js` | GET `/admin/audit-logs` | Consider adding `principal` as read-only |
| `src/routes/rbac.js` | POST `/rbac/delegations` | Add validation: `granted_to_user_id !== granted_by_user_id` |

---

## 3. Request and Response Shapes

### Standard Envelope

All responses follow this shape:

```
Success:
{
  "success": true,
  "data": T,
  "meta": {
    "request_id": "uuid",
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total_items": 150,
      "total_pages": 8
    }
  }
}

Error:
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": [
      { "field": "email", "issue": "Required" }
    ]
  },
  "meta": {
    "request_id": "uuid"
  }
}
```

**Correction needed:** Some existing routes return `meta.total_items` and `meta.total_pages` as flat fields instead of nesting them inside `meta.pagination`. All routes should use the nested format.

### Admissions Pipeline Response

```
GET /admissions/pipeline

{
  "success": true,
  "data": {
    "stages": {
      "inquiry": { "count": 12, "students": [...] },
      "applied": { "count": 8, "students": [...] },
      "under_review": { "count": 5, "students": [...] },
      "test_scheduled": { "count": 2, "students": [...] },
      "accepted": { "count": 3, "students": [...] },
      "waitlisted": { "count": 1, "students": [...] },
      "rejected": { "count": 4, "students": [...] }
    },
    "summary": {
      "total_active": 31,
      "conversion_rate": 0.42
    }
  }
}
```

### Stage Transition Request

```
PATCH /admissions/:studentId/stage

{
  "new_status": "accepted",
  "notes": "Passed entrance test with 85%"
}
```

### Timeline Response

```
GET /timeline/:studentId?date=2026-03-08

{
  "success": true,
  "data": {
    "date": "2026-03-08",
    "student_id": "uuid",
    "events": [
      {
        "type": "attendance",
        "time": "08:05:00",
        "data": {
          "status": "present",
          "check_in_at": "2026-03-08T08:05:00Z",
          "source": "rfid"
        }
      },
      {
        "type": "homework_assigned",
        "time": "09:30:00",
        "data": {
          "homework_id": "uuid",
          "title": "Math Chapter 5 Exercises",
          "subject": "Mathematics",
          "due_at": "2026-03-10T23:59:00Z"
        }
      },
      {
        "type": "assessment_score",
        "time": "11:00:00",
        "data": {
          "assessment_id": "uuid",
          "title": "Science Quiz 3",
          "subject": "Science",
          "marks_obtained": 8.5,
          "max_marks": 10
        }
      }
    ]
  }
}
```

### Discipline Incident Request

```
POST /discipline/incidents

{
  "student_id": "uuid",
  "incident_date": "2026-03-08",
  "incident_type": "minor_infraction",
  "description": "Disrupting class during lesson",
  "location": "Classroom G5-A",
  "severity": "low",
  "is_sensitive": false
}
```

### Document Upload Request

```
POST /documents

{
  "title": "Birth Certificate",
  "category": "certificate",
  "scope_type": "student",
  "scope_id": "student-uuid",
  "file_key": "school-uuid/profile/2026/03/08/uuid-birth-certificate.pdf",
  "file_name": "birth-certificate.pdf",
  "file_size_bytes": 245000,
  "mime_type": "application/pdf"
}
```

### Student Profile Composite Response

```
GET /students/:studentId/profile

{
  "success": true,
  "data": {
    "student": { ... },
    "enrollment": { ... },
    "guardian": { ... },
    "attendance_summary": {
      "total_days": 120,
      "present": 110,
      "absent": 5,
      "late": 4,
      "leave": 1,
      "rate": 91.67
    },
    "marks_summary": {
      "assessments": [...],
      "average_percentage": 78.5,
      "trend": [...]
    },
    "homework_summary": {
      "total_assigned": 45,
      "submitted": 42,
      "completion_rate": 93.3
    },
    "fee_summary": {
      "total_due": 50000,
      "total_paid": 35000,
      "outstanding": 15000,
      "overdue_count": 1
    },
    "recent_discipline": [...],
    "documents": [...]
  }
}
```

Note: Sections are included or excluded based on the requesting user's role. Teachers do not see `fee_summary`. Parents do not see internal `discipline` notes.

---

## 4. Validation Notes

### Global Validation Rules

| Rule | Detail |
|------|--------|
| UUID format | All ID parameters must be valid UUID v4 |
| Date format | All date fields must be ISO 8601 (`YYYY-MM-DD`) |
| Timestamp format | All timestamp fields must be ISO 8601 with timezone (`YYYY-MM-DDTHH:mm:ssZ`) |
| Pagination | `page` >= 1, `page_size` between 1 and 100 (default 20) |
| String lengths | `title` max 200 chars, `description` max 5000 chars, `notes` max 2000 chars |
| Amount fields | Must be positive numbers with max 2 decimal places |
| Enum fields | Must match defined values (validated by Zod schemas) |
| Tenant isolation | `school_id` is always derived from JWT, never accepted from client |

### Per-Module Validation

| Module | Rule |
|--------|------|
| Attendance | `attendance_date` cannot be more than 7 days in the past |
| Homework | `due_at` must be after `assigned_at` |
| Assessment | `max_marks` must be > 0 |
| Score | `marks_obtained` must be >= 0 and <= `max_marks` |
| Fee Plan | `amount` must be > 0, `due_day` between 1 and 31 |
| Invoice | `amount_due` must be > 0, `due_date` must be a valid future date on creation |
| Payment | `amount` must be > 0 and <= remaining balance |
| Import | File size max 5 MB, max 2000 rows per job |
| Discipline | `incident_date` cannot be in the future |

---

## 5. Error Handling Standard

### Error Codes

| HTTP Status | Code | When |
|-------------|------|------|
| 400 | `BAD_REQUEST` | Malformed request body or parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | User does not have the required role |
| 403 | `TENANT_SCOPE_MISMATCH` | User's school_id does not match the resource |
| 404 | `NOT_FOUND` | Resource does not exist or is not accessible |
| 409 | `CONFLICT` | Duplicate resource (unique constraint violation) |
| 422 | `VALIDATION_ERROR` | Zod validation failure with field-level details |
| 429 | `RATE_LIMITED` | Too many requests (when rate limiting is enabled) |
| 500 | `INTERNAL_ERROR` | Unhandled server error |

### Error Response Shape

```
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "amount", "issue": "Must be a positive number" },
      { "field": "due_date", "issue": "Must be a future date" }
    ]
  },
  "meta": {
    "request_id": "uuid"
  }
}
```

### Rules for Codex

- Always return the standard error envelope. Never return raw strings or unstructured error objects.
- Use `VALIDATION_ERROR` (422) for business rule violations, not `BAD_REQUEST` (400).
- Use `NOT_FOUND` (404) even when the resource exists but the user does not have access (do not leak existence information).
- Include `request_id` in all error responses for traceability.
- Log 5xx errors to the server console with full stack traces. Do not expose stack traces to clients.

---

## 6. Audit Hooks

Every new endpoint must include audit logging. Follow these patterns:

### Automatic (already covered by middleware)

- All POST, PATCH, PUT, DELETE routes under `/api/v1/*` with authenticated users are automatically logged.

### Manual (must be added explicitly)

| Endpoint | Audit Event Code | Notes |
|----------|-----------------|-------|
| POST `/auth/login` | `auth.session.login` | Log after successful authentication |
| POST `/auth/login` (failure) | `auth.session.login_failed` | Log attempted email and IP |
| POST `/auth/logout` | `auth.session.logout` | Log before session revocation |
| GET `/reports/*/export` | `reports.data.exported` | Log report type, filters, row count |
| GET `/admin/audit-logs/export` | `security.audit.exported` | Log date range and row count |
| PATCH `/admissions/:id/stage` | `admissions.stage.changed` | Log old_status and new_status |
| POST `/discipline/incidents` | `discipline.incident.reported` | Log student_id and incident_type |
| PATCH `/discipline/incidents/:id` | `discipline.incident.updated` | Log status change |

### Audit Metadata Requirements

For new endpoints, include in audit metadata:

```
{
  "event_code": "structured.event.code",
  "old_values": { ... },  // for updates
  "new_values": { ... },  // request body (sanitized)
  "delegation_id": "uuid" // if action was delegated
}
```

See `05_UNIVERSAL_AUDIT_POLICY.md` for the full event code registry.
