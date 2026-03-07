# Agora Workspace

This folder is now the single source of truth for the Agora project.

## Structure

- `api/`: API contract and OpenAPI spec
- `database/`: PostgreSQL schema
- `agora-api/`: Node.js backend scaffold
- `agora-web/`: Teacher/Admin web app workspace
- `agora-mobile/`: Parent/Student mobile app workspace

## Current Phase

- Step 2 completed: database schema
- Step 3 completed: API contract + OpenAPI YAML
- Step 4 started: workspace/repo setup

## Quick Start (Backend)

```bash
cd /Users/admin/Desktop/Agora/agora-api
cp .env.example .env
npm install
npm run dev
```
