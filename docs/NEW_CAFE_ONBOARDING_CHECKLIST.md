# New Café Onboarding Checklist

Use this checklist every time you add a new café.

## A) Add Café in the App
- [ ] Open app -> `Admin` -> `+ Add café`
- [ ] Fill:
  - Café name
  - Owner name
  - Owner email
  - Kitchen lead email
  - City
  - Holiday behaviour
  - Prep email time (`HH:MM`, 24-hour)
- [ ] Save

## B) Confirm New Café ID
- [ ] Run:

```bash
curl "https://menu-app-production-ebe9.up.railway.app/api/cafes"
```

- [ ] Note the new `id` (example: `14`)

## C) Create/Prepare the Google Sheet
- [ ] Ensure these tabs exist:
  - `Raw Data`
  - `Daily Log`
  - `Menu Items`
  - `Ingredients`
  - `Recipes`
- [ ] Confirm minimum columns:
  - `Raw Data`: `date`, `item_name`, `quantity`
  - `Daily Log`: `date`, `waste_items`, `waste_value`, `items_86d`, `actual_covers`, `notes`
  - `Menu Items`: `name`, `category`, `price`, `active`
  - `Ingredients`: `name`, `unit`, `par_level`, `shelf_life_days`, `cost_per_unit`
  - `Recipes`: `item_name`, `ingredient_name`, `qty_per_portion`, `station`

## D) Connect Script to This Café
- [ ] Open Google Sheet -> `Extensions` -> `Apps Script`
- [ ] In script constants, set:

```javascript
const API_BASE = 'https://menu-app-production-ebe9.up.railway.app/api';
const CAFE_ID = 14; // replace with new cafe id
```

- [ ] Save script

## E) First Sync
- [ ] Run function:

```javascript
syncPrepCastAll()
```

- [ ] Approve permissions if prompted
- [ ] Confirm logs show successful sync

## F) Verify Data in API
- [ ] Run:

```bash
curl "https://menu-app-production-ebe9.up.railway.app/api/cafes/14/items"
curl "https://menu-app-production-ebe9.up.railway.app/api/cafes/14/ingredients"
curl "https://menu-app-production-ebe9.up.railway.app/api/cafes/14/recipes"
curl "https://menu-app-production-ebe9.up.railway.app/api/cafes/14/forecast?date=2026-04-04"
```

- [ ] Confirm arrays are populated and forecast returns non-empty prep list

## G) Run Manual Prep Test for New Café
- [ ] Run with token:

```bash
TOKEN='your_prep_run_token'

curl -X POST "https://menu-app-production-ebe9.up.railway.app/api/admin/run-prep-now" \
  -H "x-prep-run-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cafeIds":[14],"force":true}'
```

- [ ] Confirm response status is `sent`
- [ ] Confirm prep email arrives

## H) Turn On Ongoing Sync
- [ ] In Apps Script -> `Triggers`
- [ ] Add trigger for `syncPrepCastAll` (daily cadence)
- [ ] Keep run before prep send time

---

## Quick Edit/Delete Operations

### Make changes to a café (partial update)

```bash
curl -X PATCH "https://menu-app-production-ebe9.up.railway.app/api/cafes/14" \
  -H "Content-Type: application/json" \
  -d '{
    "owner_name":"New Owner",
    "kitchen_lead_email":"kitchen@newcafe.com",
    "prep_send_time":"05:45",
    "holiday_behaviour":"Manual"
  }'
```

### Soft delete (recommended first; can be re-enabled later)

```bash
curl -X DELETE "https://menu-app-production-ebe9.up.railway.app/api/cafes/14"
```

### Hard delete (permanent, cascades related records)

```bash
DELETE_TOKEN='your_admin_delete_or_prep_run_token'

curl -X DELETE "https://menu-app-production-ebe9.up.railway.app/api/cafes/14?mode=hard" \
  -H "x-admin-delete-token: $DELETE_TOKEN"
```
