# Roadmap V2 — 4 Week Execution Plan

> Project: Agora School Operating Platform  
> Date: March 8, 2026  
> Baseline commit: `d38a623`  
> Scope: Release-quality execution plan aligned to current implemented codebase

## 1. Current state summary

Agora already has production-grade foundations across:

1. multi-tenant auth + RBAC + delegated permissions
2. attendance, homework, marks, fees, events, messaging, notifications
3. institution setup, people management, parent management, admissions foundation
4. leadership dashboards (principal + section)
5. student profile, timetable foundation, discipline foundation
6. audit logging + observability + workers + CI/CD pipelines
7. backend test suite stability with serial CI test execution

Current maturity focus is no longer foundational module creation. The next cycle must prioritize operational depth and release hardening:

1. staff identity convergence completion
2. HR and payroll as the next major business layer
3. document vault depth
4. setup wizard and analytics depth
5. branch-aware architecture, then mobile parity and release hardening

## 2. Goals for next 4 weeks

By end of week 4, the platform should achieve:

1. canonical staff identity behavior with minimized legacy teacher dependency risk
2. HR + payroll core workflow (structures, periods, payroll records, salary slips, adjustments, self-service)
3. document vault integration points ready for HR/admissions/student/finance
4. measurable frontend confidence improvements for role-aware routing and core operational pages
5. release readiness uplift (runbook updates, env checks, observability threshold review)

## 3. Weekly execution breakdown

## Week 1 — Stabilize and converge

Primary outcomes:

1. close remaining teacher/staff convergence route debt
2. enforce response envelope consistency on newly added APIs
3. preserve green backend/web CI after convergence changes
4. establish HR/payroll schema and route contracts

Definition of done:

1. convergence routes migrated or documented with compatibility guardrails
2. no regression in attendance/homework/marks/timetable/disciplines tests
3. roadmap-aligned technical spec and DB migration plan merged

## Week 2 — HR/Payroll backend vertical slice

Primary outcomes:

1. HR schema migration applied (salary structures, payroll periods/records, adjustments, leave records)
2. secured API endpoints for HR admin/school admin/principal/accountant/teacher self-service
3. salary slip export endpoint and audit logging for sensitive financial writes
4. backend tests for permissions, tenant scoping, self-service isolation

Definition of done:

1. backend HR/payroll API working end-to-end with test coverage
2. all payroll-sensitive endpoints enforce role and identity scope correctly
3. CI fully green

## Week 3 — HR/Payroll web operations + self-service

Primary outcomes:

1. HR dashboard + staff HR profile pages
2. salary structure, payroll period, payroll detail and adjustment pages
3. teacher self-service finance/attendance/leave pages (read-only financial views)
4. role-aware navigation integration and smoke tests

Definition of done:

1. leadership/HR roles can run payroll workflows from web
2. teachers can only access own HR/finance self-service pages
3. web lint/build/tests green

## Week 4 — Document hooks, quality gates, release prep

Primary outcomes:

1. integrate HR records with document vault hooks and placeholders
2. hardening pass for error handling, export auditing, and contract consistency
3. release runbook and production readiness checklist refresh
4. backlog preparation for phase-5+ items (wizard, analytics, multi-branch)

Definition of done:

1. no P0/P1 security, permission, or audit gaps open for HR/payroll scope
2. release runbook updated and validated against current workflows
3. rollout checklist approved

## 4. Backend workstream

1. complete staff identity convergence compatibility layer
2. add HR/payroll migration set with non-destructive history tables
3. implement route layer for:
   1. staff HR profile expansion
   2. salary structures + revision history
   3. payroll periods + payroll generation + payment status
   4. adjustment/increment tracking
   5. teacher self-service HR/finance/attendance summary
4. integrate export endpoints with audit events
5. add targeted API tests for permissions + tenant boundaries + self-only visibility

## 5. Web workstream

1. add role-aware HR navigation
2. implement pages:
   1. HR command center
   2. staff HR profile
   3. salary structures
   4. payroll periods/list/detail
   5. adjustments
   6. teacher self-service finance
   7. teacher salary slip detail
   8. teacher attendance + leave summary
3. preserve design system alignment (`09_UI_COMPONENT_SYSTEM.md`)
4. add regression tests for role gating and page rendering

## 6. Mobile workstream

Week 1-4 target is parity preparation, not full rewrite:

1. define API contract reuse for teacher self-service data where mobile role support expands later
2. maintain parent/student stability while backend changes land
3. add lightweight contract verification tasks for existing mobile endpoints

## 7. QA workstream

1. API regression suite expansion:
   1. payroll permission matrix
   2. teacher self-service isolation
   3. salary history non-destructive behavior
2. web smoke tests:
   1. sidebar visibility by role
   2. HR routes access guards
   3. payroll and salary pages render/states
3. contract consistency checks for `meta.pagination`
4. release checklist verification for secrets, env and exports

## 8. DevOps workstream

1. keep API/Web/Mobile CI green during large module additions
2. validate DB migration idempotency and rollback notes
3. tune observability thresholds after payroll jobs introduced
4. update deployment runbook and prelaunch checks
5. maintain secret hygiene policies and environment validation scripts

## 9. Dependencies

1. canonical role/permission governance in `03_PERMISSION_GOVERNANCE.md`
2. naming and freeze constraints in `01_NAMING_STANDARD.md` and `12_PROJECT_FREEZE_SHEET.md`
3. staff convergence sequencing from `14_TEACHER_STAFF_CONVERGENCE_PLAN.md`
4. audit event policy from `05_UNIVERSAL_AUDIT_POLICY.md`
5. existing `people`, `institution`, `timetable`, and `discipline` route behavior

## 10. Key risks

1. legacy `teachers` FK dependencies can cause regressions if convergence is rushed
2. payroll data exposure risk if teacher self-service boundaries are not strictly enforced
3. DB migration complexity (history-preserving salary structures and adjustments)
4. response shape drift across newly added endpoints
5. frontend regression risk due to expanded role routing

Mitigations:

1. staged compatibility approach (no destructive teacher table removal)
2. strict route-level role and identity checks + dedicated tests
3. audit all payroll-sensitive writes and export actions
4. run backend tests + web lint/build + targeted web tests every phase

## 11. Definition of done by week

## Week 1 DoD

1. convergence closeout merged
2. roadmap and implementation notes updated
3. backend suite green

## Week 2 DoD

1. HR/payroll backend endpoints merged with tests
2. salary/payroll write operations audited
3. CI green

## Week 3 DoD

1. HR/payroll web pages merged and role-aware
2. teacher self-service pages functional and read-only where required
3. web tests/lint/build green

## Week 4 DoD

1. document integration hooks and release hardening complete
2. production readiness checklist updated
3. no open high-severity blockers for Roadmap V2 scope

## 12. Explicitly out of scope for this 4-week plan

1. full transport/hostel/library modules
2. AI feature experiments unrelated to operational workflows
3. complete multi-branch rollout (only planning and preparatory contracts in this window)
4. WhatsApp provider production integration
5. broad cosmetic redesign not tied to operational UX outcomes

---

## Execution order after this roadmap

1. Phase 2: teacher/staff convergence closeout
2. Phase 3: HR and payroll management (major stream)
3. Phase 4: document vault full expansion
4. Phase 5+: setup wizard, analytics depth, multi-branch, parity, release hardening
