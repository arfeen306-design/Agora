# Step 4 Setup Plan (Agora)

## 1. Install Prerequisites

- Node.js 20+ (for `agora-api` and `agora-web`)
- npm 10+
- Docker Desktop (for PostgreSQL container)
- Flutter SDK (for `agora-mobile`)

## 2. Start PostgreSQL

```bash
cd /Users/admin/Desktop/Agora
docker compose up -d
```

## 3. Initialize Database

```bash
psql -h 127.0.0.1 -U agora_user -d agora -f /Users/admin/Desktop/Agora/database/agora_schema.sql
```

## 4. Start Backend

```bash
cd /Users/admin/Desktop/Agora/agora-api
cp .env.example .env
npm install
npm run dev
```

## 5. Scaffold Frontends

Web (Next.js):

```bash
cd /Users/admin/Desktop/Agora
npx create-next-app@latest agora-web --typescript --eslint --app --src-dir --tailwind --import-alias "@/*"
```

Mobile (Flutter):

```bash
cd /Users/admin/Desktop/Agora
flutter create agora-mobile
```
