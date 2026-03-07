# Agora Workspace

This folder is now the single source of truth for the Agora project.

## Structure

- `api/`: API contract and OpenAPI spec
- `database/`: PostgreSQL schema
- `agora-api/`: Node.js backend scaffold
- `agora-web/`: Teacher/Admin web app workspace
- `agora-mobile/`: Parent/Student mobile app workspace

## Current Phase

- Backend milestones through Step 25 completed (auth, modules, workers, tests, CI/CD, infra automation, SLO alerting)
- Web + mobile clients are active in parallel (`agora-web`, `agora-mobile`)
- Current focus: production rollout and frontend integration

## Quick Start (Backend)

```bash
cd /Users/admin/Desktop/Agora/agora-api
cp .env.example .env
npm install
npm run dev
```
