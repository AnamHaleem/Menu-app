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
        prep_send_time VARCHAR(5) NOT NULL DEFAULT '06:00',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Allow multiple cafes to share owner email (one operator managing many locations).
    // Remove old unique constraints/indexes from earlier versions.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'cafes_email_key'
            AND conrelid = 'cafes'::regclass
        ) THEN
          ALTER TABLE cafes DROP CONSTRAINT cafes_email_key;
        END IF;
      END
      $$;
    `);

    await client.query(`
      DROP INDEX IF EXISTS idx_cafes_email_active_unique;
    `);

    await client.query(`
      ALTER TABLE cafes
      ADD COLUMN IF NOT EXISTS prep_send_time VARCHAR(5) NOT NULL DEFAULT '06:00';
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS owner_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_users_email_unique
      ON owner_users (LOWER(email));
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS owner_cafe_access (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER REFERENCES owner_users(id) ON DELETE CASCADE,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(owner_id, cafe_id)
      );
    `);

    // Backfill owner records from active cafe contacts for smoother rollout.
    await client.query(`
      INSERT INTO owner_users (email, full_name, active)
      SELECT DISTINCT LOWER(TRIM(c.email)), NULLIF(TRIM(c.owner_name), ''), true
      FROM cafes c
      WHERE c.active = true
        AND c.email IS NOT NULL
        AND TRIM(c.email) <> ''
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      INSERT INTO owner_users (email, full_name, active)
      SELECT DISTINCT LOWER(TRIM(c.kitchen_lead_email)), 'Kitchen Lead', true
      FROM cafes c
      WHERE c.active = true
        AND c.kitchen_lead_email IS NOT NULL
        AND TRIM(c.kitchen_lead_email) <> ''
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      INSERT INTO owner_cafe_access (owner_id, cafe_id)
      SELECT ou.id, c.id
      FROM cafes c
      JOIN owner_users ou ON LOWER(ou.email) = LOWER(TRIM(c.email))
      WHERE c.active = true
        AND c.email IS NOT NULL
        AND TRIM(c.email) <> ''
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      INSERT INTO owner_cafe_access (owner_id, cafe_id)
      SELECT ou.id, c.id
      FROM cafes c
      JOIN owner_users ou ON LOWER(ou.email) = LOWER(TRIM(c.kitchen_lead_email))
      WHERE c.active = true
        AND c.kitchen_lead_email IS NOT NULL
        AND TRIM(c.kitchen_lead_email) <> ''
      ON CONFLICT DO NOTHING;
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS prep_dispatch_logs (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        dispatch_date DATE NOT NULL,
        scheduled_time VARCHAR(5) NOT NULL DEFAULT '06:00',
        source VARCHAR(50) NOT NULL DEFAULT 'scheduler_tick',
        status VARCHAR(50) NOT NULL DEFAULT 'running',
        details TEXT,
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prep_dispatch_logs_cafe_date
      ON prep_dispatch_logs (cafe_id, dispatch_date);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS forecast_item_actuals (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        forecast_date DATE NOT NULL,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        predicted_qty DECIMAL(10,2) NOT NULL DEFAULT 0,
        base_predicted_qty DECIMAL(10,2) NOT NULL DEFAULT 0,
        avg_qty DECIMAL(10,2) NOT NULL DEFAULT 0,
        day_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1,
        weather_modifier DECIMAL(10,4) NOT NULL DEFAULT 1,
        holiday_modifier DECIMAL(10,4) NOT NULL DEFAULT 1,
        learning_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1,
        ai_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1,
        ai_applied BOOLEAN NOT NULL DEFAULT false,
        actual_qty DECIMAL(10,2),
        error_pct DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_item_actuals_unique
      ON forecast_item_actuals (cafe_id, forecast_date, item_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_forecast_item_actuals_cafe_date
      ON forecast_item_actuals (cafe_id, forecast_date);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_learning_state (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        multiplier DECIMAL(10,4) NOT NULL DEFAULT 1,
        raw_ratio DECIMAL(10,4),
        samples INTEGER NOT NULL DEFAULT 0,
        last_trained_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_item_learning_state_unique
      ON item_learning_state (cafe_id, item_id);
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
