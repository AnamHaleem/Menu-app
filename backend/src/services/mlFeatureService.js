const pool = require('../db/pool');

const DEFAULT_LOOKBACK_DAYS = Math.max(28, Number(process.env.ML_FEATURE_LOOKBACK_DAYS || 35));
const DEFAULT_BUILD_DAYS = Math.max(14, Number(process.env.ML_FEATURE_BUILD_DAYS || 90));

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
}

function isoDateFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeDbDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return isoDateFromDate(value);
  const raw = String(value).trim();
  if (!raw) return null;
  const leadingIso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(leadingIso)) return leadingIso;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return isoDateFromDate(parsed);
}

function shiftIsoDate(value, days) {
  const normalized = normalizeIsoDate(value);
  if (!normalized) return null;
  const date = new Date(`${normalized}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDateFromDate(date);
}

function buildDefaultRange(days = DEFAULT_BUILD_DAYS) {
  const endDate = isoDateFromDate(new Date());
  return {
    startDate: shiftIsoDate(endDate, -(Math.max(1, days) - 1)),
    endDate
  };
}

function enumerateIsoDates(startDate, endDate) {
  const safeStart = normalizeIsoDate(startDate);
  const safeEnd = normalizeIsoDate(endDate);
  if (!safeStart || !safeEnd || safeStart > safeEnd) return [];

  const dates = [];
  const cursor = new Date(`${safeStart}T12:00:00`);
  const boundary = new Date(`${safeEnd}T12:00:00`);
  while (cursor <= boundary) {
    dates.push(isoDateFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getIsoWeekNumber(value) {
  const normalized = normalizeIsoDate(value);
  if (!normalized) return 0;
  const date = new Date(`${normalized}T12:00:00`);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
}

function createMapKey(...parts) {
  return parts.join(':');
}

function average(numbers) {
  const valid = numbers.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sum(numbers) {
  return numbers.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function roundNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getWeatherBucket(condition, tempC) {
  const normalized = String(condition || '').trim().toLowerCase();
  if (normalized.includes('snow')) return 'snow';
  if (normalized.includes('rain') || normalized.includes('drizzle') || normalized.includes('thunder')) return 'wet';
  if (normalized.includes('clear') && tempC >= 20) return 'hot-clear';
  if (normalized.includes('clear')) return 'clear';
  if (normalized.includes('cloud')) return 'cloudy';
  if (tempC <= 0) return 'cold';
  return normalized || 'unknown';
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escapeCell = (value) => {
    if (value === null || value === undefined) return '';
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/[,"\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(','))
  ].join('\n');
}

async function createTrainingRun(client, { cafeId = null, requestedBy = null, source = 'manual_api', startDate, endDate }) {
  const result = await client.query(
    `
      INSERT INTO ml_training_runs (
        cafe_id,
        requested_by,
        source,
        run_type,
        status,
        range_start,
        range_end,
        started_at,
        created_at,
        updated_at,
        config
      )
      VALUES ($1, $2, $3, 'feature_build', 'running', $4, $5, NOW(), NOW(), NOW(), $6::jsonb)
      RETURNING *
    `,
    [
      cafeId,
      requestedBy,
      source,
      startDate,
      endDate,
      JSON.stringify({ featureLookbackDays: DEFAULT_LOOKBACK_DAYS })
    ]
  );
  return result.rows[0];
}

async function finalizeTrainingRun(client, trainingRunId, payload = {}) {
  if (!trainingRunId) return null;
  const {
    status = 'completed',
    featureRowsBuilt = 0,
    cafesProcessed = 0,
    itemsProcessed = 0,
    errorMessage = null,
    metrics = null
  } = payload;

  const result = await client.query(
    `
      UPDATE ml_training_runs
      SET status = $2,
          feature_rows_built = $3,
          cafes_processed = $4,
          items_processed = $5,
          error_message = $6,
          metrics = COALESCE($7::jsonb, metrics),
          finished_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      trainingRunId,
      status,
      featureRowsBuilt,
      cafesProcessed,
      itemsProcessed,
      errorMessage,
      metrics ? JSON.stringify(metrics) : null
    ]
  );

  return result.rows[0] || null;
}

