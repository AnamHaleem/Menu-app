const pool = require('../db/pool');
const weatherService = require('./weatherService');
const aiDecisionService = require('./aiDecisionService');

const DAY_MULTIPLIERS = {
  Monday: 0.85,
  Tuesday: 0.9,
  Wednesday: 0.95,
  Thursday: 1.0,
  Friday: 1.2,
  Saturday: 1.35,
  Sunday: 1.15
};

const WEATHER_MODIFIERS = {
  hotDrinks: ['Flat White', 'Latte', 'Cappuccino', 'Chai Latte'],
  coldDrinks: ['Cold Brew']
};

function readNumberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const LEARNING_RATIO_MIN = readNumberEnv('LEARNING_RATIO_MIN', 0.75);
const LEARNING_RATIO_MAX = readNumberEnv('LEARNING_RATIO_MAX', 1.25);
const LEARNING_HISTORY_DAYS = readNumberEnv('LEARNING_HISTORY_DAYS', 60);
const LEARNING_MAX_SAMPLES_PER_ITEM = readNumberEnv('LEARNING_MAX_SAMPLES_PER_ITEM', 21);
const LEARNING_CONFIDENCE_SAMPLES = readNumberEnv('LEARNING_CONFIDENCE_SAMPLES', 8);

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeItemKey(value) {
  return String(value || '').trim().toLowerCase();
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function firstPositiveNumber(values, fallback = 1) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return fallback;
}

function averageNumbers(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function getMlWeatherBucket(condition, tempC) {
  const normalized = String(condition || '').trim().toLowerCase();
  if (normalized.includes('snow')) return 'snow';
  if (normalized.includes('rain') || normalized.includes('drizzle') || normalized.includes('thunder')) return 'wet';
  if (normalized.includes('clear') && tempC >= 20) return 'hot-clear';
  if (normalized.includes('clear')) return 'clear';
  if (normalized.includes('cloud')) return 'cloudy';
  if (tempC <= 0) return 'cold';
  return normalized || 'unknown';
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
    case 'Closed':
      return 0;
    case 'Reduced':
      return 0.6;
    case 'Sunday pattern':
      return null; // handled separately
    default:
      return 1.0;
  }
}

async function getActiveMlModelForCafe(client, cafeId) {
  const result = await client.query(
    `
      SELECT *
      FROM ml_model_versions
      WHERE status = 'active'
      ORDER BY COALESCE(activated_at, created_at) DESC, id DESC
    `
  );

  if (!result.rows.length) return null;

  let fleetFallback = null;
  for (const row of result.rows) {
    const featureSpec = parseJsonObject(row.feature_spec);
    const scope = featureSpec.scope || null;
    if (scope?.type === 'cafe' && Number(scope.cafeId) === Number(cafeId)) {
      return { ...row, featureSpec };
    }
    if (!fleetFallback && (!scope || scope.type === 'fleet')) {
      fleetFallback = { ...row, featureSpec };
    }
  }

  return fleetFallback;
}

async function getLatestMlFeaturesByItemId(client, cafeId, targetDate) {
  const result = await client.query(
    `
      SELECT DISTINCT ON (item_id)
        item_id,
        feature_date::text AS feature_date,
        item_category,
        lag_qty_1d,
        lag_qty_7d,
        avg_qty_7d,
        avg_qty_14d,
        avg_qty_28d,
        avg_qty_same_weekday_4w,
        rolling_revenue_7d,
        avg_price,
        learning_multiplier,
        learning_samples,
        ai_recent_7d_rate,
        prep_days_last_7d,
        waste_value_last_7d,
        items_86_last_7d,
        stockout_flag,
        latest_forecast_qty,
        latest_base_forecast_qty
      FROM ml_daily_features
      WHERE cafe_id = $1
        AND feature_date < $2::date
      ORDER BY item_id, feature_date DESC, id DESC
    `,
    [cafeId, targetDate]
  );

  const map = new Map();
  result.rows.forEach((row) => {
    map.set(Number(row.item_id), {
      featureDate: row.feature_date,
      itemCategory: row.item_category || 'uncategorized',
      lagQty1d: Number(row.lag_qty_1d || 0),
      lagQty7d: Number(row.lag_qty_7d || 0),
      avgQty7d: Number(row.avg_qty_7d || 0),
      avgQty14d: Number(row.avg_qty_14d || 0),
      avgQty28d: Number(row.avg_qty_28d || 0),
      avgQtySameWeekday4w: Number(row.avg_qty_same_weekday_4w || 0),
      rollingRevenue7d: Number(row.rolling_revenue_7d || 0),
      avgPrice: Number(row.avg_price || 0),
      learningMultiplier: Number(row.learning_multiplier || 1),
      learningSamples: Number(row.learning_samples || 0),
      aiRecent7dRate: Number(row.ai_recent_7d_rate || 0),
      prepDaysLast7d: Number(row.prep_days_last_7d || 0),
      wasteValueLast7d: Number(row.waste_value_last_7d || 0),
      items86Last7d: Number(row.items_86_last_7d || 0),
      stockoutFlag: Boolean(row.stockout_flag),
      latestForecastQty: row.latest_forecast_qty === null || row.latest_forecast_qty === undefined ? null : Number(row.latest_forecast_qty),
      latestBaseForecastQty: row.latest_base_forecast_qty === null || row.latest_base_forecast_qty === undefined ? null : Number(row.latest_base_forecast_qty)
    });
  });
  return map;
}

