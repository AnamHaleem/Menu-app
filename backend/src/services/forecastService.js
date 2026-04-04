const pool = require('../db/pool');
const weatherService = require('./weatherService');
const aiDecisionService = require('./aiDecisionService');

const DAY_MULTIPLIERS = {
  'Monday': 0.85, 'Tuesday': 0.90, 'Wednesday': 0.95,
  'Thursday': 1.00, 'Friday': 1.20, 'Saturday': 1.35, 'Sunday': 1.15
};

const WEATHER_MODIFIERS = {
  hotDrinks: ['Flat White', 'Latte', 'Cappuccino', 'Chai Latte'],
  coldDrinks: ['Cold Brew'],
};

function normalizeItemKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getWeatherModifier(itemName, condition, tempC) {
  const isHotDrink = WEATHER_MODIFIERS.hotDrinks.includes(itemName);
  const isColdDrink = WEATHER_MODIFIERS.coldDrinks.includes(itemName);

  if (condition === 'Rain' || condition === 'Snow') {
    if (isColdDrink) return 0.85;
    if (isHotDrink) return 1.15;
    return 1.1;
  }
  if (condition === 'Clear' && tempC >= 20) {
    if (isColdDrink) return 1.25;
    if (isHotDrink) return 0.9;
    return 1.0;
  }
  if (tempC <= -10) return 0.85;
  return 1.0;
}

function getHolidayModifier(behaviour) {
  switch (behaviour) {
    case 'Closed': return 0;
    case 'Reduced': return 0.6;
    case 'Sunday pattern': return null; // handled separately
    default: return 1.0;
  }
}