async function upsertFeatureRows(client, rows) {
  if (!rows.length) return 0;

  await client.query(
    `
      INSERT INTO ml_daily_features (
        cafe_id,
        feature_date,
        item_id,
        item_name,
        item_category,
        actual_qty,
        revenue,
        tx_count,
        avg_price,
        lag_qty_1d,
        lag_qty_7d,
        avg_qty_7d,
        avg_qty_14d,
        avg_qty_28d,
        avg_qty_same_weekday_4w,
        rolling_revenue_7d,
        day_of_week,
        iso_week,
        month_of_year,
        is_weekend,
        is_holiday,
        holiday_name,
        weather_condition,
        temp_c,
        weather_bucket,
        learning_multiplier,
        learning_samples,
        ai_recent_7d_rate,
        prep_days_last_7d,
        waste_value_last_7d,
        items_86_last_7d,
        stockout_flag,
        latest_forecast_qty,
        latest_base_forecast_qty,
        source_window_start,
        source_window_end,
        feature_payload,
        updated_at
      )
      SELECT
        x.cafe_id,
        x.feature_date::date,
        x.item_id,
        x.item_name,
        x.item_category,
        x.actual_qty,
        x.revenue,
        x.tx_count,
        x.avg_price,
        x.lag_qty_1d,
        x.lag_qty_7d,
        x.avg_qty_7d,
        x.avg_qty_14d,
        x.avg_qty_28d,
        x.avg_qty_same_weekday_4w,
        x.rolling_revenue_7d,
        x.day_of_week,
        x.iso_week,
        x.month_of_year,
        x.is_weekend,
        x.is_holiday,
        x.holiday_name,
        x.weather_condition,
        x.temp_c,
        x.weather_bucket,
        x.learning_multiplier,
        x.learning_samples,
        x.ai_recent_7d_rate,
        x.prep_days_last_7d,
        x.waste_value_last_7d,
        x.items_86_last_7d,
        x.stockout_flag,
        x.latest_forecast_qty,
        x.latest_base_forecast_qty,
        x.source_window_start::date,
        x.source_window_end::date,
        x.feature_payload,
        NOW()
      FROM json_to_recordset($1::json) AS x(
        cafe_id int,
        feature_date text,
        item_id int,
        item_name text,
        item_category text,
        actual_qty numeric,
        revenue numeric,
        tx_count int,
        avg_price numeric,
        lag_qty_1d numeric,
        lag_qty_7d numeric,
        avg_qty_7d numeric,
        avg_qty_14d numeric,
        avg_qty_28d numeric,
        avg_qty_same_weekday_4w numeric,
        rolling_revenue_7d numeric,
        day_of_week int,
        iso_week int,
        month_of_year int,
        is_weekend boolean,
        is_holiday boolean,
        holiday_name text,
        weather_condition text,
        temp_c numeric,
        weather_bucket text,
        learning_multiplier numeric,
        learning_samples int,
        ai_recent_7d_rate numeric,
        prep_days_last_7d int,
        waste_value_last_7d numeric,
        items_86_last_7d int,
        stockout_flag boolean,
        latest_forecast_qty numeric,
        latest_base_forecast_qty numeric,
        source_window_start text,
        source_window_end text,
        feature_payload jsonb
      )
      ON CONFLICT (cafe_id, feature_date, item_id)
      DO UPDATE SET
        item_name = EXCLUDED.item_name,
        item_category = EXCLUDED.item_category,
        actual_qty = EXCLUDED.actual_qty,
        revenue = EXCLUDED.revenue,
        tx_count = EXCLUDED.tx_count,
        avg_price = EXCLUDED.avg_price,
        lag_qty_1d = EXCLUDED.lag_qty_1d,
        lag_qty_7d = EXCLUDED.lag_qty_7d,
        avg_qty_7d = EXCLUDED.avg_qty_7d,
        avg_qty_14d = EXCLUDED.avg_qty_14d,
        avg_qty_28d = EXCLUDED.avg_qty_28d,
        avg_qty_same_weekday_4w = EXCLUDED.avg_qty_same_weekday_4w,
        rolling_revenue_7d = EXCLUDED.rolling_revenue_7d,
        day_of_week = EXCLUDED.day_of_week,
        iso_week = EXCLUDED.iso_week,
        month_of_year = EXCLUDED.month_of_year,
        is_weekend = EXCLUDED.is_weekend,
        is_holiday = EXCLUDED.is_holiday,
        holiday_name = EXCLUDED.holiday_name,
        weather_condition = EXCLUDED.weather_condition,
        temp_c = EXCLUDED.temp_c,
        weather_bucket = EXCLUDED.weather_bucket,
        learning_multiplier = EXCLUDED.learning_multiplier,
        learning_samples = EXCLUDED.learning_samples,
        ai_recent_7d_rate = EXCLUDED.ai_recent_7d_rate,
        prep_days_last_7d = EXCLUDED.prep_days_last_7d,
        waste_value_last_7d = EXCLUDED.waste_value_last_7d,
        items_86_last_7d = EXCLUDED.items_86_last_7d,
        stockout_flag = EXCLUDED.stockout_flag,
        latest_forecast_qty = EXCLUDED.latest_forecast_qty,
        latest_base_forecast_qty = EXCLUDED.latest_base_forecast_qty,
        source_window_start = EXCLUDED.source_window_start,
        source_window_end = EXCLUDED.source_window_end,
        feature_payload = EXCLUDED.feature_payload,
        updated_at = NOW()
    `,
    [JSON.stringify(rows)]
  );

  return rows.length;
}