function computeLiveMlPrediction(model, featureRow, context) {
  const featureSpec = model?.featureSpec || {};
  const categories = Array.isArray(featureSpec.categories) ? featureSpec.categories.map(normalizeItemKey) : [];
  const weatherBuckets = Array.isArray(featureSpec.weatherBuckets) ? featureSpec.weatherBuckets.map(normalizeItemKey) : [];
  const means = Array.isArray(featureSpec.standardizer?.means) ? featureSpec.standardizer.means.map((value) => Number(value)) : [];
  const stdDevs = Array.isArray(featureSpec.standardizer?.stdDevs) ? featureSpec.standardizer.stdDevs.map((value) => Number(value) || 1) : [];
  const weights = Array.isArray(featureSpec.weights) ? featureSpec.weights.map((value) => Number(value)) : [];
  if (!means.length || means.length !== stdDevs.length || weights.length !== means.length + 1) {
    return null;
  }

  const safeFeatureRow = featureRow || {};
  const baselineQty = Math.max(
    1,
    firstPositiveNumber([
      context.ruleBasePredicted,
      safeFeatureRow.latestBaseForecastQty,
      safeFeatureRow.latestForecastQty,
      safeFeatureRow.avgQty7d,
      safeFeatureRow.avgQty28d,
      safeFeatureRow.lagQty7d,
      safeFeatureRow.avgQtySameWeekday4w,
      safeFeatureRow.lagQty1d
    ], 1)
  );
  const avgPrice = Math.max(0, Number(safeFeatureRow.avgPrice || context.avgPrice || 0));
  const revenueScale = Math.max(Number(safeFeatureRow.rollingRevenue7d || 0), baselineQty * Math.max(avgPrice, 1));
  const categoryKey = normalizeItemKey(safeFeatureRow.itemCategory || context.itemCategory || 'uncategorized');
  const weatherKey = normalizeItemKey(context.weatherBucket || 'unknown');
  const dayRadians = ((Math.max(1, context.dayOfWeek) - 1) / 7) * Math.PI * 2;
  const monthRadians = ((Math.max(1, context.monthOfYear) - 1) / 12) * Math.PI * 2;

  const rawValues = [
    Math.log1p(baselineQty),
    Number(safeFeatureRow.lagQty1d || 0) / baselineQty,
    Number(safeFeatureRow.lagQty7d || 0) / baselineQty,
    Number(safeFeatureRow.avgQty7d || 0) / baselineQty,
    Number(safeFeatureRow.avgQty14d || 0) / baselineQty,
    Number(safeFeatureRow.avgQty28d || 0) / baselineQty,
    Number(safeFeatureRow.avgQtySameWeekday4w || 0) / baselineQty,
    Number(context.ruleBasePredicted || 0) / baselineQty,
    avgPrice,
    Number(context.learningMultiplier || safeFeatureRow.learningMultiplier || 1),
    Number(context.learningSamples || safeFeatureRow.learningSamples || 0) / 25,
    Number(safeFeatureRow.aiRecent7dRate || 0),
    Number(safeFeatureRow.prepDaysLast7d || 0) / 7,
    Number(safeFeatureRow.wasteValueLast7d || 0) / Math.max(revenueScale, 1),
    Number(safeFeatureRow.items86Last7d || 0) / 7,
    context.tempC === null || context.tempC === undefined ? 0 : Number(context.tempC) / 30,
    context.isWeekend ? 1 : 0,
    context.isHoliday ? 1 : 0,
    (context.stockoutFlag || safeFeatureRow.stockoutFlag) ? 1 : 0,
    Math.sin(dayRadians),
    Math.cos(dayRadians),
    Math.sin(monthRadians),
    Math.cos(monthRadians),
    ...categories.map((bucket) => (bucket === categoryKey ? 1 : 0)),
    ...weatherBuckets.map((bucket) => (bucket === weatherKey ? 1 : 0))
  ];

  if (rawValues.length !== means.length) return null;

  const standardized = rawValues.map((value, index) => (Number(value || 0) - means[index]) / (stdDevs[index] || 1));
  const predictedMultiplier = clampNumber(
    [1, ...standardized].reduce((sum, value, index) => sum + value * (weights[index] || 0), 0),
    0,
    4.5
  );
  const predictedQty = Math.max(0, Math.round(predictedMultiplier * baselineQty));
  const appliedMultiplier = context.ruleBasePredicted > 0
    ? clampNumber(predictedQty / context.ruleBasePredicted, 0, 4.5)
    : predictedMultiplier;
  const featureCoverage = averageNumbers([
    safeFeatureRow.lagQty1d > 0 ? 1 : 0,
    safeFeatureRow.lagQty7d > 0 ? 1 : 0,
    safeFeatureRow.avgQty7d > 0 ? 1 : 0,
    safeFeatureRow.avgQty28d > 0 ? 1 : 0,
    context.ruleBasePredicted > 0 ? 1 : 0,
    (context.learningSamples || safeFeatureRow.learningSamples || 0) > 0 ? 1 : 0
  ]);
  const confidenceScore = clampNumber(
    0.35
      + (featureCoverage * 0.5)
      + (Math.min((context.learningSamples || safeFeatureRow.learningSamples || 0) / 15, 1) * 0.15),
    0.05,
    0.99
  );

  return {
    modelVersionId: Number(model.id),
    modelKey: model.model_key,
    displayName: model.display_name,
    predictedQty,
    predictedMultiplier: Math.round(predictedMultiplier * 10000) / 10000,
    appliedMultiplier: Math.round(appliedMultiplier * 10000) / 10000,
    confidenceScore: Math.round(confidenceScore * 10000) / 10000,
    featureCoverage: Math.round(featureCoverage * 10000) / 10000
  };
}

