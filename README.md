# Menu — Cafe Operations Intelligence

Daily prep list system for independent cafes. Weather-aware, holiday-aware, and API-first.

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL (local or Railway)

## Backend Setup

```bash
cd backend
npm install
cp .env.example .env
```

Set at least:
- `DATABASE_URL`
- `RESEND_API_KEY`
- `OPENWEATHER_API_KEY`

Run DB setup and start:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Backend runs at `http://localhost:3001`.

## Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend runs at `http://localhost:3000`.

Required variable:
- `VITE_API_URL` (can be base URL or `/api` URL)

Optional:
- `VITE_CLERK_PUBLISHABLE_KEY` (if omitted, app runs in Guest Mode)

## Deploy Backend (Railway)

1. Deploy `backend` service from GitHub.
2. Add PostgreSQL in same Railway project.
3. In backend service variables, set:
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `NODE_ENV=production`
- `FRONTEND_URL=https://your-frontend.vercel.app`
- `RESEND_API_KEY=...`
- `OPENWEATHER_API_KEY=...`
- `CLERK_SECRET_KEY=...` (optional if using auth)

Backend will run migrations and seed on startup.

## Deploy Frontend (Vercel)

1. Import GitHub repo in Vercel.
2. Set Root Directory to `frontend`.
3. Add environment variables:
- `VITE_API_URL=https://your-backend.railway.app`
- `VITE_CLERK_PUBLISHABLE_KEY=...` (optional)
4. Deploy.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/cafes | List all cafes |
| POST | /api/cafes | Create cafe |
| GET | /api/cafes/:id/forecast | Get daily forecast |
| POST | /api/cafes/:id/forecast/generate | Generate and save prep list |
| GET | /api/cafes/:id/prep-list | Get prep list |
| PATCH | /api/cafes/:id/prep-list/:prepId | Toggle prep item complete |
| GET | /api/cafes/:id/metrics | Get dashboard metrics |
| POST | /api/cafes/:id/logs | Save daily waste/stockout log |
| POST | /api/cafes/:id/send-prep-list | Send prep list email |
| GET | /api/weather | Get weather |

## Views

- `/dashboard` — owner metrics, trends, and savings
- `/kitchen` — daily prep checklist by station
- `/admin` — cafe, menu, ingredient, and recipe management