async function buildFeatureStore(options = {}) {
  const defaultRange = buildDefaultRange();
  const startDate = normalizeIsoDate(options.startDate) || defaultRange.startDate;
  const endDate = normalizeIsoDate(options.endDate) || defaultRange.endDate;
  const requestedCafeId = options.cafeId === null || options.cafeId === undefined || options.cafeId === ''
    ? null
    : Number.isInteger(Number(options.cafeId))
      ? Number(options.cafeId)
      : null;
  const requestedBy = options.requestedBy || null;
  const source = String(options.source || 'manual_api').trim() || 'manual_api';

  if (!startDate || !endDate || startDate > endDate) {
    throw new Error('A valid date range is required to build ML features.');
  }

  const lookbackStart = shiftIsoDate(startDate, -DEFAULT_LOOKBACK_DAYS);
  const fullDates = enumerateIsoDates(lookbackStart, endDate);
  const targetDates = enumerateIsoDates(startDate, endDate);

  const client = await pool.connect();
  let trainingRun = null;

  try {
    trainingRun = await createTrainingRun(client, {
      cafeId: requestedCafeId,
      requestedBy,
      source,
      startDate,
      endDate
    });
    await client.query('BEGIN');

    const cafesResult = await client.query(
      `
        SELECT id, name, city, holiday_behaviour
        FROM cafes
        WHERE active = true
          AND ($1::int IS NULL OR id = $1)
        ORDER BY id
      `,
      [requestedCafeId]
    );
    const cafes = cafesResult.rows;
    if (!cafes.length) {
      await finalizeTrainingRun(client, trainingRun.id, {
        status: 'completed',
        featureRowsBuilt: 0,
        cafesProcessed: 0,
        itemsProcessed: 0,
        metrics: { startDate, endDate, lookbackStart, note: 'No active cafes matched the request.' }
      });
      await client.query('COMMIT');
      return {
        trainingRunId: trainingRun.id,
        startDate,
        endDate,
        lookbackStart,
        cafesProcessed: 0,
        itemsProcessed: 0,
        featureRowsBuilt: 0
      };
    }

    const cafeIds = cafes.map((row) => row.id);
    const [itemsResult, txResult, weatherResult, holidaysResult, dailyLogsResult, forecastResult, learningResult] =
      await Promise.all([
        client.query(
          `
            SELECT id, cafe_id, name, category, price
            FROM items
            WHERE active = true
              AND cafe_id = ANY($1::int[])
            ORDER BY cafe_id, id
          `,
          [cafeIds]
        ),
        client.query(
          `
            SELECT
              t.cafe_id,
              COALESCE(t.item_id, i.id) AS item_id,
              t.date::date AS tx_date,
              SUM(t.quantity)::numeric AS quantity,
              SUM(COALESCE(t.revenue, 0))::numeric AS revenue,
              COUNT(*)::int AS tx_count
            FROM transactions t
            LEFT JOIN items i
              ON i.cafe_id = t.cafe_id
             AND LOWER(TRIM(i.name)) = LOWER(TRIM(t.item_name))
            WHERE t.cafe_id = ANY($1::int[])
              AND t.date >= $2::date
              AND t.date <= $3::date
              AND COALESCE(t.item_id, i.id) IS NOT NULL
            GROUP BY t.cafe_id, COALESCE(t.item_id, i.id), t.date::date
          `,
          [cafeIds, lookbackStart, endDate]
        ),
        client.query(
          `
            SELECT cafe_id, date::date AS weather_date, condition, temp_c
            FROM weather_logs
            WHERE cafe_id = ANY($1::int[])
              AND date >= $2::date
              AND date <= $3::date
          `,
          [cafeIds, startDate, endDate]
        ),
        client.query(
          `
            SELECT holiday_date::date AS holiday_date, holiday_name, province
            FROM holidays
            WHERE holiday_date >= $1::date
              AND holiday_date <= $2::date
          `,
          [startDate, endDate]
        ),
        client.query(
          `
            SELECT
              cafe_id,
              date::date AS log_date,
              waste_value,
              items_86d
            FROM daily_logs
            WHERE cafe_id = ANY($1::int[])
              AND date >= $2::date
              AND date <= $3::date
          `,
          [cafeIds, lookbackStart, endDate]
        ),
        client.query(
          `
            SELECT
              cafe_id,
              item_id,
              forecast_date::date AS forecast_date,
              predicted_qty,
              base_predicted_qty,
              learning_multiplier,
              ai_applied
            FROM forecast_item_actuals
            WHERE cafe_id = ANY($1::int[])
              AND forecast_date >= $2::date
              AND forecast_date <= $3::date
          `,
          [cafeIds, lookbackStart, endDate]
        ),
        client.query(
          `
            SELECT cafe_id, item_id, multiplier, samples
            FROM item_learning_state
            WHERE cafe_id = ANY($1::int[])
          `,
          [cafeIds]
        )
      ]);

    const itemsByCafe = new Map();
    for (const row of itemsResult.rows) {
      const existing = itemsByCafe.get(row.cafe_id) || [];
      existing.push({
        id: Number(row.id),
        cafeId: Number(row.cafe_id),
        name: row.name,
        category: row.category || 'Uncategorized',
        price: toNumber(row.price, 0)
      });
      itemsByCafe.set(row.cafe_id, existing);
    }

    const txByKey = new Map();
    for (const row of txResult.rows) {
      const txDate = normalizeDbDateValue(row.tx_date);
      if (!txDate) continue;
      txByKey.set(
        createMapKey(row.cafe_id, row.item_id, txDate),
        {
          quantity: toNumber(row.quantity, 0),
          revenue: toNumber(row.revenue, 0),
          txCount: toNumber(row.tx_count, 0)
        }
      );
    }

    const weatherByKey = new Map();
    for (const row of weatherResult.rows) {
      const weatherDate = normalizeDbDateValue(row.weather_date);
      if (!weatherDate) continue;
      weatherByKey.set(
        createMapKey(row.cafe_id, weatherDate),
        {
          condition: row.condition || null,
          tempC: row.temp_c === null || row.temp_c === undefined ? null : toNumber(row.temp_c, 0)
        }
      );
    }

    const holidayByDate = new Map();
    for (const row of holidaysResult.rows) {
      const key = normalizeDbDateValue(row.holiday_date);
      if (!key) continue;
      if (!holidayByDate.has(key)) {
        holidayByDate.set(key, {
          holidayName: row.holiday_name,
          province: row.province || 'ON'
        });
      }
    }

    const dailyByKey = new Map();
    for (const row of dailyLogsResult.rows) {
      const logDate = normalizeDbDateValue(row.log_date);
      if (!logDate) continue;
      dailyByKey.set(
        createMapKey(row.cafe_id, logDate),
        {
          hasLog: true,
          wasteValue: toNumber(row.waste_value, 0),
          items86d: toNumber(row.items_86d, 0)
        }
      );
    }

    const forecastByKey = new Map();
    for (const row of forecastResult.rows) {
      const forecastDate = normalizeDbDateValue(row.forecast_date);
      if (!forecastDate) continue;
      forecastByKey.set(
        createMapKey(row.cafe_id, row.item_id, forecastDate),
        {
          predictedQty: toNumber(row.predicted_qty, 0),
          basePredictedQty: toNumber(row.base_predicted_qty, 0),
          learningMultiplier: toNumber(row.learning_multiplier, 1),
          aiApplied: Boolean(row.ai_applied)
        }
      );
    }

    const learningByKey = new Map();
    for (const row of learningResult.rows) {
      learningByKey.set(createMapKey(row.cafe_id, row.item_id), {
        multiplier: toNumber(row.multiplier, 1),
        samples: toNumber(row.samples, 0)
      });
    }

    let itemsProcessed = 0;
    let inserted = 0;
    let pendingRows = [];
    const batchSize = 250;

    for (const cafe of cafes) {
      const items = itemsByCafe.get(cafe.id) || [];
      if (!items.length) continue;
      itemsProcessed += items.length;

      for (const item of items) {
        const qtySeries = [];
        const revenueSeries = [];
        const aiAppliedSeries = [];
        const prepDaysSeries = [];
        const wasteSeries = [];
        const items86Series = [];
        const perDateSnapshots = [];

        for (const date of fullDates) {
          const txEntry = txByKey.get(createMapKey(cafe.id, item.id, date)) || { quantity: 0, revenue: 0, txCount: 0 };
          const dailyEntry = dailyByKey.get(createMapKey(cafe.id, date)) || { hasLog: false, wasteValue: 0, items86d: 0 };
          const forecastEntry = forecastByKey.get(createMapKey(cafe.id, item.id, date)) || null;

          qtySeries.push(txEntry.quantity);
          revenueSeries.push(txEntry.revenue);
          aiAppliedSeries.push(forecastEntry?.aiApplied ? 1 : 0);
          prepDaysSeries.push(dailyEntry.hasLog ? 1 : 0);
          wasteSeries.push(dailyEntry.wasteValue);
          items86Series.push(dailyEntry.items86d);
          perDateSnapshots.push({
            date,
            txEntry,
            dailyEntry,
            forecastEntry
          });
        }

        for (let index = DEFAULT_LOOKBACK_DAYS; index < perDateSnapshots.length; index += 1) {
          const snapshot = perDateSnapshots[index];
          if (snapshot.date < startDate || snapshot.date > endDate) continue;

          const weather = weatherByKey.get(createMapKey(cafe.id, snapshot.date)) || null;
          const holiday = holidayByDate.get(snapshot.date) || null;
          const learningState = learningByKey.get(createMapKey(cafe.id, item.id)) || { multiplier: 1, samples: 0 };

          const prev7Qty = qtySeries.slice(Math.max(0, index - 7), index);
          const prev14Qty = qtySeries.slice(Math.max(0, index - 14), index);
          const prev28Qty = qtySeries.slice(Math.max(0, index - 28), index);
          const prev7Revenue = revenueSeries.slice(Math.max(0, index - 7), index);
          const prev7Ai = aiAppliedSeries.slice(Math.max(0, index - 7), index);
          const prev7PrepDays = prepDaysSeries.slice(Math.max(0, index - 7), index);
          const prev7Waste = wasteSeries.slice(Math.max(0, index - 7), index);
          const prev7Items86 = items86Series.slice(Math.max(0, index - 7), index);

          const sameWeekdaySamples = [7, 14, 21, 28]
            .map((offset) => (index - offset >= 0 ? qtySeries[index - offset] : null))
            .filter((value) => value !== null);

          const sourceWindowEnd = shiftIsoDate(snapshot.date, -1);
          const sourceWindowStart = shiftIsoDate(snapshot.date, -DEFAULT_LOOKBACK_DAYS);
          const actualQty = snapshot.txEntry.quantity;
          const avgPrice = actualQty > 0
            ? snapshot.txEntry.revenue / actualQty
            : item.price;

          const dateObject = new Date(`${snapshot.date}T12:00:00`);
          const featurePayload = {
            generatedFrom: source,
            cafeCity: cafe.city || null,
            holidayBehaviour: cafe.holiday_behaviour || null,
            normalizedItemName: item.name.trim().toLowerCase(),
            hasWeatherLog: Boolean(weather),
            hasForecastSnapshot: Boolean(snapshot.forecastEntry)
          };

          pendingRows.push({
            cafe_id: cafe.id,
            feature_date: snapshot.date,
            item_id: item.id,
            item_name: item.name,
            item_category: item.category,
            actual_qty: roundNumber(actualQty, 4),
            revenue: roundNumber(snapshot.txEntry.revenue, 4),
            tx_count: snapshot.txEntry.txCount,
            avg_price: roundNumber(avgPrice, 4),
            lag_qty_1d: roundNumber(qtySeries[index - 1] || 0, 4),
            lag_qty_7d: roundNumber(index - 7 >= 0 ? qtySeries[index - 7] || 0 : 0, 4),
            avg_qty_7d: roundNumber(average(prev7Qty), 4),
            avg_qty_14d: roundNumber(average(prev14Qty), 4),
            avg_qty_28d: roundNumber(average(prev28Qty), 4),
            avg_qty_same_weekday_4w: roundNumber(average(sameWeekdaySamples), 4),
            rolling_revenue_7d: roundNumber(sum(prev7Revenue), 4),
            day_of_week: Number(dateObject.getUTCDay() === 0 ? 7 : dateObject.getUTCDay()),
            iso_week: getIsoWeekNumber(snapshot.date),
            month_of_year: dateObject.getUTCMonth() + 1,
            is_weekend: [0, 6].includes(dateObject.getUTCDay()),
            is_holiday: Boolean(holiday),
            holiday_name: holiday?.holidayName || null,
            weather_condition: weather?.condition || null,
            temp_c: weather?.tempC,
            weather_bucket: getWeatherBucket(weather?.condition, weather?.tempC),
            learning_multiplier: roundNumber(snapshot.forecastEntry?.learningMultiplier || learningState.multiplier || 1, 4),
            learning_samples: learningState.samples || 0,
            ai_recent_7d_rate: roundNumber(average(prev7Ai), 4),
            prep_days_last_7d: Number(sum(prev7PrepDays)),
            waste_value_last_7d: roundNumber(sum(prev7Waste), 4),
            items_86_last_7d: Number(sum(prev7Items86)),
            stockout_flag: Number(snapshot.dailyEntry.items86d || 0) > 0,
            latest_forecast_qty: snapshot.forecastEntry ? roundNumber(snapshot.forecastEntry.predictedQty, 4) : null,
            latest_base_forecast_qty: snapshot.forecastEntry ? roundNumber(snapshot.forecastEntry.basePredictedQty, 4) : null,
            source_window_start: sourceWindowStart,
            source_window_end: sourceWindowEnd,
            feature_payload: featurePayload
          });

          if (pendingRows.length >= batchSize) {
            inserted += await upsertFeatureRows(client, pendingRows);
            pendingRows = [];
          }
        }
      }
    }

    if (pendingRows.length) {
      inserted += await upsertFeatureRows(client, pendingRows);
    }

    const metrics = {
      startDate,
      endDate,
      lookbackStart,
      featureLookbackDays: DEFAULT_LOOKBACK_DAYS,
      cafesProcessed: cafes.length,
      itemsProcessed,
      featureRowsBuilt: inserted
    };

    await finalizeTrainingRun(client, trainingRun.id, {
      status: 'completed',
      featureRowsBuilt: inserted,
      cafesProcessed: cafes.length,
      itemsProcessed,
      metrics
    });
    await client.query('COMMIT');

    return {
      trainingRunId: trainingRun.id,
      ...metrics
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (trainingRun?.id) {
      await finalizeTrainingRun(client, trainingRun.id, {
        status: 'failed',
        errorMessage: err.message || 'Feature build failed'
      }).catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getFeatureStoreSummary(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  const cafeId = Number.isInteger(Number(options.cafeId)) ? Number(options.cafeId) : null;

  const clauses = [];
  const values = [];
  let index = 1;

  if (cafeId !== null) {
    clauses.push(`cafe_id = $${index++}`);
    values.push(cafeId);
  }
  if (startDate) {
    clauses.push(`feature_date >= $${index++}::date`);
    values.push(startDate);
  }
  if (endDate) {
    clauses.push(`feature_date <= $${index++}::date`);
    values.push(endDate);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [summaryResult, runsResult] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS feature_rows,
          COUNT(DISTINCT cafe_id)::int AS cafes_covered,
          COUNT(DISTINCT item_id)::int AS items_covered,
          MIN(feature_date)::text AS first_feature_date,
          MAX(feature_date)::text AS last_feature_date,
          AVG(actual_qty)::numeric AS avg_actual_qty,
          AVG(avg_qty_28d)::numeric AS avg_28d_qty,
          AVG(ai_recent_7d_rate)::numeric AS avg_ai_recent_7d_rate
        FROM ml_daily_features
        ${whereClause}
      `,
      values
    ),
    pool.query(
      `
        SELECT
          id,
          cafe_id,
          status,
          requested_by,
          source,
          run_type,
          range_start::text AS range_start,
          range_end::text AS range_end,
          feature_rows_built,
          cafes_processed,
          items_processed,
          error_message,
          started_at,
          finished_at,
          created_at,
          metrics
        FROM ml_training_runs
        ORDER BY created_at DESC
        LIMIT 15
      `
    )
  ]);

  const summary = summaryResult.rows[0] || {};
  return {
    summary: {
      featureRows: toNumber(summary.feature_rows, 0),
      cafesCovered: toNumber(summary.cafes_covered, 0),
      itemsCovered: toNumber(summary.items_covered, 0),
      firstFeatureDate: summary.first_feature_date || null,
      lastFeatureDate: summary.last_feature_date || null,
      avgActualQty: roundNumber(summary.avg_actual_qty, 4),
      avg28dQty: roundNumber(summary.avg_28d_qty, 4),
      avgAiRecent7dRate: roundNumber(summary.avg_ai_recent_7d_rate, 4)
    },
    recentRuns: runsResult.rows
  };
}

async function listFeatureRows(options = {}) {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  const cafeId = Number.isInteger(Number(options.cafeId)) ? Number(options.cafeId) : null;
  const limit = Math.min(1000, Math.max(1, Number(options.limit) || 200));

  const clauses = [];
  const values = [];
  let index = 1;

  if (cafeId !== null) {
    clauses.push(`mlf.cafe_id = $${index++}`);
    values.push(cafeId);
  }
  if (startDate) {
    clauses.push(`mlf.feature_date >= $${index++}::date`);
    values.push(startDate);
  }
  if (endDate) {
    clauses.push(`mlf.feature_date <= $${index++}::date`);
    values.push(endDate);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);

  const result = await pool.query(
    `
      SELECT
        mlf.cafe_id,
        c.name AS cafe_name,
        mlf.feature_date::text AS feature_date,
        mlf.item_id,
        mlf.item_name,
        mlf.item_category,
        mlf.actual_qty,
        mlf.revenue,
        mlf.tx_count,
        mlf.avg_price,
        mlf.lag_qty_1d,
        mlf.lag_qty_7d,
        mlf.avg_qty_7d,
        mlf.avg_qty_14d,
        mlf.avg_qty_28d,
        mlf.avg_qty_same_weekday_4w,
        mlf.rolling_revenue_7d,
        mlf.day_of_week,
        mlf.iso_week,
        mlf.month_of_year,
        mlf.is_weekend,
        mlf.is_holiday,
        mlf.holiday_name,
        mlf.weather_condition,
        mlf.temp_c,
        mlf.weather_bucket,
        mlf.learning_multiplier,
        mlf.learning_samples,
        mlf.ai_recent_7d_rate,
        mlf.prep_days_last_7d,
        mlf.waste_value_last_7d,
        mlf.items_86_last_7d,
        mlf.stockout_flag,
        mlf.latest_forecast_qty,
        mlf.latest_base_forecast_qty,
        mlf.source_window_start::text AS source_window_start,
        mlf.source_window_end::text AS source_window_end,
        mlf.feature_payload,
        mlf.updated_at
      FROM ml_daily_features mlf
      JOIN cafes c ON c.id = mlf.cafe_id
      ${whereClause}
      ORDER BY mlf.feature_date DESC, mlf.cafe_id ASC, mlf.item_name ASC
      LIMIT $${index}
    `,
    values
  );

  return result.rows;
}

async function exportFeatureRowsCsv(options = {}) {
  const rows = await listFeatureRows({
    ...options,
    limit: Math.min(5000, Math.max(1, Number(options.limit) || 5000))
  });
  return toCsv(rows);
}

module.exports = {
  buildFeatureStore,
  getFeatureStoreSummary,
  listFeatureRows,
  exportFeatureRowsCsv
};
