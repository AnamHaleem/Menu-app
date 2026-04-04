# Menu App — End-to-End Handover Guide

Updated: April 4, 2026

## 1) What This Project Is

Menu is a café operations app with:
- Backend API on Railway (Node + Express + Postgres)
- Frontend on Vercel (React + Vite)
- Daily prep forecasting, kitchen prep list, admin management, and KPI dashboard
- Google Sheets ingestion path for transactions, daily logs, and catalog data (items, ingredients, recipes)

## 2) Current Architecture

### Backend
- Location: `backend/`
- Runtime: Node.js + Express
- Database: PostgreSQL (Railway)
- Key modules:
  - API routes: `/Users/AnamHaleem/Downloads/menu-app/backend/src/routes/api.js`
  - Server/bootstrap/CORS: `/Users/AnamHaleem/Downloads/menu-app/backend/src/index.js`
  - DB config resolver: `/Users/AnamHaleem/Downloads/menu-app/backend/src/db/dbConfig.js`
  - Migrations: `/Users/AnamHaleem/Downloads/menu-app/backend/src/db/migrate.js`
  - Seed: `/Users/AnamHaleem/Downloads/menu-app/backend/src/db/seed.js`

### Frontend
- Location: `frontend/`
- Runtime: Vite + React
- Routing: `HashRouter` (avoids Vercel direct-route 404s for `/admin`, `/dashboard`, etc.)
- Key modules:
  - App shell/router: `/Users/AnamHaleem/Downloads/menu-app/frontend/src/App.jsx`
  - API client: `/Users/AnamHaleem/Downloads/menu-app/frontend/src/lib/api.js`
  - Admin panel: `/Users/AnamHaleem/Downloads/menu-app/frontend/src/components/admin/AdminPanel.jsx`
  - Dashboard: `/Users/AnamHaleem/Downloads/menu-app/frontend/src/components/dashboard/OwnerDashboard.jsx`

## 3) Major Fixes Completed

## Deployment & Runtime
- Monorepo deployment stabilized on Railway.
- Backend starts reliably and listens on Railway `PORT`.
- Runtime migration + seed command executes at startup.

## Database Stability
- Added robust DB env resolution logic in `dbConfig.js` (`DATABASE_URL` first, PG parts fallback).
- Added unique index support for daily log upserts:
  - `idx_daily_logs_cafe_date` on `(cafe_id, date)`
- Fixed `ON CONFLICT` error in daily log writes.

## Auth/Email
- Clerk backend integration fixed to use `@clerk/express`.
- Resend key boot crash resolved (`RESEND_API_KEY` required).
- Guest mode support for frontend when Clerk publishable key is absent.

## CORS
- Backend now supports:
  - exact allowed origins from `FRONTEND_URL`
  - optional Vercel preview domains with `ALLOW_VERCEL_PREVIEWS=true`
- Logging added for allowed origins and blocked origins.

## Frontend Reliability
- Route 404 issue fixed with `HashRouter`.
- `.map is not a function` crash resolved by normalizing API list responses.
- Café selection now persists in local storage and syncs between Admin and Dashboard.

## AI-Enhanced Forecasting + Automation
- Added AI decision service:
  - `/Users/AnamHaleem/Downloads/menu-app/backend/src/services/aiDecisionService.js`
- Forecast generation now applies AI multipliers when `OPENAI_API_KEY` is present:
  - `/Users/AnamHaleem/Downloads/menu-app/backend/src/services/forecastService.js`
- 6:00 AM scheduler now logs AI application per café:
- Prep scheduler now runs every minute and dispatches when each café's `prep_send_time` matches current time:
  - `/Users/AnamHaleem/Downloads/menu-app/backend/src/services/schedulerService.js`
- Prep emails now show when AI decision layer was applied:
  - `/Users/AnamHaleem/Downloads/menu-app/backend/src/services/emailService.js`
- Added protected manual trigger endpoint for instant all-café test runs:
  - `POST /api/admin/run-prep-now`

## Metrics 500 Fix
- Fixed invalid SQL in metrics baseline query (uses subquery for first 7 rows before averaging).

## 4) Environment Variables

### Railway (Backend Service)
Set in Railway -> Backend Service -> Variables:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `NODE_ENV=production`
- `FRONTEND_URL=https://menu-app-plum-delta.vercel.app`
- `ALLOW_VERCEL_PREVIEWS=true` (optional but recommended)
- `RESEND_API_KEY=...`
- `OPENWEATHER_API_KEY=...`
- `CLERK_SECRET_KEY=...` (optional unless enforcing auth)
- `OPENAI_API_KEY=...` (required for AI decision layer)
- `OPENAI_MODEL=gpt-4.1-mini` (optional)
- `ENABLE_AI_DECISIONS=true` (optional, default true)
- `PREP_TIMEZONE=America/Toronto` (optional; controls scheduler timezone)
- `PREP_RUN_TOKEN=strong-secret-token` (required for protected manual run endpoint)

Notes:
- `DATABASE_URL` variable name must be exact.
- If `CLERK_SECRET_KEY` is not set, backend logs warning and runs without Clerk middleware.

