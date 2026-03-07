# Agora Workspace

This folder is now the single source of truth for the Agora project.

## Structure

- `api/`: API contract and OpenAPI spec
- `database/`: PostgreSQL schema
- `agora-api/`: Node.js backend scaffold
- `agora-web/`: Teacher/Admin web app workspace
- `agora-mobile/`: Parent/Student mobile app workspace

## Current Phase

- Backend milestones through Step 28 completed (auth, modules, workers, tests, CI/CD, infra automation, SLO alerting, secrets-runtime wiring, CloudWatch worker metrics)
- Web + mobile clients are active in parallel (`agora-web`, `agora-mobile`)
- Current focus: production rollout and frontend integration

## CI Workflows

- Backend API CI: `.github/workflows/api-ci.yml`
- Backend Release pipeline: `.github/workflows/api-release.yml`
- DR backup/restore drill: `.github/workflows/dr-backup-drill.yml`
- Infra validation: `.github/workflows/infra-validate.yml`
- Web dashboard CI: `.github/workflows/web-ci.yml`
- Mobile app CI: `.github/workflows/mobile-ci.yml`

## Quick Start (Backend)

```bash
cd /Users/admin/Desktop/Agora/agora-api
cp .env.example .env
npm install
npm run dev
```
