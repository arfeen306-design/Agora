# Agora Workspace

This folder is the single source of truth for the Agora project.

## Structure

- `api/`: API contract and OpenAPI spec
- `database/`: PostgreSQL schema and migrations
- `agora-api/`: Node.js backend (production entry point)
- `agora-web/`: Teacher/Admin web app (Next.js 14)
- `agora-mobile/`: Parent/Student mobile app (Flutter)
- `infra/`: Terraform infra modules
- `scripts/`: launch and smoke-check scripts

## Current Phase

- Phase 0 cleanup completed: Flask prototype removed, pino logger added, AI config prepared
- Backend milestones through Step 29 completed
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
cd agora-api
cp .env.example .env
npm install
npm run dev
```

## Launch Smoke Check

```bash
INTERNAL_API_KEY="<your-internal-key>" ./scripts/prelaunch-check.sh
```
