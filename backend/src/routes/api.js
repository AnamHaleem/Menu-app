const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const forecastService = require('../services/forecastService');
const weatherService = require('../services/weatherService');
const emailService = require('../services/emailService');
const schedulerService = require('../services/schedulerService');

const toKey = (value) => String(value || '').trim().toLowerCase();
const toNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const PREP_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isValidPrepTime = (value) => PREP_TIME_PATTERN.test(String(value || '').trim());
const extractBearerToken = (authHeader = '') => {
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

// ─── CAFES ────────────────────────────────────────────────────────────────────
router.get('/cafes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cafes ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cafes/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cafes WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Cafe not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes', async (req, res) => {
  const {
    name,
    owner_name,
    email,
    city,
    holiday_behaviour,
    kitchen_lead_email,
    prep_send_time
  } = req.body;
  try {
    const prepSendTime = prep_send_time || '06:00';
    if (!isValidPrepTime(prepSendTime)) {
      return res.status(400).json({ error: 'prep_send_time must be in HH:MM (24-hour) format' });
    }

    const result = await pool.query(`
      INSERT INTO cafes (name, owner_name, email, city, holiday_behaviour, kitchen_lead_email, prep_send_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [name, owner_name, email, city || 'Toronto', holiday_behaviour || 'Manual', kitchen_lead_email, prepSendTime]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/cafes/:id', async (req, res) => {
  const {
    name,
    owner_name,
    email,
    city,
    holiday_behaviour,
    kitchen_lead_email,
    active,
    prep_send_time
  } = req.body;
  try {
    const prepSendTime = prep_send_time || '06:00';
    if (!isValidPrepTime(prepSendTime)) {
      return res.status(400).json({ error: 'prep_send_time must be in HH:MM (24-hour) format' });
    }

    const result = await pool.query(`
      UPDATE cafes
      SET name=$1,
          owner_name=$2,
          email=$3,
          city=$4,
          holiday_behaviour=$5,
          kitchen_lead_email=$6,
          active=$7,
          prep_send_time=$8
      WHERE id=$9
      RETURNING *
    `, [name, owner_name, email, city, holiday_behaviour, kitchen_lead_email, active, prepSendTime, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/cafes/:id', async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM cafes WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Cafe not found' });
    }

    const current = existing.rows[0];
    const patch = req.body || {};

    const next = {
      name: patch.name ?? current.name,
      owner_name: patch.owner_name ?? current.owner_name,
      email: patch.email ?? current.email,
      city: patch.city ?? current.city,
      holiday_behaviour: patch.holiday_behaviour ?? current.holiday_behaviour,
      kitchen_lead_email: patch.kitchen_lead_email ?? current.kitchen_lead_email,
      active: patch.active ?? current.active,
      prep_send_time: patch.prep_send_time ?? current.prep_send_time ?? '06:00'
    };

    if (!isValidPrepTime(next.prep_send_time)) {
      return res.status(400).json({ error: 'prep_send_time must be in HH:MM (24-hour) format' });
    }

    const updated = await pool.query(`
      UPDATE cafes
      SET name=$1,
          owner_name=$2,
          email=$3,
          city=$4,
          holiday_behaviour=$5,
          kitchen_lead_email=$6,
          active=$7,
          prep_send_time=$8
      WHERE id=$9
      RETURNING *
    `, [
      next.name,
      next.owner_name,
      next.email,
      next.city,
      next.holiday_behaviour,
      next.kitchen_lead_email,
      next.active,
      next.prep_send_time,
      req.params.id
    ]);

    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/cafes/:id', async (req, res) => {
  const mode = String(req.query.mode || 'soft').trim().toLowerCase();

  try {
    if (mode === 'hard') {
      const expectedToken = String(process.env.ADMIN_DELETE_TOKEN || process.env.PREP_RUN_TOKEN || '').trim();
      if (!expectedToken) {
        return res.status(503).json({
          error: 'ADMIN_DELETE_TOKEN (or PREP_RUN_TOKEN) is not configured on server'
        });
      }

      const bearer = extractBearerToken(req.headers.authorization || '');
      const headerToken = String(req.headers['x-admin-delete-token'] || req.headers['x-prep-run-token'] || '').trim();
      const providedToken = bearer || headerToken;

      if (!providedToken || providedToken !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const deleted = await pool.query('DELETE FROM cafes WHERE id = $1 RETURNING *', [req.params.id]);
      if (!deleted.rows.length) {
        return res.status(404).json({ error: 'Cafe not found' });
      }

      return res.json({
        deleted: true,
        mode: 'hard',
        cafe: deleted.rows[0]
      });
    }

    const softDeleted = await pool.query(
      'UPDATE cafes SET active = false WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (!softDeleted.rows.length) {
      return res.status(404).json({ error: 'Cafe not found' });
    }

    res.json({
      deleted: true,
      mode: 'soft',
      cafe: softDeleted.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/cafes/:id/prep-time', async (req, res) => {
  const { prep_send_time } = req.body || {};

  if (!isValidPrepTime(prep_send_time)) {
    return res.status(400).json({ error: 'prep_send_time must be in HH:MM (24-hour) format' });
  }

  try {
    const result = await pool.query(
      'UPDATE cafes SET prep_send_time = $1 WHERE id = $2 RETURNING *',
      [prep_send_time, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Cafe not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ITEMS ────────────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items WHERE cafe_id = $1 ORDER BY category, name', [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/items', async (req, res) => {
  const { name, category, price } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO items (cafe_id, name, category, price) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.cafeId, name, category, price]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/cafes/:cafeId/items/:id', async (req, res) => {
  const { name, category, price, active } = req.body;
  try {
    const result = await pool.query(
      'UPDATE items SET name=$1, category=$2, price=$3, active=$4 WHERE id=$5 AND cafe_id=$6 RETURNING *',
      [name, category, price, active, req.params.id, req.params.cafeId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INGREDIENTS ──────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/ingredients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ingredients WHERE cafe_id = $1 ORDER BY name', [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/ingredients', async (req, res) => {
  const { name, unit, par_level, shelf_life_days, cost_per_unit } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO ingredients (cafe_id, name, unit, par_level, shelf_life_days, cost_per_unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.cafeId, name, unit, par_level || 0, shelf_life_days || 7, cost_per_unit || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RECIPES ─────────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/recipes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, i.name as item_name, ing.name as ingredient_name, ing.unit
      FROM recipes r
      JOIN items i ON r.item_id = i.id
      JOIN ingredients ing ON r.ingredient_id = ing.id
      WHERE r.cafe_id = $1
      ORDER BY i.name, ing.name
    `, [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/recipes', async (req, res) => {
  const { item_id, ingredient_id, qty_per_portion, station } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO recipes (cafe_id, item_id, ingredient_id, qty_per_portion, station) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.cafeId, item_id, ingredient_id, qty_per_portion, station]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CATALOG SYNC (ITEMS + INGREDIENTS + RECIPES) ────────────────────────────
router.post('/cafes/:cafeId/catalog/sync', async (req, res) => {
  const cafeId = parseInt(req.params.cafeId, 10);
  const {
    items = [],
    ingredients = [],
    recipes = [],
    deactivateMissingItems = true
  } = req.body || {};

  if (Number.isNaN(cafeId)) {
    return res.status(400).json({ error: 'Invalid cafe ID' });
  }

  if (!Array.isArray(items) || !Array.isArray(ingredients) || !Array.isArray(recipes)) {
    return res.status(400).json({ error: 'items, ingredients, and recipes must be arrays' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingItemsResult = await client.query(
      'SELECT id, name FROM items WHERE cafe_id = $1',
      [cafeId]
    );
    const itemByKey = new Map(existingItemsResult.rows.map(row => [toKey(row.name), row]));
    const seenItemKeys = new Set();
    const itemIdByKey = new Map();

    let itemsInserted = 0;
    let itemsUpdated = 0;
    let itemsDeactivated = 0;

    for (const raw of items) {
      const name = String(raw?.name || raw?.item_name || '').trim();
      if (!name) continue;

      const key = toKey(name);
      seenItemKeys.add(key);
      const category = String(raw?.category || 'Beverage').trim() || 'Beverage';
      const price = toNumberOrNull(raw?.price);
      const active = raw?.active === false ? false : true;

      if (itemByKey.has(key)) {
        const existing = itemByKey.get(key);
        const updated = await client.query(`
          UPDATE items
          SET name = $1, category = $2, price = $3, active = $4
          WHERE id = $5 AND cafe_id = $6
          RETURNING id, name
        `, [name, category, price, active, existing.id, cafeId]);
        itemIdByKey.set(key, updated.rows[0].id);
        itemsUpdated += 1;
      } else {
        const inserted = await client.query(`
          INSERT INTO items (cafe_id, name, category, price, active)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name
        `, [cafeId, name, category, price, active]);
        itemIdByKey.set(key, inserted.rows[0].id);
        itemsInserted += 1;
      }
    }

    if (deactivateMissingItems && items.length > 0) {
      for (const row of existingItemsResult.rows) {
        if (!seenItemKeys.has(toKey(row.name))) {
          await client.query(
            'UPDATE items SET active = false WHERE id = $1 AND cafe_id = $2',
            [row.id, cafeId]
          );
          itemsDeactivated += 1;
        }
      }
    }

    const existingIngredientsResult = await client.query(
      'SELECT id, name FROM ingredients WHERE cafe_id = $1',
      [cafeId]
    );
    const ingredientByKey = new Map(existingIngredientsResult.rows.map(row => [toKey(row.name), row]));
    const ingredientIdByKey = new Map();

    let ingredientsInserted = 0;
    let ingredientsUpdated = 0;

    for (const raw of ingredients) {
      const name = String(raw?.name || raw?.ingredient_name || '').trim();
      if (!name) continue;

      const key = toKey(name);
      const unit = String(raw?.unit || '').trim() || null;
      const parLevel = toNumberOrNull(raw?.par_level) ?? 0;
      const shelfLife = parseInt(raw?.shelf_life_days, 10);
      const shelfLifeDays = Number.isNaN(shelfLife) ? 7 : shelfLife;
      const costPerUnit = toNumberOrNull(raw?.cost_per_unit) ?? 0;

      if (ingredientByKey.has(key)) {
        const existing = ingredientByKey.get(key);
        const updated = await client.query(`
          UPDATE ingredients
          SET name = $1, unit = $2, par_level = $3, shelf_life_days = $4, cost_per_unit = $5
          WHERE id = $6 AND cafe_id = $7
          RETURNING id, name
        `, [name, unit, parLevel, shelfLifeDays, costPerUnit, existing.id, cafeId]);
        ingredientIdByKey.set(key, updated.rows[0].id);
        ingredientsUpdated += 1;
      } else {
        const inserted = await client.query(`
          INSERT INTO ingredients (cafe_id, name, unit, par_level, shelf_life_days, cost_per_unit)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, name
        `, [cafeId, name, unit, parLevel, shelfLifeDays, costPerUnit]);
        ingredientIdByKey.set(key, inserted.rows[0].id);
        ingredientsInserted += 1;
      }
    }

    const allItemsForCafe = await client.query(
      'SELECT id, name FROM items WHERE cafe_id = $1',
      [cafeId]
    );
    allItemsForCafe.rows.forEach(row => {
      itemIdByKey.set(toKey(row.name), row.id);
    });

    const allIngredientsForCafe = await client.query(
      'SELECT id, name FROM ingredients WHERE cafe_id = $1',
      [cafeId]
    );
    allIngredientsForCafe.rows.forEach(row => {
      ingredientIdByKey.set(toKey(row.name), row.id);
    });

    await client.query('DELETE FROM recipes WHERE cafe_id = $1', [cafeId]);

    let recipesInserted = 0;
    const skippedRecipes = [];

    for (const raw of recipes) {
      const itemName = String(raw?.item_name || raw?.item || '').trim();
      const ingredientName = String(raw?.ingredient_name || raw?.ingredient || '').trim();
      const qty = toNumberOrNull(raw?.qty_per_portion ?? raw?.qty);
      const station = String(raw?.station || 'General').trim() || 'General';

      const itemId = itemIdByKey.get(toKey(itemName));
      const ingredientId = ingredientIdByKey.get(toKey(ingredientName));

      if (!itemName || !ingredientName || !itemId || !ingredientId || qty === null || qty <= 0) {
        skippedRecipes.push({
          item_name: itemName,
          ingredient_name: ingredientName,
          qty_per_portion: qty,
          reason: 'Missing item/ingredient match or invalid qty_per_portion'
        });
        continue;
      }

      await client.query(`
        INSERT INTO recipes (cafe_id, item_id, ingredient_id, qty_per_portion, station)
        VALUES ($1, $2, $3, $4, $5)
      `, [cafeId, itemId, ingredientId, qty, station]);
      recipesInserted += 1;
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      counts: {
        itemsInserted,
        itemsUpdated,
        itemsDeactivated,
        ingredientsInserted,
        ingredientsUpdated,
        recipesInserted,
        recipesSkipped: skippedRecipes.length
      },
      skippedRecipes: skippedRecipes.slice(0, 50)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/transactions', async (req, res) => {
  const { days = 28 } = req.query;
  try {
    const result = await pool.query(`
      SELECT * FROM transactions
      WHERE cafe_id = $1 AND date >= NOW() - INTERVAL '${parseInt(days)} days'
      ORDER BY date DESC
    `, [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/transactions/bulk', async (req, res) => {
  const { transactions } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of transactions) {
      await client.query(`
        INSERT INTO transactions (cafe_id, item_name, date, quantity, revenue, order_type, daypart)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [req.params.cafeId, t.item_name, t.date, t.quantity, t.revenue || 0, t.order_type || 'Dine-in', t.daypart || 'Morning']);
    }
    await client.query('COMMIT');
    res.status(201).json({ imported: transactions.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── FORECAST & PREP LIST ─────────────────────────────────────────────────────
router.get('/cafes/:cafeId/forecast', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId), date);
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cafes/:cafeId/prep-list', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const result = await pool.query(`
      SELECT * FROM prep_lists WHERE cafe_id = $1 AND date = $2 ORDER BY station, ingredient_name
    `, [req.params.cafeId, date]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/cafes/:cafeId/prep-list/:prepId', async (req, res) => {
  const { completed } = req.body;
  try {
    const result = await pool.query(
      'UPDATE prep_lists SET completed = $1 WHERE id = $2 AND cafe_id = $3 RETURNING *',
      [completed, req.params.prepId, req.params.cafeId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/forecast/generate', async (req, res) => {
  const date = req.body.date || new Date().toISOString().split('T')[0];
  try {
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId), date);
    if (!forecast.closed) {
      await forecastService.savePrepList(req.params.cafeId, date, forecast.prepList);
    }
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DAILY LOGS ───────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/logs', async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const result = await pool.query(`
      SELECT * FROM daily_logs
      WHERE cafe_id = $1 AND date >= NOW() - INTERVAL '${parseInt(days)} days'
      ORDER BY date DESC
    `, [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/logs', async (req, res) => {
  const { date, waste_items, waste_value, items_86d, actual_covers, notes } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO daily_logs (cafe_id, date, waste_items, waste_value, items_86d, actual_covers, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (cafe_id, date) DO UPDATE SET
        waste_items = EXCLUDED.waste_items, waste_value = EXCLUDED.waste_value,
        items_86d = EXCLUDED.items_86d, actual_covers = EXCLUDED.actual_covers, notes = EXCLUDED.notes
      RETURNING *
    `, [req.params.cafeId, date, waste_items || 0, waste_value || 0, items_86d || 0, actual_covers || 0, notes || '']);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── METRICS ──────────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/metrics', async (req, res) => {
  const cafeId = req.params.cafeId;
  try {
    const totalLogs = await pool.query('SELECT COUNT(*) as days FROM daily_logs WHERE cafe_id = $1', [cafeId]);
    const allTime = await pool.query(`
      SELECT
        SUM(waste_value) as total_waste,
        SUM(items_86d) as total_86,
        COUNT(*) as days,
        AVG(actual_covers) as avg_covers
      FROM daily_logs WHERE cafe_id = $1
    `, [cafeId]);
    const last30 = await pool.query(`
      SELECT
        SUM(waste_value) as waste_30,
        SUM(items_86d) as incidents_86_30,
        COUNT(*) as days_30
      FROM daily_logs WHERE cafe_id = $1 AND date >= NOW() - INTERVAL '30 days'
    `, [cafeId]);
    const last7 = await pool.query(`
      SELECT
        SUM(waste_value) as waste_7,
        SUM(items_86d) as incidents_86_7,
        COUNT(*) as days_7
      FROM daily_logs WHERE cafe_id = $1 AND date >= NOW() - INTERVAL '7 days'
    `, [cafeId]);
    const baseline = await pool.query(`
      SELECT AVG(seed.waste_value) as avg_waste
      FROM (
        SELECT waste_value
        FROM daily_logs
        WHERE cafe_id = $1
        ORDER BY date ASC
        LIMIT 7
      ) seed
    `, [cafeId]);

    const baselineWaste = parseFloat(baseline.rows[0]?.avg_waste || 0);
    const totalWaste = parseFloat(allTime.rows[0]?.total_waste || 0);
    const daysRunning = parseInt(totalLogs.rows[0]?.days || 0);
    const labourSavedMins = daysRunning * 15;
    const labourSaved$ = Math.round(labourSavedMins / 60 * 21 * 100) / 100;
    const projectedWasteWithout = baselineWaste * daysRunning;
    const wasteSaved = Math.max(0, projectedWasteWithout - totalWaste);
    const totalSavings = wasteSaved + labourSaved$;
    const annualised = daysRunning > 0 ? Math.round(totalSavings * (365 / daysRunning)) : 0;

    const last30WasteAfter = parseFloat(last30.rows[0]?.waste_30 || 0);
    const days30 = parseInt(last30.rows[0]?.days_30 || 1);
    const avgDailyAfter = last30WasteAfter / days30;
    const wasteReductionPct = baselineWaste > 0
      ? Math.round(((baselineWaste - avgDailyAfter) / baselineWaste) * 100)
      : 0;

    res.json({
      daysRunning,
      allTime: {
        wasteSaved: Math.round(wasteSaved * 100) / 100,
        total86: parseInt(allTime.rows[0]?.total_86 || 0),
        labourSaved$,
        totalSavings: Math.round(totalSavings * 100) / 100,
        annualised
      },
      last30: {
        waste: last30WasteAfter,
        incidents86: parseInt(last30.rows[0]?.incidents_86_30 || 0),
        days: days30
      },
      last7: {
        waste: parseFloat(last7.rows[0]?.waste_7 || 0),
        incidents86: parseInt(last7.rows[0]?.incidents_86_7 || 0),
        days: parseInt(last7.rows[0]?.days_7 || 0)
      },
      baseline: { avgDailyWaste: Math.round(baselineWaste * 100) / 100 },
      avgDailyWasteAfter: Math.round(avgDailyAfter * 100) / 100,
      wasteReductionPct,
      forecastAccuracy: Math.max(0, 100 - Math.round((parseInt(last30.rows[0]?.incidents_86_30 || 0) / Math.max(days30, 1)) * 100))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WEATHER ─────────────────────────────────────────────────────────────────
router.get('/weather', async (req, res) => {
  const city = req.query.city || 'Toronto';
  try {
    const weather = await weatherService.getWeather(city);
    res.json(weather);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SEND PREP LIST MANUALLY ──────────────────────────────────────────────────
router.post('/cafes/:cafeId/send-prep-list', async (req, res) => {
  const date = req.body.date || new Date().toISOString().split('T')[0];
  try {
    const cafeResult = await pool.query('SELECT * FROM cafes WHERE id = $1', [req.params.cafeId]);
    if (!cafeResult.rows.length) return res.status(404).json({ error: 'Cafe not found' });
    const cafe = cafeResult.rows[0];
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId), date);
    await emailService.sendPrepList(cafe, forecast);
    res.json({ sent: true, to: cafe.kitchen_lead_email || cafe.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MANUAL PREP DISPATCH (PROTECTED) ───────────────────────────────────────
router.post('/admin/run-prep-now', async (req, res) => {
  const expectedToken = String(process.env.PREP_RUN_TOKEN || '').trim();

  if (!expectedToken) {
    return res.status(503).json({
      error: 'PREP_RUN_TOKEN is not configured on server'
    });
  }

  const bearer = extractBearerToken(req.headers.authorization || '');
  const headerToken = String(req.headers['x-prep-run-token'] || '').trim();
  const providedToken = bearer || headerToken;

  if (!providedToken || providedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { cafeIds = [], date = null, force = true } = req.body || {};

  if (date && Number.isNaN(Date.parse(date))) {
    return res.status(400).json({ error: 'date must be ISO-like (YYYY-MM-DD)' });
  }

  try {
    const result = await schedulerService.runPrepNow({
      cafeIds,
      dispatchDate: date,
      force: Boolean(force),
      source: 'manual_api'
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
