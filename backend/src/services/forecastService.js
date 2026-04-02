const pool = require('../db/pool');
const weatherService = require('./weatherService');

const DAY_MULTIPLIERS = {
  'Monday': 0.85, 'Tuesday': 0.90, 'Wednesday': 0.95,
  'Thursday': 1.00, 'Friday': 1.20, 'Saturday': 1.35, 'Sunday': 1.15
};

const WEATHER_MODIFIERS = {
  hotDrinks: ['Flat White', 'Latte', 'Cappuccino', 'Chai Latte'],
  coldDrinks: ['Cold Brew'],
};

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

    // Get last 28 days of transactions per item
    const transactionData = await client.query(`
      SELECT item_name, AVG(quantity) as avg_qty
      FROM transactions
      WHERE cafe_id = $1
        AND date >= NOW() - INTERVAL '28 days'
      GROUP BY item_name
    `, [cafeId]);

    const avgByItem = {};
    transactionData.rows.forEach(row => {
      avgByItem[row.item_name] = parseFloat(row.avg_qty);
    });

    // Get all active items for this cafe
    const itemsResult = await client.query(
      'SELECT * FROM items WHERE cafe_id = $1 AND active = true',
      [cafeId]
    );

    // Calculate predicted quantities per item
    const predictions = {};
    for (const item of itemsResult.rows) {
      const avgQty = avgByItem[item.name] || 0;
      const weatherMod = getWeatherModifier(item.name, weather.condition, weather.temp);
      const predicted = Math.round(avgQty * dayMultiplier * weatherMod * holidayModifier);
      predictions[item.name] = { itemId: item.id, predicted, avgQty, dayMultiplier, weatherMod, holidayModifier };
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