async function syncForecastActualsFromTransactions(client, cafeId, targetDate) {
  await client.query(
    `
      WITH tx AS (
        SELECT
          t.cafe_id,
          t.date::date AS sale_date,
          COALESCE(t.item_id, i.id) AS resolved_item_id,
          SUM(t.quantity)::numeric AS actual_qty
        FROM transactions t
        LEFT JOIN items i
          ON i.cafe_id = t.cafe_id
         AND LOWER(TRIM(i.name)) = LOWER(TRIM(t.item_name))
        WHERE t.cafe_id = $1
          AND t.date < $2::date
          AND COALESCE(t.item_id, i.id) IS NOT NULL
        GROUP BY t.cafe_id, t.date::date, COALESCE(t.item_id, i.id)
      )
      UPDATE forecast_item_actuals fia
      SET actual_qty = tx.actual_qty,
          error_pct = CASE
            WHEN fia.predicted_qty > 0
              THEN ROUND((((tx.actual_qty - fia.predicted_qty) / fia.predicted_qty) * 100)::numeric, 2)
            ELSE NULL
          END,
          updated_at = NOW()
      FROM tx
      WHERE fia.cafe_id = tx.cafe_id
        AND fia.forecast_date = tx.sale_date
        AND fia.item_id = tx.resolved_item_id
        AND (fia.actual_qty IS NULL OR fia.actual_qty <> tx.actual_qty);
    `,
    [cafeId, targetDate]
  );
}