### Vercel (Frontend Project)
Set in Vercel -> Project -> Settings -> Environment Variables:

- `VITE_API_URL=https://menu-app-production-ebe9.up.railway.app`
- `VITE_CLERK_PUBLISHABLE_KEY=...` (optional; app works in Guest Mode without it)

Important:
- `VITE_API_URL` should include `https://`.
- App client automatically appends `/api` if not present.

## 5) Database: Current Key Tables

- `cafes`
- `items`
- `ingredients`
- `recipes`
- `transactions`
- `daily_logs`
- `prep_lists`
- `holidays`
- `weather_logs`
- `prep_dispatch_logs`

`cafes` now includes:
- `prep_send_time` (`HH:MM`, 24-hour, default `06:00`)

## 6) API Endpoints In Use

### Core CRUD
- `GET /api/cafes`
- `POST /api/cafes`
- `PATCH /api/cafes/:id/prep-time`
- `GET /api/cafes/:cafeId/items`
- `POST /api/cafes/:cafeId/items`
- `GET /api/cafes/:cafeId/ingredients`
- `POST /api/cafes/:cafeId/ingredients`
- `GET /api/cafes/:cafeId/recipes`
- `POST /api/cafes/:cafeId/recipes`

### Data Ingestion
- `POST /api/cafes/:cafeId/transactions/bulk`
- `POST /api/cafes/:cafeId/logs`
- `POST /api/cafes/:cafeId/catalog/sync`

`catalog/sync` is the new bulk endpoint for:
- items
- ingredients
- recipes

It is idempotent by name matching (case-insensitive), and recreates recipes each sync.

### Operations
- `GET /api/cafes/:cafeId/forecast`
- `POST /api/cafes/:cafeId/forecast/generate`
- `GET /api/cafes/:cafeId/prep-list`
- `PATCH /api/cafes/:cafeId/prep-list/:prepId`
- `GET /api/cafes/:cafeId/metrics`
- `POST /api/cafes/:cafeId/send-prep-list`
- `POST /api/admin/run-prep-now` (protected by `PREP_RUN_TOKEN`)
- `GET /api/weather`
- `GET /health`

Manual run request shape:

```json
{
  "cafeIds": [1, 13],
  "date": "2026-04-04",
  "force": true
}
```

Auth header:

`Authorization: Bearer <PREP_RUN_TOKEN>`

## 7) Google Sheets -> App Sync (Transactions, Logs, Catalog)

Use this approach when your workbook includes:
- `Raw Data`
- `Daily Log`
- `Menu Items`
- `Ingredients`
- `Recipes`

Create an Apps Script under the Google Sheet and run `syncPrepCastAll()`.

