# Menu — Café Operations Intelligence

Daily prep list system for independent cafés. Weather-aware, holiday-aware, Square-ready.

---

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (local or Railway)

---

## Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file (already created — update DATABASE_URL for your database):

```
PORT=3001
DATABASE_URL=postgresql://postgres:password@localhost:5432/menu_db
CLERK_SECRET_KEY=sk_test_...
OPENWEATHER_API_KEY=...
RESEND_API_KEY=re_...
NODE_ENV=development
```

Run database migration and seed:

```bash
npm run db:migrate
npm run db:seed
```

Start the backend:

```bash
npm run dev
```

API runs at http://localhost:3001

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

App runs at http://localhost:3000

---

## Deploy to Railway

### Backend

1. Go to railway.app and create a new project
2. Click New Service then GitHub Repo
3. Select your repo and set the root directory to /backend
4. Add a PostgreSQL database service to the same project
5. Set environment variables in Railway dashboard:
   - DATABASE_URL (Railway auto-fills this from the Postgres service)
   - CLERK_SECRET_KEY
   - OPENWEATHER_API_KEY
   - RESEND_API_KEY
   - NODE_ENV=production
6. Deploy — Railway runs npm install and node src/index.js automatically

After first deploy, run migrations:
- Open Railway dashboard, click your backend service
- Go to Settings then click Deploy then Run Command
- Run: node src/db/migrate.js
- Then: node src/db/seed.js

### Frontend

1. Create another new service in the same Railway project
2. Set root directory to /frontend
3. Set build command: npm run build
4. Set start command: npx serve dist
5. Set environment variable:
   - VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
   - VITE_API_URL=https://your-backend.railway.app/api
6. Deploy

---

## Mobile (Capacitor)

After the web app is working:

```bash
cd frontend
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init Menu com.menu.app
npm run build
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios    # opens Xcode
npx cap open android  # opens Android Studio
```

---

## Architecture

```
Square POS → Make → PostgreSQL → Node.js API → React Frontend
                                      ↓
                              node-cron scheduler
                                      ↓
                           6am prep list email (Resend)
                           9pm check-in reminder (Resend)
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/cafes | List all cafés |
| POST | /api/cafes | Create café |
| GET | /api/cafes/:id/forecast | Get today's forecast |
| POST | /api/cafes/:id/forecast/generate | Generate and save prep list |
| GET | /api/cafes/:id/prep-list | Get today's prep list |
| PATCH | /api/cafes/:id/prep-list/:prepId | Toggle item completed |
| GET | /api/cafes/:id/metrics | Get performance metrics |
| POST | /api/cafes/:id/logs | Log daily waste/86 data |
| POST | /api/cafes/:id/send-prep-list | Manually send prep list email |
| GET | /api/weather | Get current Toronto weather |

---

## Three Views

**Dashboard** (/dashboard) — Owner view. Savings metrics, waste charts, 86 incident tracking, daily log entry.

**Kitchen** (/kitchen) — Kitchen lead view. Today's prep list grouped by station. Large tap targets, progress bar, checkboxes.

**Admin** (/admin) — Operator view. All cafés, metrics per café, menu/ingredient/recipe management, add new cafés.
