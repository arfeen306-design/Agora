# Agora Workspace

This folder is the single source of truth for the Agora project.

## Structure

- `api/`: API contract and OpenAPI spec
- `database/`: PostgreSQL schema and migrations
- `agora-api/`: Node.js backend
- `agora-web/`: Teacher/Admin web app
- `agora-mobile/`: Parent/Student mobile app
- `infra/`: Terraform infra modules
- `scripts/`: launch and smoke-check scripts

## Current Phase

- Backend milestones through Step 29 completed
- Step 27 polish: runtime secret-source visibility added to internal observability
- Step 28 UX polish: students/reports pages now use saved filters, lookup dropdowns, and improved table UX
- Step 29 launch readiness: `scripts/prelaunch-check.sh` added for pre-go-live validation

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

## Launch Smoke Check (Step 29)

```bash
cd /Users/admin/Desktop/Agora
INTERNAL_API_KEY="<your-internal-key>" ./scripts/prelaunch-check.sh
```
