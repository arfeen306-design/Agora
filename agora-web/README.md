# Agora Web Dashboard

Teacher + Admin dashboard for the Agora School Management Platform.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **API:** Connects to agora-api backend

## Setup

```bash
cd agora-web
npm install
npm run dev
```

Dashboard runs on `http://localhost:3000`

## Environment

Create `.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api/v1
```

## Pages

| Route | Description | Access |
|-------|-------------|--------|
| `/login` | Login with school code + email + password | Public |
| `/dashboard` | Overview with stats & quick actions | Admin, Teacher |
| `/dashboard/attendance` | View & mark attendance (bulk) | Admin, Teacher |
| `/dashboard/homework` | Create & manage homework | Admin, Teacher |
| `/dashboard/marks` | Assessments & score entry | Admin, Teacher |
| `/dashboard/students` | Student lookup (attendance & marks) | Admin |
| `/dashboard/messaging` | Real-time chat conversations | Admin, Teacher |
| `/dashboard/fees` | Fee plans, invoices, payments | Admin |
| `/dashboard/events` | School events calendar | Admin, Teacher |

## Demo Credentials

- **School Code:** agora_demo
- **Admin:** admin@agora.com / admin123
- **Teacher:** teacher1@agora.com / teach123
