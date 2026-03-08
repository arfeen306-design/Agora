# Teacher / Staff Convergence Plan

> Scope: Phase 1 closeout item #1  
> Date: 2026-03-08  
> Status: In progress (Phase 1 implementation shipped, DB FK migration deferred by design)

## Problem

Agora currently has two overlapping teacher models:

1. `staff_profiles` (canonical people model)
2. `teachers` (legacy table still referenced by older classroom/timetable foreign keys)

This creates duplication risk and route-level inconsistencies.

## Convergence strategy

Adopt a staged migration to avoid production breakage:

1. **Identity convergence (now)**
   - Treat `staff_profiles` as canonical source of teacher lifecycle state.
   - Keep `teachers` as compatibility projection for legacy FK columns.
   - Centralize teacher scope logic in one backend utility.
2. **Route convergence (now)**
   - Remove route-level custom SQL that directly resolves teacher scope from `teachers`.
   - Reuse shared utility for classroom scope and teacher identity resolution.
3. **Schema convergence (later, planned)**
   - Introduce `staff_profile_id`-based FKs for timetable/classroom subject ownership.
   - Backfill and swap reads/writes.
   - Retire `teachers` table to compatibility view, then deprecate fully.

## Implemented in this slice

### New shared utility

- `agora-api/src/utils/teacher-scope.js`

Provides:

- `getTeacherIdentityByUser`
- `listTeacherClassroomIds`
- `teacherCanManageClassroom`
- `ensureTeacherCanManageClassroom`

Behavior:

- Uses `staff_profiles` + `staff_classroom_assignments` as primary scope source.
- Uses legacy `teachers` links (`classroom_subjects.teacher_id`, `classrooms.homeroom_teacher_id`) as compatibility fallback.
- Rejects inactive/non-teacher staff profile access for teacher-scoped operations.

### Route migrations to shared scope utility

- `agora-api/src/routes/attendance.js`
- `agora-api/src/routes/homework.js`
- `agora-api/src/routes/marks.js`
- `agora-api/src/routes/lookups.js`
- `agora-api/src/routes/reports.js`

Changes include:

- Teacher classroom authorization now resolves through shared utility.
- Teacher read filters use `classroom_id = ANY($n::uuid[])` with centralized classroom scope results.
- Homework create path resolves teacher projection through shared identity utility.
- Reports teacher scope now uses centralized classroom scope in role filtering.

## What remains for full convergence

1. Migrate remaining legacy joins in:
   - `agora-api/src/routes/people.js`
   - `agora-api/src/routes/discipline.js`
   - `agora-api/src/routes/timetable.js`
   - `agora-api/src/routes/institution.js` (read-side teacher labels)
2. Add migration path for FK replacement:
   - `classrooms.homeroom_teacher_id`
   - `classroom_subjects.teacher_id`
   - timetable teacher columns
3. Introduce compatibility DB view and data backfill jobs.
4. Remove direct `teachers` table writes from all routes after FK migration completes.

## Guardrails

- Keep tenant scoping (`school_id`) in all teacher scope queries.
- Keep audit behavior unchanged for current endpoints.
- Do not remove `teachers` until all FK dependents are migrated.