async function rebuildItemLearningState(client, cafeId, targetDate) {
  await client.query(
    `
      WITH history AS (
        SELECT
          fia.item_id,
          fia.predicted_qty,
          fia.actual_qty,
          fia.forecast_date,
          fia.id,
          ROW_NUMBER() OVER (
            PARTITION BY fia.item_id
            ORDER BY fia.forecast_date DESC, fia.id DESC
          ) AS rn
        FROM forecast_item_actuals fia
        WHERE fia.cafe_id = $1
          AND fia.forecast_date < $2::date
          AND fia.forecast_date >= ($2::date - ($3::text || ' days')::interval)
          AND fia.actual_qty IS NOT NULL
          AND fia.predicted_qty > 0
          AND fia.ai_applied = false
          AND COALESCE(fia.ml_applied, false) = false
      ),
      agg AS (
        SELECT
          item_id,
          COUNT(*)::int AS samples,
          AVG(actual_qty / NULLIF(predicted_qty, 0))::numeric AS raw_ratio
        FROM history
        WHERE rn <= $4
        GROUP BY item_id
      )
      INSERT INTO item_learning_state (
        cafe_id,
        item_id,
        multiplier,
        raw_ratio,
        samples,
        last_trained_at,
        created_at,
        updated_at
      )
      SELECT
        $1 AS cafe_id,
        item_id,
        ROUND((
          1 + (LEAST($6::numeric, GREATEST($5::numeric, raw_ratio)) - 1)
              * LEAST(1::numeric, samples::numeric / $7::numeric)
        )::numeric, 4) AS multiplier,
        ROUND(raw_ratio::numeric, 4) AS raw_ratio,
        samples,
        NOW(),
        NOW(),
        NOW()
      FROM agg
      ON CONFLICT (cafe_id, item_id)
      DO UPDATE SET
        multiplier = EXCLUDED.multiplier,
        raw_ratio = EXCLUDED.raw_ratio,
        samples = EXCLUDED.samples,
        last_trained_at = NOW(),
        updated_at = NOW();
    `,
    [
      cafeId,
      targetDate,
      LEARNING_HISTORY_DAYS,
      LEARNING_MAX_SAMPLES_PER_ITEM,
      LEARNING_RATIO_MIN,
      LEARNING_RATIO_MAX,
      LEARNING_CONFIDENCE_SAMPLES
    ]
  );
}

async function getLearningStateByItemId(client, cafeId) {
  const result = await client.query(
    `
      SELECT item_id, multiplier, raw_ratio, samples
      FROM item_learning_state
      WHERE cafe_id = $1
    `,
    [cafeId]
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.item_id, {
      multiplier: Number(row.multiplier) || 1,
      rawRatio: row.raw_ratio === null || row.raw_ratio === undefined ? null : Number(row.raw_ratio),
      samples: Number(row.samples) || 0
    });
  }
  return map;
}

async function saveItemForecastSnapshot(client, cafeId, targetDate, predictions, aiDecision) {
  const aiApplied = Boolean(aiDecision?.applied);

  for (const [itemName, itemPrediction] of Object.entries(predictions)) {
    await client.query(
      `
        INSERT INTO forecast_item_actuals (
          cafe_id,
          forecast_date,
          item_id,
          item_name,
          predicted_qty,
          base_predicted_qty,
          avg_qty,
          day_multiplier,
          weather_modifier,
          holiday_modifier,
          learning_multiplier,
          ml_multiplier,
          ml_applied,
          ml_model_version_id,
          forecast_source,
          ai_multiplier,
          ai_applied,
          created_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW()
        )
        ON CONFLICT (cafe_id, forecast_date, item_id)
        DO UPDATE SET
          item_name = EXCLUDED.item_name,
          predicted_qty = EXCLUDED.predicted_qty,
          base_predicted_qty = EXCLUDED.base_predicted_qty,
          avg_qty = EXCLUDED.avg_qty,
          day_multiplier = EXCLUDED.day_multiplier,
          weather_modifier = EXCLUDED.weather_modifier,
          holiday_modifier = EXCLUDED.holiday_modifier,
          learning_multiplier = EXCLUDED.learning_multiplier,
          ml_multiplier = EXCLUDED.ml_multiplier,
          ml_applied = EXCLUDED.ml_applied,
          ml_model_version_id = EXCLUDED.ml_model_version_id,
          forecast_source = EXCLUDED.forecast_source,
          ai_multiplier = EXCLUDED.ai_multiplier,
          ai_applied = EXCLUDED.ai_applied,
          updated_at = NOW();
      `,
      [
        cafeId,
        targetDate,
        itemPrediction.itemId,
        itemName,
        itemPrediction.predicted,
        itemPrediction.basePredicted,
        itemPrediction.avgQty,
        itemPrediction.dayMultiplier,
        itemPrediction.weatherMod,
        itemPrediction.holidayModifier,
        itemPrediction.learningMultiplier || 1,
        itemPrediction.mlMultiplier || 1,
        Boolean(itemPrediction.mlApplied),
        itemPrediction.mlModelVersionId || null,
        itemPrediction.forecastSource || 'rules',
        itemPrediction.aiMultiplier || 1,
        aiApplied
      ]
    );
  }
}

