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
      ALTER TABLE cafes
      ADD COLUMN IF NOT EXISTS learning_enabled BOOLEAN NOT NULL DEFAULT true;
    `);

    await client.query(`
      ALTER TABLE cafes
      ADD COLUMN IF NOT EXISTS ai_decision_enabled BOOLEAN NOT NULL DEFAULT true;
    `);

    await client.query(`
      ALTER TABLE cafes
      ADD COLUMN IF NOT EXISTS weather_sensitivity DECIMAL(5,2) NOT NULL DEFAULT 1.00;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(80) NOT NULL,
        severity VARCHAR(16) NOT NULL DEFAULT 'info',
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE SET NULL,
        actor_email VARCHAR(255),
        actor_source VARCHAR(80) NOT NULL DEFAULT 'system',
        summary TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_created_at
      ON admin_audit_events (created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_cafe_id
      ON admin_audit_events (cafe_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS owner_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        first_name VARCHAR(120),
        last_name VARCHAR(120),
        phone VARCHAR(32),
        secondary_phone VARCHAR(32),
        city VARCHAR(120),
        province VARCHAR(64),
        street_address VARCHAR(255),
        unit_number VARCHAR(64),
        postal_code VARCHAR(16),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
    `);
    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS last_name VARCHAR(120);
    `);
    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS phone VARCHAR(32);
    `);
    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS secondary_phone VARCHAR(32);
    `);
    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS city VARCHAR(120);
    `);
    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS province VARCHAR(64);
    `);
    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS street_address VARCHAR(255);
    `);
    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS unit_number VARCHAR(64);
    `);
    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS postal_code VARCHAR(16);
    `);

    await client.query(`
      ALTER TABLE owner_users
      ADD COLUMN IF NOT EXISTS avatar_data_url TEXT;
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
        access_role VARCHAR(16) NOT NULL DEFAULT 'viewer',
        invited_by_owner_id INTEGER REFERENCES owner_users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(owner_id, cafe_id)
      );
    `);

    await client.query(`
      ALTER TABLE owner_cafe_access
      ADD COLUMN IF NOT EXISTS access_role VARCHAR(16) NOT NULL DEFAULT 'viewer';
    `);

    await client.query(`
      ALTER TABLE owner_cafe_access
      ADD COLUMN IF NOT EXISTS invited_by_owner_id INTEGER REFERENCES owner_users(id) ON DELETE SET NULL;
    `);

    await client.query(`
      ALTER TABLE owner_cafe_access
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
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
      UPDATE owner_cafe_access oca
      SET access_role = 'owner',
          updated_at = NOW()
      FROM owner_users ou
      JOIN cafes c ON LOWER(TRIM(c.email)) = LOWER(ou.email)
      WHERE oca.owner_id = ou.id
        AND oca.cafe_id = c.id
        AND (oca.access_role IS NULL OR oca.access_role = 'viewer');
    `);

    await client.query(`
      UPDATE owner_cafe_access oca
      SET access_role = 'editor',
          updated_at = NOW()
      FROM owner_users ou
      JOIN cafes c ON LOWER(TRIM(c.kitchen_lead_email)) = LOWER(ou.email)
      WHERE oca.owner_id = ou.id
        AND oca.cafe_id = c.id
        AND (oca.access_role IS NULL OR oca.access_role = 'viewer');
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
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS source_fingerprint VARCHAR(64);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_cafe_fingerprint_unique
      ON transactions (cafe_id, source_fingerprint);
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
        forecast_quantity DECIMAL(10,2),
        on_hand_quantity DECIMAL(10,2) DEFAULT 0,
        net_quantity DECIMAL(10,2),
        actual_prepped_quantity DECIMAL(10,2),
        actual_notes TEXT,
        unit VARCHAR(50),
        completed BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE prep_lists
      ADD COLUMN IF NOT EXISTS forecast_quantity DECIMAL(10,2);
    `);
    await client.query(`
      ALTER TABLE prep_lists
      ADD COLUMN IF NOT EXISTS on_hand_quantity DECIMAL(10,2) DEFAULT 0;
    `);
    await client.query(`
      ALTER TABLE prep_lists
      ADD COLUMN IF NOT EXISTS net_quantity DECIMAL(10,2);
    `);
    await client.query(`
      ALTER TABLE prep_lists
      ADD COLUMN IF NOT EXISTS actual_prepped_quantity DECIMAL(10,2);
    `);
    await client.query(`
      ALTER TABLE prep_lists
      ADD COLUMN IF NOT EXISTS actual_notes TEXT;
    `);
    await client.query(`
      ALTER TABLE prep_lists
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `);

    await client.query(`
      UPDATE prep_lists
      SET forecast_quantity = COALESCE(forecast_quantity, quantity_needed),
          on_hand_quantity = COALESCE(on_hand_quantity, 0),
          net_quantity = COALESCE(net_quantity, quantity_needed),
          updated_at = COALESCE(updated_at, created_at, NOW())
      WHERE forecast_quantity IS NULL
         OR net_quantity IS NULL
         OR on_hand_quantity IS NULL
         OR updated_at IS NULL;
    `);

    // Ensure one prep row per ingredient/day/cafe for safe upserts.
    await client.query(`
      DELETE FROM prep_lists a
      USING prep_lists b
      WHERE a.id > b.id
        AND a.cafe_id = b.cafe_id
        AND a.date = b.date
        AND a.ingredient_id = b.ingredient_id;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prep_lists_cafe_date_ingredient
      ON prep_lists (cafe_id, date, ingredient_id);
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
      ALTER TABLE forecast_item_actuals
      ADD COLUMN IF NOT EXISTS ml_applied BOOLEAN NOT NULL DEFAULT false;
    `);

    await client.query(`
      ALTER TABLE forecast_item_actuals
      ADD COLUMN IF NOT EXISTS ml_model_version_id INTEGER REFERENCES ml_model_versions(id) ON DELETE SET NULL;
    `);

    await client.query(`
      ALTER TABLE forecast_item_actuals
      ADD COLUMN IF NOT EXISTS ml_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1;
    `);

    await client.query(`
      ALTER TABLE forecast_item_actuals
      ADD COLUMN IF NOT EXISTS forecast_source VARCHAR(32) NOT NULL DEFAULT 'rules';
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_model_versions (
        id SERIAL PRIMARY KEY,
        model_key VARCHAR(120) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        model_family VARCHAR(120) NOT NULL DEFAULT 'baseline',
        status VARCHAR(32) NOT NULL DEFAULT 'draft',
        feature_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        notes TEXT,
        trained_range_start DATE,
        trained_range_end DATE,
        training_rows INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        activated_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ml_model_versions_status
      ON ml_model_versions (status);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_training_runs (
        id SERIAL PRIMARY KEY,
        model_version_id INTEGER REFERENCES ml_model_versions(id) ON DELETE SET NULL,
        cafe_id INTEGER REFERENCES cafes(id) ON DELETE SET NULL,
        requested_by VARCHAR(255),
        source VARCHAR(80) NOT NULL DEFAULT 'manual_api',
        run_type VARCHAR(80) NOT NULL DEFAULT 'feature_build',
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        range_start DATE,
        range_end DATE,
        feature_rows_built INTEGER NOT NULL DEFAULT 0,
        cafes_processed INTEGER NOT NULL DEFAULT 0,
        items_processed INTEGER NOT NULL DEFAULT 0,
        predictions_written INTEGER NOT NULL DEFAULT 0,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message TEXT,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ml_training_runs_created_at
      ON ml_training_runs (created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ml_training_runs_cafe_id
      ON ml_training_runs (cafe_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_daily_features (
        id SERIAL PRIMARY KEY,
        cafe_id INTEGER NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
        feature_date DATE NOT NULL,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        item_category VARCHAR(120),
        actual_qty DECIMAL(12,4) NOT NULL DEFAULT 0,
        revenue DECIMAL(12,4) NOT NULL DEFAULT 0,
        tx_count INTEGER NOT NULL DEFAULT 0,
        avg_price DECIMAL(12,4) NOT NULL DEFAULT 0,
        lag_qty_1d DECIMAL(12,4) NOT NULL DEFAULT 0,
        lag_qty_7d DECIMAL(12,4) NOT NULL DEFAULT 0,
        avg_qty_7d DECIMAL(12,4) NOT NULL DEFAULT 0,
        avg_qty_14d DECIMAL(12,4) NOT NULL DEFAULT 0,
        avg_qty_28d DECIMAL(12,4) NOT NULL DEFAULT 0,
        avg_qty_same_weekday_4w DECIMAL(12,4) NOT NULL DEFAULT 0,
        rolling_revenue_7d DECIMAL(12,4) NOT NULL DEFAULT 0,
        day_of_week INTEGER NOT NULL,
        iso_week INTEGER NOT NULL,
        month_of_year INTEGER NOT NULL,
        is_weekend BOOLEAN NOT NULL DEFAULT false,
        is_holiday BOOLEAN NOT NULL DEFAULT false,
        holiday_name VARCHAR(255),
        weather_condition VARCHAR(100),
        temp_c DECIMAL(8,4),
        weather_bucket VARCHAR(80),
        learning_multiplier DECIMAL(12,4) NOT NULL DEFAULT 1,
        learning_samples INTEGER NOT NULL DEFAULT 0,
        ai_recent_7d_rate DECIMAL(12,4) NOT NULL DEFAULT 0,
        prep_days_last_7d INTEGER NOT NULL DEFAULT 0,
        waste_value_last_7d DECIMAL(12,4) NOT NULL DEFAULT 0,
        items_86_last_7d INTEGER NOT NULL DEFAULT 0,
        stockout_flag BOOLEAN NOT NULL DEFAULT false,
        latest_forecast_qty DECIMAL(12,4),
        latest_base_forecast_qty DECIMAL(12,4),
        source_window_start DATE,
        source_window_end DATE,
        feature_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(cafe_id, feature_date, item_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ml_daily_features_cafe_date
      ON ml_daily_features (cafe_id, feature_date DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ml_daily_features_item_date
      ON ml_daily_features (item_id, feature_date DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_predictions (
        id SERIAL PRIMARY KEY,
        model_version_id INTEGER REFERENCES ml_model_versions(id) ON DELETE CASCADE,
        training_run_id INTEGER REFERENCES ml_training_runs(id) ON DELETE SET NULL,
        cafe_id INTEGER NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
        prediction_date DATE NOT NULL,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        predicted_qty DECIMAL(12,4) NOT NULL DEFAULT 0,
        lower_bound_qty DECIMAL(12,4),
        upper_bound_qty DECIMAL(12,4),
        confidence_score DECIMAL(8,4),
        source VARCHAR(80) NOT NULL DEFAULT 'shadow',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(model_version_id, cafe_id, prediction_date, item_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ml_predictions_cafe_date
      ON ml_predictions (cafe_id, prediction_date DESC);
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