```javascript
const API_BASE = 'https://menu-app-production-ebe9.up.railway.app/api';
const CAFE_ID = 1; // change if needed

function syncPrepCastAll() {
  syncCatalog();
  syncTransactions();
  syncDailyLogs();
}

function syncCatalog() {
  const items = readSheetObjects('Menu Items').map(normalizeItem).filter(Boolean);
  const ingredients = readSheetObjects('Ingredients').map(normalizeIngredient).filter(Boolean);
  const recipes = readSheetObjects('Recipes').map(normalizeRecipe).filter(Boolean);

  const result = postJson(`/cafes/${CAFE_ID}/catalog/sync`, {
    items,
    ingredients,
    recipes,
    deactivateMissingItems: true
  });

  Logger.log(JSON.stringify(result, null, 2));
}

function syncTransactions() {
  const rows = readSheetObjects('Raw Data');
  const transactions = rows.map(r => ({
    date: normalizeDate(pick(r, ['date'])),
    item_name: pick(r, ['item_name', 'item', 'name']),
    quantity: toNumber(pick(r, ['quantity', 'qty'])) || 0,
    revenue: toNumber(pick(r, ['revenue', 'sales', 'revenue_$'])) || 0,
    order_type: pick(r, ['order_type']) || 'Dine-in',
    daypart: pick(r, ['daypart']) || 'Morning'
  })).filter(t => t.date && t.item_name && t.quantity > 0);

  const result = postJson(`/cafes/${CAFE_ID}/transactions/bulk`, { transactions });
  Logger.log(JSON.stringify(result, null, 2));
}

function syncDailyLogs() {
  const rows = readSheetObjects('Daily Log');
  rows.forEach(r => {
    const payload = {
      date: normalizeDate(pick(r, ['date'])),
      waste_items: toNumber(pick(r, ['waste_items'])) || 0,
      waste_value: toNumber(pick(r, ['waste_value', 'waste_value_$'])) || 0,
      items_86d: toNumber(pick(r, ['items_86d'])) || 0,
      actual_covers: toNumber(pick(r, ['actual_covers'])) || 0,
      notes: pick(r, ['notes']) || ''
    };
    if (!payload.date) return;
    postJson(`/cafes/${CAFE_ID}/logs`, payload);
  });
  Logger.log('Daily logs synced');
}

function normalizeItem(r) {
  const name = pick(r, ['name', 'item_name', 'item']);
  if (!name) return null;
  return {
    name,
    category: pick(r, ['category']) || 'Beverage',
    price: toNumber(pick(r, ['price'])) || 0,
    active: toBooleanOrDefaultTrue(pick(r, ['active']))
  };
}

function normalizeIngredient(r) {
  const name = pick(r, ['name', 'ingredient_name', 'ingredient']);
  if (!name) return null;
  return {
    name,
    unit: pick(r, ['unit']) || '',
    par_level: toNumber(pick(r, ['par_level'])) || 0,
    shelf_life_days: toNumber(pick(r, ['shelf_life_days'])) || 7,
    cost_per_unit: toNumber(pick(r, ['cost_per_unit'])) || 0
  };
}

function normalizeRecipe(r) {
  const itemName = pick(r, ['item_name', 'item']);
  const ingredientName = pick(r, ['ingredient_name', 'ingredient']);
  const qty = toNumber(pick(r, ['qty_per_portion', 'qty', 'quantity']));
  if (!itemName || !ingredientName || !qty) return null;
  return {
    item_name: itemName,
    ingredient_name: ingredientName,
    qty_per_portion: qty,
    station: pick(r, ['station']) || 'General'
  };
}

function readSheetObjects(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => String(h).trim().toLowerCase());
  return values.slice(1)
    .filter(row => row.some(cell => String(cell).trim() !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj[String(k).toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBooleanOrDefaultTrue(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return true;
  return ['true', '1', 'yes', 'y'].includes(s);
}

function normalizeDate(value) {
  if (!value) return '';
  const tz = Session.getScriptTimeZone();
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  const parsed = new Date(value);
  if (isNaN(parsed)) return '';
  return Utilities.formatDate(parsed, tz, 'yyyy-MM-dd');
}

function postJson(path, payload) {
  const res = UrlFetchApp.fetch(`${API_BASE}${path}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`POST ${path} failed (${code}): ${body}`);
  }
  return body ? JSON.parse(body) : {};
}
```

## 8) Verification Checklist

### Backend
- Health: `GET /health` returns `{ status: "ok" }`
- Metrics: `GET /api/cafes/1/metrics` returns JSON (not 500)
- Logs should contain:
  - `Database config source: ...`
  - `Menu API running on port ...`
  - `Migration completed successfully`
  - `Seed completed successfully ...`

### Database Quick Queries

```sql
SELECT COUNT(*) AS cafes_count FROM cafes;
SELECT COUNT(*) AS tx_count FROM transactions;
SELECT COUNT(*) AS logs_count FROM daily_logs;
SELECT COUNT(*) AS items_count FROM items;
SELECT COUNT(*) AS ingredients_count FROM ingredients;
SELECT COUNT(*) AS recipes_count FROM recipes;
```

### Frontend
- Dashboard loads with no console 500 errors
- Admin tab loads with list of cafés
- Menu/Ingredients/Recipes tabs show records after catalog sync

## 9) Troubleshooting Playbook

### A) `No database configuration found`
Cause: backend service missing `DATABASE_URL`.
Fix:
- Add `DATABASE_URL=${{Postgres.DATABASE_URL}}` in Railway backend variables.
- Restart backend.

### B) `Could not add cafe. Check backend FRONTEND_URL`
Cause: CORS mismatch.
Fix:
- Set `FRONTEND_URL` to exact Vercel domain.
- Optionally set `ALLOW_VERCEL_PREVIEWS=true`.
- Restart backend.

### C) Blank UI + console 500 on `/metrics`
Cause: metrics query bug (already fixed in current code).
Fix:
- Ensure latest backend deploy includes updated `api.js`.

### D) Admin route returns Vercel 404
Cause: direct route handling issue.
Fix:
- Use hash routing (`#`) build already in place.

### E) Dashboard shows empty while DB has data
Likely causes:
- Wrong café selected
- Data date range outside last 30/42 days
Fix:
- Clear selected cafe cache in browser console:
  - `localStorage.removeItem('menu.selectedCafeId')`
- Hard refresh browser (`Cmd + Shift + R`)

### F) Manual prep run endpoint returns `401 Unauthorized`
Cause: missing or wrong `PREP_RUN_TOKEN`.
Fix:
- Set `PREP_RUN_TOKEN` in Railway backend variables.
- Use `Authorization: Bearer <PREP_RUN_TOKEN>` when calling `/api/admin/run-prep-now`.

## 10) Important Operational Notes

- Keys exposed during setup should be rotated:
  - GitHub token
  - Resend key
  - OpenWeather key
  - Clerk secret/publishable keys
- Current startup runs `db:migrate` and `db:seed` every container boot.
  - Good for fast MVP setup
  - For production hardening, move seed to one-time/manual operation.

## 11) Recommended Next Steps

1. Add a dedicated “Sync from Google Sheets” button in Admin (calls backend sync endpoints).
2. Add basic auth gates for Admin write actions.
3. Add dedupe/uniqueness constraints for catalog tables by `(cafe_id, name)` to prevent accidental duplicates.
4. Split seed into “demo seed” and “prod-safe seed”.
5. Add smoke test endpoint checks in CI before deploy.