async function generateForecast(cafeId, targetDate, options = {}) {
  const persistLearningSnapshot = options.persistLearningSnapshot !== false;
  const client = await pool.connect();
  try {
    const cafe = await client.query('SELECT * FROM cafes WHERE id = $1', [cafeId]);
    if (!cafe.rows.length) throw new Error('Cafe not found');
    const cafeData = cafe.rows[0];

    let learningEnabled = cafeData.learning_enabled !== false;
    let learningByItemId = new Map();
    let activeMlModel = null;
    let latestMlFeaturesByItemId = new Map();
    try {
      await syncForecastActualsFromTransactions(client, cafeId, targetDate);
      if (learningEnabled) {
        await rebuildItemLearningState(client, cafeId, targetDate);
        learningByItemId = await getLearningStateByItemId(client, cafeId);
      }
      activeMlModel = await getActiveMlModelForCafe(client, cafeId);
      if (activeMlModel) {
        latestMlFeaturesByItemId = await getLatestMlFeaturesByItemId(client, cafeId, targetDate);
      }
    } catch (err) {
      if (err?.code === '42P01') {
        learningEnabled = false;
        console.warn('Learning tables are not ready yet. Running forecast without auto-learning.');
      } else {
        throw err;
      }
    }

    // Check if holiday
    const holidayCheck = await client.query('SELECT * FROM holidays WHERE holiday_date = $1', [targetDate]);
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
    const dayMultiplier =
      isHoliday && holidayBehaviour === 'Sunday pattern'
        ? DAY_MULTIPLIERS.Sunday
        : DAY_MULTIPLIERS[dayName] || 1.0;

    const holidayModifier = isHoliday ? getHolidayModifier(holidayBehaviour) : 1.0;
    const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
    const monthOfYear = date.getMonth() + 1;
    const isWeekend = dayOfWeek === 6 || dayOfWeek === 7;
    const weatherBucket = getMlWeatherBucket(weather.condition, weather.temp);

    // Get last 28 days of transactions per item (relative to target date first)
    let transactionData = await client.query(
      `
      SELECT item_name, AVG(quantity) as avg_qty
      FROM transactions
      WHERE cafe_id = $1
        AND date >= ($2::date - INTERVAL '28 days')
        AND date < $2::date
      GROUP BY item_name
    `,
      [cafeId, targetDate]
    );

    // Fallback: if target-date window has no rows, use latest available 28-day window in dataset
    let usingFallbackWindow = false;
    if (!transactionData.rows.length) {
      transactionData = await client.query(
        `
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
      `,
        [cafeId]
      );
      usingFallbackWindow = transactionData.rows.length > 0;
    }

    const avgByItem = {};
    transactionData.rows.forEach((row) => {
      avgByItem[normalizeItemKey(row.item_name)] = parseFloat(row.avg_qty);
    });

    // Item trend signal: last 14 days vs previous 14 days
    let trendData = await client.query(
      `
      SELECT
        item_name,
        AVG(CASE WHEN date >= ($2::date - INTERVAL '14 days') AND date < $2::date THEN quantity END) AS last_14_avg,
        AVG(CASE WHEN date >= ($2::date - INTERVAL '28 days') AND date < ($2::date - INTERVAL '14 days') THEN quantity END) AS prev_14_avg
      FROM transactions
      WHERE cafe_id = $1
        AND date >= ($2::date - INTERVAL '28 days')
        AND date < $2::date
      GROUP BY item_name
    `,
      [cafeId, targetDate]
    );

    if (!trendData.rows.length && usingFallbackWindow) {
      trendData = await client.query(
        `
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
      `,
        [cafeId]
      );
    }

    const itemTrends = {};
    trendData.rows.forEach((row) => {
      const last14 = parseFloat(row.last_14_avg || 0);
      const prev14 = parseFloat(row.prev_14_avg || 0);
      const trendPct = prev14 > 0 ? ((last14 - prev14) / prev14) * 100 : 0;
      itemTrends[normalizeItemKey(row.item_name)] = { last14, prev14, trendPct };
    });

    // Get all active items for this cafe
    const itemsResult = await client.query('SELECT * FROM items WHERE cafe_id = $1 AND active = true', [cafeId]);

    // Calculate predicted quantities per item
    const predictions = {};
    for (const item of itemsResult.rows) {
      const itemKey = normalizeItemKey(item.name);
      const avgQty = avgByItem[itemKey] || 0;
      const baseWeatherMod = getWeatherModifier(item.name, weather.condition, weather.temp);
      const weatherSensitivity = clampNumber(Number(cafeData.weather_sensitivity || 1), 0.5, 1.5);
      const weatherMod = clampNumber(
        1 + ((baseWeatherMod - 1) * weatherSensitivity),
        0.75,
        1.4
      );
      const learningState = learningByItemId.get(item.id);
      const learningMultiplier = clampNumber(
        Number(learningState?.multiplier || 1),
        LEARNING_RATIO_MIN,
        LEARNING_RATIO_MAX
      );

      const ruleBasePredicted = Math.max(0, Math.round(avgQty * dayMultiplier * weatherMod * holidayModifier * learningMultiplier));
      const latestMlFeature = latestMlFeaturesByItemId.get(item.id) || {
        itemCategory: item.category || 'Uncategorized',
        avgQty7d: avgQty,
        avgQty14d: avgQty,
        avgQty28d: avgQty,
        avgQtySameWeekday4w: avgQty,
        lagQty1d: avgQty,
        lagQty7d: avgQty,
        avgPrice: Number(item.price || 0),
        learningMultiplier,
        learningSamples: Number(learningState?.samples || 0),
        aiRecent7dRate: 0,
        prepDaysLast7d: 0,
        wasteValueLast7d: 0,
        items86Last7d: 0,
        stockoutFlag: false,
        latestForecastQty: avgQty,
        latestBaseForecastQty: avgQty
      };
      const liveMlPrediction = activeMlModel
        ? computeLiveMlPrediction(activeMlModel, latestMlFeature, {
            ruleBasePredicted,
            avgPrice: Number(item.price || 0),
            itemCategory: item.category || 'Uncategorized',
            learningMultiplier,
            learningSamples: Number(learningState?.samples || 0),
            weatherBucket,
            tempC: weather.temp,
            isWeekend,
            isHoliday,
            stockoutFlag: false,
            dayOfWeek,
            monthOfYear
          })
        : null;
      const modelPredicted = liveMlPrediction ? liveMlPrediction.predictedQty : ruleBasePredicted;

      predictions[item.name] = {
        itemId: item.id,
        category: item.category,
        predicted: modelPredicted,
        basePredicted: ruleBasePredicted,
        avgQty,
        dayMultiplier,
        weatherMod,
        holidayModifier,
        learningMultiplier: Math.round(learningMultiplier * 10000) / 10000,
        learningSamples: Number(learningState?.samples || 0),
        learningRawRatio: learningState?.rawRatio ?? null,
        mlApplied: Boolean(liveMlPrediction),
        mlModelVersionId: liveMlPrediction?.modelVersionId || null,
        mlModelKey: liveMlPrediction?.modelKey || null,
        mlModelDisplayName: liveMlPrediction?.displayName || null,
        mlMultiplier: liveMlPrediction?.appliedMultiplier || 1,
        mlConfidenceScore: liveMlPrediction?.confidenceScore || null,
        mlFeatureCoverage: liveMlPrediction?.featureCoverage || null,
        forecastSource: liveMlPrediction ? 'ml' : 'rules',
        aiMultiplier: 1
      };
    }

    const aiDecision = cafeData.ai_decision_enabled === false
      ? {
          applied: false,
          reason: 'Cafe AI decisions are disabled'
        }
      : await aiDecisionService.getForecastAdjustments({
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

    if (learningEnabled && persistLearningSnapshot) {
      try {
        await saveItemForecastSnapshot(client, cafeId, targetDate, predictions, aiDecision);
      } catch (err) {
        if (err?.code === '42P01') {
          learningEnabled = false;
          console.warn('Could not persist learning snapshot yet. Continuing without auto-learning writeback.');
        } else {
          throw err;
        }
      }
    }

    // Get recipes and calculate ingredient quantities
    const recipesResult = await client.query(
      `
      SELECT
        r.*,
        i.name as item_name,
        ing.name as ingredient_name,
        ing.unit,
        ing.id as ingredient_id,
        ing.current_stock
      FROM recipes r
      JOIN items i ON r.item_id = i.id
      JOIN ingredients ing ON r.ingredient_id = ing.id
      WHERE r.cafe_id = $1
    `,
      [cafeId]
    );

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
          currentStock: Math.max(0, parseFloat(recipe.current_stock || 0)),
          totalNeeded: 0
        };
      }
      ingredientTotals[key].totalNeeded += totalNeeded;
    }

    // Round totals and apply stock-aware net need.
    Object.values(ingredientTotals).forEach((ing) => {
      const forecastQty = Math.round((ing.totalNeeded || 0) * 10) / 10;
      const onHandQty = Math.round((ing.currentStock || 0) * 10) / 10;
      const netQty = Math.max(0, Math.round((forecastQty - onHandQty) * 10) / 10);

      ing.forecastQty = forecastQty;
      ing.onHandQty = onHandQty;
      ing.netQty = netQty;
      // Keep existing key for compatibility across email + UI.
      ing.totalNeeded = netQty;
    });

    const predictionValues = Object.values(predictions);
    const itemsWithHistory = predictionValues.filter((p) => (p.learningSamples || 0) > 0).length;
    const itemsAdjusted = predictionValues.filter((p) => Math.abs((p.learningMultiplier || 1) - 1) >= 0.01).length;
    const itemsUsingMl = predictionValues.filter((p) => p.mlApplied).length;

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
      learning: {
        enabled: learningEnabled,
        mlLive: Boolean(activeMlModel),
        mlModelVersionId: activeMlModel ? Number(activeMlModel.id) : null,
        mlModelKey: activeMlModel?.model_key || null,
        mlModelDisplayName: activeMlModel?.display_name || null,
        historyDays: LEARNING_HISTORY_DAYS,
        maxSamplesPerItem: LEARNING_MAX_SAMPLES_PER_ITEM,
        confidenceSamples: LEARNING_CONFIDENCE_SAMPLES,
        ratioMin: LEARNING_RATIO_MIN,
        ratioMax: LEARNING_RATIO_MAX,
        weatherSensitivity: Math.round((Number(cafeData.weather_sensitivity || 1)) * 100) / 100,
        itemsWithHistory,
        itemsAdjusted,
        itemsUsingMl
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

    const ingredientIds = prepList
      .map((item) => parseInt(item.ingredientId, 10))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (ingredientIds.length > 0) {
      await client.query(
        `
          DELETE FROM prep_lists
          WHERE cafe_id = $1
            AND date = $2
            AND ingredient_id <> ALL($3::int[])
            AND actual_prepped_quantity IS NULL
        `,
        [cafeId, date, ingredientIds]
      );
    } else {
      await client.query(
        `
          DELETE FROM prep_lists
          WHERE cafe_id = $1
            AND date = $2
            AND actual_prepped_quantity IS NULL
        `,
        [cafeId, date]
      );
    }

    for (const item of prepList) {
      await client.query(
        `
        INSERT INTO prep_lists (
          cafe_id,
          date,
          ingredient_id,
          ingredient_name,
          station,
          quantity_needed,
          forecast_quantity,
          on_hand_quantity,
          net_quantity,
          unit,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (cafe_id, date, ingredient_id)
        DO UPDATE SET
          ingredient_name = EXCLUDED.ingredient_name,
          station = EXCLUDED.station,
          quantity_needed = EXCLUDED.quantity_needed,
          forecast_quantity = EXCLUDED.forecast_quantity,
          on_hand_quantity = EXCLUDED.on_hand_quantity,
          net_quantity = EXCLUDED.net_quantity,
          unit = EXCLUDED.unit,
          updated_at = NOW()
      `,
        [
          cafeId,
          date,
          item.ingredientId,
          item.name,
          item.station,
          item.netQty ?? item.totalNeeded ?? 0,
          item.forecastQty ?? item.totalNeeded ?? 0,
          item.onHandQty ?? 0,
          item.netQty ?? item.totalNeeded ?? 0,
          item.unit
        ]
      );
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
