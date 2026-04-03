const { Pool } = require('pg');
const { getPgConfigDetails, getPresentDbEnvKeys } = require('./dbConfig');

const migrate = async () => {
  let client;
  let pool;

  try {
    const { config, source } = getPgConfigDetails();
    console.log(`Migration DB source: ${source}`);

    pool = new Pool(config);
    client = await pool.connect();

    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS cafes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        owner_name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        city VARCHAR(100) DEFAULT 'Toronto',
        holiday_behaviour VARCHAR(50) DEFAULT 'Manual',
        kitchen_lead_email VARCHAR(255),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        price DECIMAL(10,2),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ingredients (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        unit VARCHAR(50),
        par_level DECIMAL(10,2) DEFAULT 0,
        shelf_life_days INTEGER DEFAULT 7,
        current_stock DECIMAL(10,2) DEFAULT 0,
        cost_per_unit DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recipes (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE,
        qty_per_portion DECIMAL(10,3) NOT NULL,
        station VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id),
        item_name VARCHAR(255),
        date DATE NOT NULL,
        quantity INTEGER NOT NULL,
        revenue DECIMAL(10,2),
        order_type VARCHAR(50),
        daypart VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS prep_lists (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        ingredient_id INTEGER REFERENCES ingredients(id),
        ingredient_name VARCHAR(255),
        station VARCHAR(100),
        quantity_needed DECIMAL(10,2),
        unit VARCHAR(50),
        completed BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_logs (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        waste_items INTEGER DEFAULT 0,
        waste_value DECIMAL(10,2) DEFAULT 0,
        items_86d INTEGER DEFAULT 0,
        actual_covers INTEGER DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Ensure ON CONFLICT (cafe_id, date) works for daily log upserts
    await client.query(`
      DELETE FROM daily_logs a
      USING daily_logs b
      WHERE a.id > b.id
        AND a.cafe_id = b.cafe_id
        AND a.date = b.date;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_logs_cafe_date
      ON daily_logs (cafe_id, date);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY,
        holiday_date DATE NOT NULL,
        holiday_name VARCHAR(255) NOT NULL,
        province VARCHAR(50) DEFAULT 'ON',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS weather_logs (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        condition VARCHAR(100),
        temp_c DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Migration failed:', err.message || err);
    console.error('Detected DB env keys:', getPresentDbEnvKeys().join(', ') || 'none');
    throw err;
  } finally {
    if (client) client.release();
    if (pool) await pool.end();
  }
};

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
