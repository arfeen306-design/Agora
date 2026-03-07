# Agora API Contract (Step 3)

Version: `v1`  
Base URL: `/api/v1`  
Primary auth: `JWT access token` + `refresh token rotation`

## 1. Global Rules

### 1.1 Headers

- `Authorization: Bearer <access_token>` for protected routes
- `Content-Type: application/json`
- `X-School-Code: <school_code>` on login routes (or school can be derived from subdomain)

### 1.2 Response Envelope

Success:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "request_id": "4d6b6b5b-6e7e-4e8e-9f31-2170f6b94f84"
  }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "attendance_date is required",
    "details": [
      { "field": "attendance_date", "issue": "missing" }
    ]
  },
  "meta": {
    "request_id": "4d6b6b5b-6e7e-4e8e-9f31-2170f6b94f84"
  }
}
```

### 1.3 Pagination

Query params:

- `page` default `1`
- `page_size` default `20`, max `100`

Paginated meta:

```json
{
  "page": 1,
  "page_size": 20,
  "total_items": 314,
  "total_pages": 16
}
```

### 1.4 Role Access

- `school_admin` full school scope
- `teacher` assigned classrooms/subjects
- `parent` linked students only
- `student` own data only

## 2. Auth APIs

### POST `/auth/login`

Purpose: issue access + refresh tokens.

Request:

```json
{
  "school_code": "agora_demo",
  "email": "teacher1@agora.com",
  "password": "secret123"
}
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "access_token": "<jwt>",
    "refresh_token": "<opaque_or_jwt>",
    "expires_in": 900,
    "token_type": "Bearer",
    "user": {
      "id": "uuid",
      "school_id": "uuid",
      "first_name": "Areeba",
      "last_name": "Khan",
      "email": "teacher1@agora.com",
      "roles": ["teacher"]
    }
  }
}
```

### POST `/auth/refresh`

Request:

```json
{
  "refresh_token": "<token>"
}
```

Response `200`: same token shape as login.

### POST `/auth/logout`

Request:

```json
{
  "refresh_token": "<token>"
}
```

Response `200`: `{ "success": true, "data": { "logged_out": true } }`

### GET `/auth/me`

Response `200`: current user profile + roles + school.

## 3. Attendance APIs

Backed by table: `attendance_records`.

### GET `/attendance`

Access:

- `teacher`: own classes
- `parent`: linked children
- `student`: own records
- `school_admin`: all

Query:

- `student_id`
- `classroom_id`
- `date_from` (`YYYY-MM-DD`)
- `date_to` (`YYYY-MM-DD`)
- `status` (`present|absent|late|leave`)
- `page`, `page_size`

### POST `/attendance/bulk`

Purpose: mark attendance for a class/day in one call.

Request:

```json
{
  "classroom_id": "uuid",
  "attendance_date": "2026-03-08",
  "entries": [
    { "student_id": "uuid", "status": "present", "check_in_at": "2026-03-08T07:54:00Z", "source": "manual" },
    { "student_id": "uuid", "status": "late", "check_in_at": "2026-03-08T08:12:00Z", "source": "rfid" }
  ]
}
```

Response `200`: upsert summary `{ created_count, updated_count }`

### PATCH `/attendance/{attendance_id}`

Request fields (optional): `status`, `check_in_at`, `note`, `source`

## 4. Homework APIs

Backed by: `homework`, `homework_submissions`.

### GET `/homework`

Query:

- `classroom_id`
- `subject_id`
- `due_from`, `due_to`
- `published` (`true|false`)
- `page`, `page_size`

### POST `/homework`

Access: `teacher`, `school_admin`

Request:

```json
{
  "classroom_id": "uuid",
  "subject_id": "uuid",
  "title": "Algebra Worksheet 4",
  "description": "Solve Q1-Q10",
  "due_at": "2026-03-09T23:59:00Z",
  "attachment_urls": ["https://.../sheet.pdf"],
  "is_published": true
}
```

### PATCH `/homework/{homework_id}`

Editable fields: `title`, `description`, `due_at`, `attachment_urls`, `is_published`

### DELETE `/homework/{homework_id}`

Soft-delete recommended in implementation.

### GET `/homework/{homework_id}/submissions`

Access: teacher/admin for class, parent for linked child filtered view.

### POST `/homework/{homework_id}/submissions`

Access: student (self), teacher/admin (on behalf).

Request:

```json
{
  "student_id": "uuid",
  "status": "submitted",
  "attachment_urls": ["https://.../answer.jpg"]
}
```

### PATCH `/homework/submissions/{submission_id}`

Access: teacher/admin  
Editable fields: `status`, `score`, `feedback`, `graded_at`

## 5. Marks APIs

Backed by: `assessments`, `assessment_scores`.

### GET `/assessments`

Query:

- `classroom_id`
- `subject_id`
- `assessment_type`
- `date_from`, `date_to`
- `page`, `page_size`

### POST `/assessments`

Request:

```json
{
  "classroom_id": "uuid",
  "subject_id": "uuid",
  "title": "Monthly Test March",
  "assessment_type": "monthly",
  "max_marks": 50,
  "assessment_date": "2026-03-10"
}
```

### PATCH `/assessments/{assessment_id}`

Editable: `title`, `assessment_type`, `max_marks`, `assessment_date`

### POST `/assessments/{assessment_id}/scores/bulk`

Request:

```json
{
  "scores": [
    { "student_id": "uuid", "marks_obtained": 42.5, "remarks": "Excellent" },
    { "student_id": "uuid", "marks_obtained": 30, "remarks": "Needs revision" }
  ]
}
```

### GET `/students/{student_id}/marks/summary`

Response:

- overall average
- per subject average
- trend points for charting (month-wise or assessment-wise)

## 6. Messaging APIs

Backed by: `conversations`, `conversation_participants`, `messages`.

### GET `/conversations`

Returns user’s conversation list with unread count + last message.

### POST `/conversations`

Request:

```json
{
  "kind": "direct",
  "title": null,
  "participant_user_ids": ["uuid"]
}
```

### GET `/conversations/{conversation_id}/messages`

Query: `cursor`, `limit` (cursor pagination recommended)

### POST `/conversations/{conversation_id}/messages`

Request:

```json
{
  "kind": "text",
  "body": "Zain submitted homework today.",
  "attachment_urls": []
}
```

### POST `/conversations/{conversation_id}/read`

Marks thread read (`conversation_participants.last_read_at`).

### Realtime Channel (WebSocket)

URL: `/ws` with bearer token handshake  
Events:

- `message.new`
- `message.edited`
- `conversation.read`

## 7. Notification APIs

Backed by: `notifications`.

### GET `/notifications`

Query:

- `status` (`queued|sent|failed|read`)
- `channel` (`in_app|push|email|sms`)
- `page`, `page_size`

### PATCH `/notifications/{notification_id}/read`

Marks `read_at` and `status=read`.

### POST `/notifications/test`

Access: admin/teacher (optional policy)  
Purpose: send a test push to a target user.

Request:

```json
{
  "user_id": "uuid",
  "title": "Test Notification",
  "body": "Agora notification pipeline is active.",
  "channel": "push"
}
```

### Internal Trigger Endpoint

`POST /internal/notifications/trigger` (service-to-service only)

Use cases:

- attendance marked
- homework assigned
- marks published
- fee reminder

## 8. Status Codes

- `200` OK
- `201` Created
- `400` Bad Request
- `401` Unauthorized
- `403` Forbidden
- `404` Not Found
- `409` Conflict
- `422` Validation Error
- `500` Internal Server Error

## 9. Validation & Security Requirements

- All UUIDs must be validated.
- Scope every query with `school_id`.
- Enforce RBAC at API layer.
- Passwords stored as strong hash (`argon2id` or `bcrypt`).
- Access tokens short-lived (15 min suggested).
- Refresh tokens revocable via `user_sessions`.
- Rate-limit auth and messaging endpoints.
- Audit critical actions in `audit_logs`.

## 10. Build Order for Backend Team

1. `auth` module + JWT middleware + RBAC middleware
2. `attendance` module + notifications on create/update
3. `homework` module + submissions
4. `marks` module + summary analytics endpoint
5. `messaging` module + websocket gateway
6. `notifications` read APIs + worker integration (FCM)
