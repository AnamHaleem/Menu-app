const { Pool } = require('pg');
const { getPgConfigDetails, getPresentDbEnvKeys } = require('./dbConfig');

const seed = async () => {
  let client;
  let pool;

  try {
    const { config, source } = getPgConfigDetails();
    console.log(`Seed DB source: ${source}`);

    pool = new Pool(config);
    client = await pool.connect();
    await client.query('BEGIN');

    // Seed demo cafe without relying on a global unique(email) constraint.
    const demoCafe = {
      name: 'The Daily Grind',
      owner_name: 'Demo Owner',
      email: 'owner@thedailygrind.ca',
      city: 'Toronto',
      holiday_behaviour: 'Manual',
      kitchen_lead_email: 'kitchen@thedailygrind.ca'
    };

    const existingCafe = await client.query(
      `SELECT id
       FROM cafes
       WHERE LOWER(email) = LOWER($1)
         AND active = true
       ORDER BY id
       LIMIT 1`,
      [demoCafe.email]
    );

    let cafeId;
    if (existingCafe.rows.length) {
      cafeId = existingCafe.rows[0].id;
      await client.query(
        `UPDATE cafes
         SET name = $1,
             owner_name = $2,
             city = $3,
             holiday_behaviour = $4,
             kitchen_lead_email = $5
         WHERE id = $6`,
        [
          demoCafe.name,
          demoCafe.owner_name,
          demoCafe.city,
          demoCafe.holiday_behaviour,
          demoCafe.kitchen_lead_email,
          cafeId
        ]
      );
    } else {
      const insertedCafe = await client.query(
        `INSERT INTO cafes (name, owner_name, email, city, holiday_behaviour, kitchen_lead_email)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          demoCafe.name,
          demoCafe.owner_name,
          demoCafe.email,
          demoCafe.city,
          demoCafe.holiday_behaviour,
          demoCafe.kitchen_lead_email
        ]
      );
      cafeId = insertedCafe.rows[0].id;
    }

    // Seed items
    const items = [
      ['Flat White', 'Beverage', 5.00],
      ['Latte', 'Beverage', 5.50],
      ['Cappuccino', 'Beverage', 5.00],
      ['Chai Latte', 'Beverage', 5.50],
      ['Cold Brew', 'Beverage', 4.50],
      ['Avocado Toast', 'Food', 12.00],
      ['Banana Bread', 'Food', 4.50],
      ['Granola Bowl', 'Food', 9.00],
      ['Egg & Cheese Roll', 'Food', 7.00],
      ['Smoked Salmon Bagel', 'Food', 11.50]
    ];

    for (const [name, category, price] of items) {
      await client.query(`
        INSERT INTO items (cafe_id, name, category, price, active)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT DO NOTHING;
      `, [cafeId, name, category, price]);
    }

    // Seed ingredients
    const ingredients = [
      ['Espresso shot', 'each', 50, 1, 0, 0.35],
      ['Whole milk', 'oz', 200, 5, 0, 0.05],
      ['Oat milk', 'oz', 100, 7, 0, 0.08],
      ['Chai concentrate', 'oz', 40, 14, 0, 0.15],
      ['Cold brew concentrate', 'oz', 60, 7, 0, 0.12],
      ['Sourdough bread', 'slice', 30, 3, 0, 0.40],
      ['Avocado', 'each', 20, 3, 0, 1.20],
      ['Free range egg', 'each', 40, 14, 0, 0.45],
      ['Banana bread loaf', 'each', 6, 3, 0, 4.50],
      ['Granola', 'oz', 60, 30, 0, 0.30],
      ['Greek yoghurt', 'oz', 80, 7, 0, 0.25],
      ['Mixed berries', 'oz', 40, 3, 0, 0.60],
      ['Honey', 'oz', 20, 90, 0, 0.20],
      ['Egg & cheese roll', 'each', 15, 1, 0, 2.50],
      ['Smoked salmon', 'oz', 30, 5, 0, 1.80],
      ['Bagel', 'each', 15, 3, 0, 0.80],
      ['Cream cheese', 'oz', 30, 7, 0, 0.35],
      ['Capers', 'oz', 10, 30, 0, 0.25]
    ];

    for (const [name, unit, par_level, shelf_life_days, current_stock, cost_per_unit] of ingredients) {
      await client.query(`
        INSERT INTO ingredients (cafe_id, name, unit, par_level, shelf_life_days, current_stock, cost_per_unit)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING;
      `, [cafeId, name, unit, par_level, shelf_life_days, current_stock, cost_per_unit]);
    }

    // Seed Ontario holidays
    const holidays = [
      ['2025-01-01', "New Year's Day"],
      ['2025-02-17', 'Family Day'],
      ['2025-04-18', 'Good Friday'],
      ['2025-05-19', 'Victoria Day'],
      ['2025-07-01', 'Canada Day'],
      ['2025-08-04', 'Civic Holiday'],
      ['2025-09-01', 'Labour Day'],
      ['2025-10-13', 'Thanksgiving Day'],
      ['2025-11-11', 'Remembrance Day'],
      ['2025-12-25', 'Christmas Day'],
      ['2025-12-26', 'Boxing Day'],
      ['2026-01-01', "New Year's Day"],
      ['2026-02-16', 'Family Day'],
      ['2026-04-03', 'Good Friday'],
      ['2026-05-18', 'Victoria Day'],
      ['2026-07-01', 'Canada Day'],
      ['2026-08-03', 'Civic Holiday'],
      ['2026-09-07', 'Labour Day'],
      ['2026-10-12', 'Thanksgiving Day'],
      ['2026-11-11', 'Remembrance Day'],
      ['2026-12-25', 'Christmas Day'],
      ['2026-12-28', 'Boxing Day (observed)']
    ];

    for (const [date, name] of holidays) {
      await client.query(`
        INSERT INTO holidays (holiday_date, holiday_name, province)
        VALUES ($1, $2, 'ON')
        ON CONFLICT DO NOTHING;
      `, [date, name]);
    }

    await client.query('COMMIT');
    console.log('Seed completed successfully for cafe ID:', cafeId);
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Seed failed:', err.message || err);
    console.error('Detected DB env keys:', getPresentDbEnvKeys().join(', ') || 'none');
    throw err;
  } finally {
    if (client) client.release();
    if (pool) await pool.end();
  }
};

seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
