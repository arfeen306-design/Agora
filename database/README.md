# Agora Database (Step 2)

This folder contains the PostgreSQL schema for Agora:

- `agora_schema.sql`: full multi-tenant schema (school-level partitioning via `school_id`) with:
  - Auth + RBAC
  - Students/parents/teachers
  - Academic setup
  - Attendance
  - Homework + submissions
  - Assessments + scores
  - Messaging
  - Notifications
  - Fees
  - Events
  - Audit logs

## Apply Schema

```bash
psql -h <HOST> -U <USER> -d <DB_NAME> -f database/agora_schema.sql
```

## Suggested Step 3

Implement API contract in `agora-api`:

1. `POST /auth/login`, `POST /auth/refresh`
2. `GET/POST /attendance`
3. `GET/POST /homework`
4. `GET/POST /assessments`, `GET/POST /scores`
5. `GET/POST /messages`
6. `GET /notifications`