async function generateForecast(cafeId, targetDate) {
  const client = await pool.connect();
  try {
    const cafe = await client.query('SELECT * FROM cafes WHERE id = $1', [cafeId]);
    if (!cafe.rows.length) throw new Error('Cafe not found');
    const cafeData = cafe.rows[0];

    // Check if holiday
    const holidayCheck = await client.query(
      'SELECT * FROM holidays WHERE holiday_date = $1',
      [targetDate]
    );
    const isHoliday = holidayCheck.rows.length > 0;
    const holidayBehaviour = cafeData.holiday_behaviour;

    if (isHoliday && holidayBehaviour === 'Closed') {
      return { closed: true, holiday: holidayCheck.rows[0].holiday_name };
    }

    // Get weather
    const weather = await weatherService.getWeather(cafeData.city);

    // Get day of week
    const date = new Date(targetDate);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    let dayMultiplier = isHoliday && holidayBehaviour === 'Sunday pattern'
      ? DAY_MULTIPLIERS['Sunday']
      : DAY_MULTIPLIERS[dayName] || 1.0;

    const holidayModifier = isHoliday ? getHolidayModifier(holidayBehaviour) : 1.0;

    // Get last 28 days of transactions per item (relative to target date first)
    let transactionData = await client.query(`
      SELECT item_name, AVG(quantity) as avg_qty
      FROM transactions
      WHERE cafe_id = $1
        AND date >= ($2::date - INTERVAL '28 days')
        AND date < $2::date
      GROUP BY item_name
    `, [cafeId, targetDate]);

    // Fallback: if target-date window has no rows, use latest available 28-day window in dataset
    let usingFallbackWindow = false;
    if (!transactionData.rows.length) {
      transactionData = await client.query(`
        WITH anchor AS (
          SELECT MAX(date) AS max_date
          FROM transactions
          WHERE cafe_id = $1
        )
        SELECT t.item_name, AVG(t.quantity) AS avg_qty
        FROM transactions t
        CROSS JOIN anchor a
        WHERE t.cafe_id = $1
          AND a.max_date IS NOT NULL
          AND t.date >= (a.max_date - INTERVAL '28 days')
          AND t.date <= a.max_date
        GROUP BY t.item_name
      `, [cafeId]);
      usingFallbackWindow = transactionData.rows.length > 0;
    }

    const avgByItem = {};
    transactionData.rows.forEach(row => {
      avgByItem[normalizeItemKey(row.item_name)] = parseFloat(row.avg_qty);
    });

    // Item trend signal: last 14 days vs previous 14 days
    let trendData = await client.query(`
      SELECT
        item_name,
        AVG(CASE WHEN date >= ($2::date - INTERVAL '14 days') AND date < $2::date THEN quantity END) AS last_14_avg,
        AVG(CASE WHEN date >= ($2::date - INTERVAL '28 days') AND date < ($2::date - INTERVAL '14 days') THEN quantity END) AS prev_14_avg
      FROM transactions
      WHERE cafe_id = $1
        AND date >= ($2::date - INTERVAL '28 days')
        AND date < $2::date
      GROUP BY item_name
    `, [cafeId, targetDate]);

    if (!trendData.rows.length && usingFallbackWindow) {
      trendData = await client.query(`
        WITH anchor AS (
          SELECT MAX(date) AS max_date
          FROM transactions
          WHERE cafe_id = $1
        )
        SELECT
          t.item_name,
          AVG(CASE WHEN t.date >= (a.max_date - INTERVAL '14 days') AND t.date <= a.max_date THEN t.quantity END) AS last_14_avg,
          AVG(CASE WHEN t.date >= (a.max_date - INTERVAL '28 days') AND t.date < (a.max_date - INTERVAL '14 days') THEN t.quantity END) AS prev_14_avg
        FROM transactions t
        CROSS JOIN anchor a
        WHERE t.cafe_id = $1
          AND a.max_date IS NOT NULL
          AND t.date >= (a.max_date - INTERVAL '28 days')
          AND t.date <= a.max_date
        GROUP BY t.item_name
      `, [cafeId]);
    }

    const itemTrends = {};
    trendData.rows.forEach(row => {
      const last14 = parseFloat(row.last_14_avg || 0);
      const prev14 = parseFloat(row.prev_14_avg || 0);
      const trendPct = prev14 > 0 ? ((last14 - prev14) / prev14) * 100 : 0;
      itemTrends[normalizeItemKey(row.item_name)] = { last14, prev14, trendPct };
    });

    // Get all active items for this cafe
    const itemsResult = await client.query(
      'SELECT * FROM items WHERE cafe_id = $1 AND active = true',
      [cafeId]
    );

    // Calculate predicted quantities per item
    const predictions = {};
    for (const item of itemsResult.rows) {
      const itemKey = normalizeItemKey(item.name);
      const avgQty = avgByItem[itemKey] || 0;
      const weatherMod = getWeatherModifier(item.name, weather.condition, weather.temp);
      const predicted = Math.round(avgQty * dayMultiplier * weatherMod * holidayModifier);
      predictions[item.name] = {
        itemId: item.id,
        category: item.category,
        predicted,
        basePredicted: predicted,
        avgQty,
        dayMultiplier,
        weatherMod,
        holidayModifier,
        aiMultiplier: 1
      };
    }

    const aiDecision = await aiDecisionService.getForecastAdjustments({
      cafe: cafeData,
      targetDate,
      dayName,
      weather,
      isHoliday,
      holidayName: isHoliday ? holidayCheck.rows[0].holiday_name : null,
      baselinePredictions: predictions,
      itemTrends
    });

    if (aiDecision.applied) {
      for (const itemName of Object.keys(predictions)) {
        const globalMultiplier = aiDecision.globalMultiplier || 1;
        const itemMultiplier = aiDecision.itemMultipliers?.[itemName] || 1;
        const finalMultiplier = Math.min(2.0, Math.max(0.5, globalMultiplier * itemMultiplier));

        const basePredicted = predictions[itemName].basePredicted || 0;
        predictions[itemName].aiMultiplier = Math.round(finalMultiplier * 100) / 100;
        predictions[itemName].predicted = Math.max(0, Math.round(basePredicted * finalMultiplier));
      }
    }

    // Get recipes and calculate ingredient quantities
    const recipesResult = await client.query(`
      SELECT r.*, i.name as item_name, ing.name as ingredient_name, ing.unit, ing.id as ingredient_id
      FROM recipes r
      JOIN items i ON r.item_id = i.id
      JOIN ingredients ing ON r.ingredient_id = ing.id
      WHERE r.cafe_id = $1
    `, [cafeId]);

    const ingredientTotals = {};
    for (const recipe of recipesResult.rows) {
      const predicted = predictions[recipe.item_name]?.predicted || 0;
      const totalNeeded = predicted * parseFloat(recipe.qty_per_portion);
      const key = recipe.ingredient_id;
      if (!ingredientTotals[key]) {
        ingredientTotals[key] = {
          ingredientId: recipe.ingredient_id,
          name: recipe.ingredient_name,
          station: recipe.station,
          unit: recipe.unit,
          totalNeeded: 0
        };
      }
      ingredientTotals[key].totalNeeded += totalNeeded;
    }

    // Round totals
    Object.values(ingredientTotals).forEach(ing => {
      ing.totalNeeded = Math.round(ing.totalNeeded * 10) / 10;
    });

    return {
      cafeId,
      date: targetDate,
      dayName,
      weather,
      isHoliday,
      holidayName: isHoliday ? holidayCheck.rows[0].holiday_name : null,
      holidayBehaviour: isHoliday ? holidayBehaviour : null,
      aiDecision: {
        applied: Boolean(aiDecision.applied),
        model: aiDecision.model || null,
        notes: aiDecision.notes || aiDecision.reason || '',
        globalMultiplier: aiDecision.globalMultiplier || 1
      },
      dataWindow: {
        mode: usingFallbackWindow ? 'latest_available_28d' : 'target_relative_28d'
      },
      predictions,
      prepList: Object.values(ingredientTotals).sort((a, b) => a.station.localeCompare(b.station))
    };
  } finally {
    client.release();
  }
}

async function savePrepList(cafeId, date, prepList) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM prep_lists WHERE cafe_id = $1 AND date = $2', [cafeId, date]);
    for (const item of prepList) {
      await client.query(`
        INSERT INTO prep_lists (cafe_id, date, ingredient_id, ingredient_name, station, quantity_needed, unit)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [cafeId, date, item.ingredientId, item.name, item.station, item.totalNeeded, item.unit]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { generateForecast, savePrepList };
