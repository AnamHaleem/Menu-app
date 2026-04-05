const pool = require('../db/pool');

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IMPORT_ROWS = 10000;

function createHttpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw || !ISO_DATE_PATTERN.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
}

function isoDateFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toKey(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function averageNumbers(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function normalizeMetadata(value) {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value === 'object') return value;

  const stringValue = String(value).trim();
  if (!stringValue) return {};

  try {
    return JSON.parse(stringValue);
  } catch {
    return { raw: stringValue };
  }
}

async function fetchModelVersionById(modelVersionId, client = pool) {
  const result = await client.query(
    `SELECT * FROM ml_model_versions WHERE id = $1 LIMIT 1`,
    [modelVersionId]
  );
  return result.rows[0] || null;
}

async function upsertModelVersion(input = {}, client = pool) {
  const modelKey = String(input.modelKey || input.model_key || '').trim();
  if (!modelKey) {
    throw createHttpError(400, 'modelKey is required');
  }

  const displayName = String(input.displayName || input.display_name || modelKey).trim();
  const modelFamily = String(input.modelFamily || input.model_family || 'custom-shadow').trim() || 'custom-shadow';
  const requestedStatus = String(input.status || 'shadow').trim().toLowerCase();
  const allowedStatuses = new Set(['draft', 'shadow', 'active', 'archived']);
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : 'shadow';
  const featureSpec = input.featureSpec || input.feature_spec || {};
  const metrics = input.metrics || {};
  const notes = String(input.notes || '').trim() || null;
  const trainedRangeStart = normalizeIsoDate(input.trainedRangeStart || input.trained_range_start);
  const trainedRangeEnd = normalizeIsoDate(input.trainedRangeEnd || input.trained_range_end);
  const trainingRows = Math.max(0, Number(input.trainingRows || input.training_rows || 0) || 0);

  const result = await client.query(
    `
      INSERT INTO ml_model_versions (
        model_key,
        display_name,
        model_family,
        status,
        feature_spec,
        metrics,
        notes,
        trained_range_start,
        trained_range_end,
        training_rows,
        created_at,
        activated_at
      )
      VALUES ($1::text, $2::text, $3::text, $4::text, $5::jsonb, $6::jsonb, $7::text, $8::date, $9::date, $10::int, NOW(), CASE WHEN $4::text = 'active' THEN NOW() ELSE NULL END)
      ON CONFLICT (model_key)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        model_family = EXCLUDED.model_family,
        status = EXCLUDED.status,
        feature_spec = CASE WHEN EXCLUDED.feature_spec = '{}'::jsonb THEN ml_model_versions.feature_spec ELSE EXCLUDED.feature_spec END,
        metrics = CASE WHEN EXCLUDED.metrics = '{}'::jsonb THEN ml_model_versions.metrics ELSE EXCLUDED.metrics END,
        notes = COALESCE(EXCLUDED.notes, ml_model_versions.notes),
        trained_range_start = COALESCE(EXCLUDED.trained_range_start, ml_model_versions.trained_range_start),
        trained_range_end = COALESCE(EXCLUDED.trained_range_end, ml_model_versions.trained_range_end),
        training_rows = GREATEST(EXCLUDED.training_rows, ml_model_versions.training_rows),
        activated_at = CASE
          WHEN EXCLUDED.status = 'active' AND ml_model_versions.activated_at IS NULL THEN NOW()
          ELSE ml_model_versions.activated_at
        END
      RETURNING *
    `,
    [
      modelKey,
      displayName,
      modelFamily,
      status,
      JSON.stringify(featureSpec || {}),
      JSON.stringify(metrics || {}),
      notes,
      trainedRangeStart,
      trainedRangeEnd,
      trainingRows
    ]
  );

  return result.rows[0];
}

async function createShadowImportRun(client, { modelVersionId = null, cafeId = null, requestedBy = null, source = 'manual_api', startDate = null, endDate = null, config = {} }) {
  const result = await client.query(
    `
      INSERT INTO ml_training_runs (
        model_version_id,
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
      VALUES ($1::int, $2::int, $3::text, $4::text, 'shadow_prediction_import', 'running', $5::date, $6::date, NOW(), NOW(), NOW(), $7::jsonb)
      RETURNING *
    `,
    [modelVersionId, cafeId, requestedBy, source, startDate, endDate, JSON.stringify(config || {})]
  );

  return result.rows[0] || null;
}

async function finalizeShadowImportRun(client, trainingRunId, payload = {}) {
  if (!trainingRunId) return null;

  const result = await client.query(
    `
      UPDATE ml_training_runs
      SET status = $2::text,
          cafes_processed = $3::int,
          items_processed = $4::int,
          predictions_written = $5::int,
          error_message = $6::text,
          metrics = COALESCE($7::jsonb, metrics),
          finished_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      trainingRunId,
      payload.status || 'completed',
      Math.max(0, Number(payload.cafesProcessed || 0) || 0),
      Math.max(0, Number(payload.itemsProcessed || 0) || 0),
      Math.max(0, Number(payload.predictionsWritten || 0) || 0),
      payload.errorMessage || null,
      payload.metrics ? JSON.stringify(payload.metrics) : null
    ]
  );

  return result.rows[0] || null;
}

function buildShadowRowKey(modelVersionId, cafeId, predictionDate, itemId) {
  return [modelVersionId, cafeId, predictionDate, itemId].join(':');
}

async function importShadowPredictions(options = {}) {
  const rawPredictions = Array.isArray(options.predictions) ? options.predictions : [];
  if (!rawPredictions.length) {
    throw createHttpError(400, 'predictions must be a non-empty array');
  }
  if (rawPredictions.length > MAX_IMPORT_ROWS) {
    throw createHttpError(400, `predictions cannot exceed ${MAX_IMPORT_ROWS} rows per import`);
  }

  const providedCafeId = options.cafeId === null || options.cafeId === undefined || options.cafeId === ''
    ? null
    : parseInt(options.cafeId, 10);
  if (options.cafeId !== null && options.cafeId !== undefined && options.cafeId !== '' && Number.isNaN(providedCafeId)) {
    throw createHttpError(400, 'cafeId must be a valid number');
  }

  const source = String(options.source || 'shadow_import').trim() || 'shadow_import';
  const requestedBy = String(options.requestedBy || '').trim() || null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let modelVersion = null;
    if (options.modelVersionId) {
      const parsedId = parseInt(options.modelVersionId, 10);
      if (Number.isNaN(parsedId)) {
        throw createHttpError(400, 'modelVersionId must be a valid number');
      }
      modelVersion = await fetchModelVersionById(parsedId, client);
      if (!modelVersion) {
        throw createHttpError(404, 'Model version not found');
      }
    } else {
      modelVersion = await upsertModelVersion(options.modelVersion || options, client);
    }

    const explicitCafeIds = rawPredictions
      .map((row) => parseInt(row.cafeId ?? row.cafe_id, 10))
      .filter((value) => Number.isFinite(value));
    const cafeIds = Array.from(new Set([providedCafeId, ...explicitCafeIds].filter((value) => Number.isFinite(value))));
    if (!cafeIds.length) {
      throw createHttpError(400, 'Each prediction must include cafeId, or a top-level cafeId must be provided');
    }

    const itemsResult = await client.query(
      `
        SELECT id, cafe_id, LOWER(TRIM(name)) AS normalized_name
        FROM items
        WHERE cafe_id = ANY($1::int[])
          AND active = true
      `,
      [cafeIds]
    );

    const itemCafeById = new Map();
    const itemIdByCafeName = new Map();
    itemsResult.rows.forEach((row) => {
      itemCafeById.set(Number(row.id), Number(row.cafe_id));
      itemIdByCafeName.set(`${row.cafe_id}:${row.normalized_name}`, Number(row.id));
    });

    const dateCandidates = [];
    const normalizedRows = [];
    const invalidSamples = [];
    const cafesTouched = new Set();
    const itemsTouched = new Set();
    const seenKeys = new Set();
    let invalidSkipped = 0;
    let payloadDuplicatesSkipped = 0;

    rawPredictions.forEach((row, index) => {
      const cafeId = providedCafeId || parseInt(row.cafeId ?? row.cafe_id, 10);
      const predictionDate = normalizeIsoDate(row.predictionDate || row.prediction_date || row.feature_date || row.date);
      const predictedQty = toNumberOrNull(row.predictedQty ?? row.predicted_qty ?? row.prediction ?? row.yhat);
      const lowerBoundQty = toNumberOrNull(row.lowerBoundQty ?? row.lower_bound_qty ?? row.yhat_lower ?? row.lower_bound);
      const upperBoundQty = toNumberOrNull(row.upperBoundQty ?? row.upper_bound_qty ?? row.yhat_upper ?? row.upper_bound);
      const confidenceScore = toNumberOrNull(row.confidenceScore ?? row.confidence_score ?? row.confidence);
      const sourceOverride = String(row.source || source).trim() || source;
      const itemName = String(row.itemName || row.item_name || '').trim();
      let itemId = row.itemId ?? row.item_id;
      itemId = itemId === null || itemId === undefined || itemId === '' ? null : parseInt(itemId, 10);

      if (!Number.isFinite(cafeId) || !predictionDate || predictedQty === null) {
        invalidSkipped += 1;
        if (invalidSamples.length < 10) {
          invalidSamples.push({ index, reason: 'Missing cafeId, predictionDate, or predictedQty', row });
        }
        return;
      }

      if (!Number.isFinite(itemId)) {
        const lookupId = itemName ? itemIdByCafeName.get(`${cafeId}:${toKey(itemName)}`) : null;
        itemId = Number.isFinite(lookupId) ? lookupId : null;
      }

      if (!Number.isFinite(itemId) || itemCafeById.get(itemId) !== cafeId) {
        invalidSkipped += 1;
        if (invalidSamples.length < 10) {
          invalidSamples.push({ index, reason: 'Could not resolve item to an active cafe item', cafeId, itemId, itemName, row });
        }
        return;
      }

      const lookupKey = buildShadowRowKey(modelVersion.id, cafeId, predictionDate, itemId);
      if (seenKeys.has(lookupKey)) {
        payloadDuplicatesSkipped += 1;
        return;
      }
      seenKeys.add(lookupKey);

      dateCandidates.push(predictionDate);
      cafesTouched.add(cafeId);
      itemsTouched.add(itemId);

      normalizedRows.push({
        model_version_id: modelVersion.id,
        training_run_id: null,
        cafe_id: cafeId,
        prediction_date: predictionDate,
        item_id: itemId,
        predicted_qty: roundNumber(predictedQty),
        lower_bound_qty: lowerBoundQty === null ? null : roundNumber(lowerBoundQty),
        upper_bound_qty: upperBoundQty === null ? null : roundNumber(upperBoundQty),
        confidence_score: confidenceScore === null ? null : roundNumber(confidenceScore),
        source: sourceOverride,
        metadata: normalizeMetadata(row.metadata || { item_name: itemName || null })
      });
    });

    if (!normalizedRows.length) {
      throw createHttpError(400, 'No valid prediction rows were provided');
    }

    const orderedDates = dateCandidates.filter(Boolean).sort();
    const importRun = await createShadowImportRun(client, {
      modelVersionId: modelVersion.id,
      cafeId: providedCafeId,
      requestedBy,
      source,
      startDate: orderedDates[0] || null,
      endDate: orderedDates[orderedDates.length - 1] || null,
      config: {
        inputRows: rawPredictions.length,
        validRows: normalizedRows.length,
        invalidSkipped,
        payloadDuplicatesSkipped
      }
    });

    const rowsForInsert = normalizedRows.map((row) => ({ ...row, training_run_id: importRun?.id || null }));

    const upsertResult = await client.query(
      `
        INSERT INTO ml_predictions (
          model_version_id,
          training_run_id,
          cafe_id,
          prediction_date,
          item_id,
          predicted_qty,
          lower_bound_qty,
          upper_bound_qty,
          confidence_score,
          source,
          metadata,
          created_at,
          updated_at
        )
        SELECT
          x.model_version_id,
          x.training_run_id,
          x.cafe_id,
          x.prediction_date::date,
          x.item_id,
          x.predicted_qty,
          x.lower_bound_qty,
          x.upper_bound_qty,
          x.confidence_score,
          x.source,
          x.metadata,
          NOW(),
          NOW()
        FROM json_to_recordset($1::json) AS x(
          model_version_id int,
          training_run_id int,
          cafe_id int,
          prediction_date text,
          item_id int,
          predicted_qty numeric,
          lower_bound_qty numeric,
          upper_bound_qty numeric,
          confidence_score numeric,
          source text,
          metadata jsonb
        )
        ON CONFLICT (model_version_id, cafe_id, prediction_date, item_id)
        DO UPDATE SET
          training_run_id = EXCLUDED.training_run_id,
          predicted_qty = EXCLUDED.predicted_qty,
          lower_bound_qty = EXCLUDED.lower_bound_qty,
          upper_bound_qty = EXCLUDED.upper_bound_qty,
          confidence_score = EXCLUDED.confidence_score,
          source = EXCLUDED.source,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING id
      `,
      [JSON.stringify(rowsForInsert)]
    );

    const finalizedRun = await finalizeShadowImportRun(client, importRun?.id, {
      status: 'completed',
      cafesProcessed: cafesTouched.size,
      itemsProcessed: itemsTouched.size,
      predictionsWritten: upsertResult.rowCount,
      metrics: {
        modelVersionId: modelVersion.id,
        modelKey: modelVersion.model_key,
        startDate: orderedDates[0] || null,
        endDate: orderedDates[orderedDates.length - 1] || null,
        inputRows: rawPredictions.length,
        validRows: normalizedRows.length,
        invalidSkipped,
        payloadDuplicatesSkipped
      }
    });

    await client.query('COMMIT');

    return {
      modelVersion,
      importRun: finalizedRun,
      predictionsWritten: upsertResult.rowCount,
      cafesProcessed: cafesTouched.size,
      itemsProcessed: itemsTouched.size,
      invalidSkipped,
      payloadDuplicatesSkipped,
      invalidSamples,
      range: {
        startDate: orderedDates[0] || null,
        endDate: orderedDates[orderedDates.length - 1] || null
      }
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function fetchShadowRows(options = {}) {
  const clauses = [];
  const values = [];
  let index = 1;

  const cafeId = options.cafeId === null || options.cafeId === undefined || options.cafeId === ''
    ? null
    : parseInt(options.cafeId, 10);
  if (options.cafeId !== null && options.cafeId !== undefined && options.cafeId !== '' && Number.isNaN(cafeId)) {
    throw createHttpError(400, 'cafeId must be a valid number');
  }

  const modelVersionId = options.modelVersionId === null || options.modelVersionId === undefined || options.modelVersionId === ''
    ? null
    : parseInt(options.modelVersionId, 10);
  if (options.modelVersionId !== null && options.modelVersionId !== undefined && options.modelVersionId !== '' && Number.isNaN(modelVersionId)) {
    throw createHttpError(400, 'modelVersionId must be a valid number');
  }

  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  if (options.startDate && !startDate) throw createHttpError(400, 'startDate must be a valid YYYY-MM-DD value');
  if (options.endDate && !endDate) throw createHttpError(400, 'endDate must be a valid YYYY-MM-DD value');
  if (startDate && endDate && startDate > endDate) throw createHttpError(400, 'startDate cannot be after endDate');

  if (cafeId) {
    clauses.push(`mp.cafe_id = $${index++}`);
    values.push(cafeId);
  }
  if (modelVersionId) {
    clauses.push(`mp.model_version_id = $${index++}`);
    values.push(modelVersionId);
  }
  if (options.modelKey) {
    clauses.push(`mv.model_key = $${index++}`);
    values.push(String(options.modelKey).trim());
  }
  if (startDate) {
    clauses.push(`mp.prediction_date >= $${index++}::date`);
    values.push(startDate);
  }
  if (endDate) {
    clauses.push(`mp.prediction_date <= $${index++}::date`);
    values.push(endDate);
  }

  const limit = options.limit === null || options.limit === undefined || options.limit === ''
    ? null
    : Math.min(2000, Math.max(1, Number(options.limit) || 0));
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitClause = limit ? `LIMIT $${index}` : '';
  if (limit) values.push(limit);

  const result = await pool.query(
    `
      SELECT
        mv.id AS model_version_id,
        mv.model_key,
        mv.display_name,
        mv.model_family,
        mv.status,
        mv.training_rows,
        mv.trained_range_start::text AS trained_range_start,
        mv.trained_range_end::text AS trained_range_end,
        mp.cafe_id,
        c.name AS cafe_name,
        mp.prediction_date::text AS prediction_date,
        mp.item_id,
        COALESCE(i.name, mlf.item_name) AS item_name,
        mp.predicted_qty,
        mp.lower_bound_qty,
        mp.upper_bound_qty,
        mp.confidence_score,
        mp.source,
        mp.metadata,
        mp.updated_at,
        CASE WHEN mlf.id IS NOT NULL THEN true ELSE false END AS has_feature_match,
        CASE WHEN mlf.id IS NOT NULL THEN COALESCE(mlf.actual_qty, 0) ELSE NULL END AS actual_qty,
        mlf.latest_forecast_qty AS rule_predicted_qty,
        CASE
          WHEN mlf.id IS NOT NULL THEN ROUND((ABS(mp.predicted_qty - COALESCE(mlf.actual_qty, 0)) / GREATEST(COALESCE(mlf.actual_qty, 0), 1)) * 100, 4)
          ELSE NULL
        END AS ml_abs_error_pct,
        CASE
          WHEN mlf.id IS NOT NULL AND mlf.latest_forecast_qty IS NOT NULL THEN ROUND((ABS(mlf.latest_forecast_qty - COALESCE(mlf.actual_qty, 0)) / GREATEST(COALESCE(mlf.actual_qty, 0), 1)) * 100, 4)
          ELSE NULL
        END AS rule_abs_error_pct,
        CASE
          WHEN mlf.id IS NOT NULL AND mlf.latest_forecast_qty IS NOT NULL THEN ROUND((((ABS(mlf.latest_forecast_qty - COALESCE(mlf.actual_qty, 0)) - ABS(mp.predicted_qty - COALESCE(mlf.actual_qty, 0))) / GREATEST(ABS(mlf.latest_forecast_qty - COALESCE(mlf.actual_qty, 0)), 1)) * 100), 4)
          ELSE NULL
        END AS error_lift_pct
      FROM ml_predictions mp
      JOIN ml_model_versions mv ON mv.id = mp.model_version_id
      JOIN cafes c ON c.id = mp.cafe_id
      LEFT JOIN items i ON i.id = mp.item_id
      LEFT JOIN ml_daily_features mlf
        ON mlf.cafe_id = mp.cafe_id
       AND mlf.item_id = mp.item_id
       AND mlf.feature_date = mp.prediction_date
      ${whereClause}
      ORDER BY mp.prediction_date DESC, mv.id ASC, mp.cafe_id ASC, mp.item_id ASC
      ${limitClause}
    `,
    values
  );

  return result.rows.map((row) => ({
    ...row,
    model_version_id: Number(row.model_version_id),
    cafe_id: Number(row.cafe_id),
    item_id: Number(row.item_id),
    training_rows: Number(row.training_rows || 0),
    predicted_qty: toNumberOrNull(row.predicted_qty),
    lower_bound_qty: toNumberOrNull(row.lower_bound_qty),
    upper_bound_qty: toNumberOrNull(row.upper_bound_qty),
    confidence_score: toNumberOrNull(row.confidence_score),
    actual_qty: toNumberOrNull(row.actual_qty),
    rule_predicted_qty: toNumberOrNull(row.rule_predicted_qty),
    ml_abs_error_pct: toNumberOrNull(row.ml_abs_error_pct),
    rule_abs_error_pct: toNumberOrNull(row.rule_abs_error_pct),
    error_lift_pct: toNumberOrNull(row.error_lift_pct),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
    metadata: row.metadata || {},
    has_feature_match: Boolean(row.has_feature_match)
  }));
}

function aggregateShadowRows(rows = []) {
  const modelMap = new Map();

  rows.forEach((row) => {
    const modelId = Number(row.model_version_id);
    if (!modelMap.has(modelId)) {
      modelMap.set(modelId, {
        modelVersionId: modelId,
        modelKey: row.model_key,
        displayName: row.display_name,
        modelFamily: row.model_family,
        status: row.status,
        trainingRows: Number(row.training_rows || 0),
        trainedRangeStart: row.trained_range_start || null,
        trainedRangeEnd: row.trained_range_end || null,
        predictionsCount: 0,
        comparedRows: 0,
        cafesCoveredSet: new Set(),
        confidenceScores: [],
        mlErrors: [],
        ruleErrors: [],
        latestImportedAt: null,
        lastPredictionDate: null
      });
    }

    const entry = modelMap.get(modelId);
    entry.predictionsCount += 1;
    entry.cafesCoveredSet.add(Number(row.cafe_id));

    if (Number.isFinite(row.confidence_score)) {
      entry.confidenceScores.push(Number(row.confidence_score));
    }
    if (Number.isFinite(row.ml_abs_error_pct)) {
      entry.comparedRows += 1;
      entry.mlErrors.push(Number(row.ml_abs_error_pct));
    }
    if (Number.isFinite(row.rule_abs_error_pct)) {
      entry.ruleErrors.push(Number(row.rule_abs_error_pct));
    }
    if (!entry.latestImportedAt || row.updated_at > entry.latestImportedAt) {
      entry.latestImportedAt = row.updated_at;
    }
    if (!entry.lastPredictionDate || row.prediction_date > entry.lastPredictionDate) {
      entry.lastPredictionDate = row.prediction_date;
    }
  });

  const models = Array.from(modelMap.values())
    .map((entry) => {
      const mlAvgAbsErrorPct = roundNumber(averageNumbers(entry.mlErrors), 2);
      const ruleAvgAbsErrorPct = roundNumber(averageNumbers(entry.ruleErrors), 2);
      const liftPct = ruleAvgAbsErrorPct > 0
        ? roundNumber(((ruleAvgAbsErrorPct - mlAvgAbsErrorPct) / ruleAvgAbsErrorPct) * 100, 2)
        : 0;

      return {
        modelVersionId: entry.modelVersionId,
        modelKey: entry.modelKey,
        displayName: entry.displayName,
        modelFamily: entry.modelFamily,
        status: entry.status,
        trainingRows: entry.trainingRows,
        trainedRangeStart: entry.trainedRangeStart,
        trainedRangeEnd: entry.trainedRangeEnd,
        predictionsCount: entry.predictionsCount,
        comparedRows: entry.comparedRows,
        cafesCovered: entry.cafesCoveredSet.size,
        avgConfidenceScore: roundNumber(averageNumbers(entry.confidenceScores), 4),
        mlAvgAbsErrorPct,
        ruleAvgAbsErrorPct,
        liftPct,
        latestImportedAt: entry.latestImportedAt,
        lastPredictionDate: entry.lastPredictionDate
      };
    })
    .sort((a, b) => {
      if (a.comparedRows && b.comparedRows) return a.mlAvgAbsErrorPct - b.mlAvgAbsErrorPct;
      if (a.comparedRows) return -1;
      if (b.comparedRows) return 1;
      return b.predictionsCount - a.predictionsCount;
    });

  const bestModel = models.find((model) => model.comparedRows > 0) || models[0] || null;
  const bestModelVersionId = bestModel?.modelVersionId || null;
  const cafeMap = new Map();

  rows
    .filter((row) => !bestModelVersionId || Number(row.model_version_id) == bestModelVersionId)
    .forEach((row) => {
      const cafeId = Number(row.cafe_id);
      if (!cafeMap.has(cafeId)) {
        cafeMap.set(cafeId, {
          cafeId,
          cafeName: row.cafe_name,
          predictionsCount: 0,
          comparedRows: 0,
          mlErrors: [],
          ruleErrors: []
        });
      }

      const entry = cafeMap.get(cafeId);
      entry.predictionsCount += 1;
      if (Number.isFinite(row.ml_abs_error_pct)) {
        entry.comparedRows += 1;
        entry.mlErrors.push(Number(row.ml_abs_error_pct));
      }
      if (Number.isFinite(row.rule_abs_error_pct)) {
        entry.ruleErrors.push(Number(row.rule_abs_error_pct));
      }
    });

  const cafes = Array.from(cafeMap.values())
    .map((entry) => {
      const mlAvgAbsErrorPct = roundNumber(averageNumbers(entry.mlErrors), 2);
      const ruleAvgAbsErrorPct = roundNumber(averageNumbers(entry.ruleErrors), 2);
      const liftPct = ruleAvgAbsErrorPct > 0
        ? roundNumber(((ruleAvgAbsErrorPct - mlAvgAbsErrorPct) / ruleAvgAbsErrorPct) * 100, 2)
        : 0;

      return {
        cafeId: entry.cafeId,
        cafeName: entry.cafeName,
        predictionsCount: entry.predictionsCount,
        comparedRows: entry.comparedRows,
        mlAvgAbsErrorPct,
        ruleAvgAbsErrorPct,
        liftPct,
        improved: liftPct > 0
      };
    })
    .sort((a, b) => b.liftPct - a.liftPct);

  const summary = bestModel
    ? {
        modelsCount: models.length,
        shadowModelsCount: models.filter((model) => ['shadow', 'active'].includes(model.status)).length,
        comparedRows: bestModel.comparedRows,
        mlAvgAbsErrorPct: bestModel.mlAvgAbsErrorPct,
        ruleAvgAbsErrorPct: bestModel.ruleAvgAbsErrorPct,
        liftPct: bestModel.liftPct,
        avgConfidenceScore: bestModel.avgConfidenceScore,
        improvedCafes: cafes.filter((row) => row.liftPct > 0).length,
        worseCafes: cafes.filter((row) => row.liftPct < 0).length,
        latestImportedAt: models.reduce((latest, model) => (!latest || (model.latestImportedAt && model.latestImportedAt > latest) ? model.latestImportedAt : latest), null),
        bestModelVersionId: bestModel.modelVersionId,
        bestModelKey: bestModel.modelKey,
        bestModelDisplayName: bestModel.displayName
      }
    : {
        modelsCount: 0,
        shadowModelsCount: 0,
        comparedRows: 0,
        mlAvgAbsErrorPct: 0,
        ruleAvgAbsErrorPct: 0,
        liftPct: 0,
        avgConfidenceScore: 0,
        improvedCafes: 0,
        worseCafes: 0,
        latestImportedAt: null,
        bestModelVersionId: null,
        bestModelKey: null,
        bestModelDisplayName: null
      };

  return {
    summary,
    models,
    cafes,
    bestModelVersionId,
    bestModel
  };
}

async function getShadowSummary(options = {}) {
  const rows = await fetchShadowRows(options);
  const aggregated = aggregateShadowRows(rows);

  const runClauses = [];
  const runValues = [];
  let runIndex = 1;

  if (options.cafeId) {
    runClauses.push(`mtr.cafe_id = $${runIndex++}`);
    runValues.push(parseInt(options.cafeId, 10));
  }
  runClauses.push(`(mtr.run_type = 'shadow_prediction_import' OR mtr.predictions_written > 0)`);
  const runWhereClause = `WHERE ${runClauses.join(' AND ')}`;

  const recentRunsResult = await pool.query(
    `
      SELECT
        mtr.id,
        mtr.cafe_id,
        mtr.status,
        mtr.source,
        mtr.range_start::text AS range_start,
        mtr.range_end::text AS range_end,
        mtr.predictions_written,
        mtr.started_at,
        mtr.finished_at,
        mtr.created_at,
        mv.id AS model_version_id,
        mv.model_key,
        mv.display_name
      FROM ml_training_runs mtr
      LEFT JOIN ml_model_versions mv ON mv.id = mtr.model_version_id
      ${runWhereClause}
      ORDER BY COALESCE(mtr.finished_at, mtr.created_at) DESC
      LIMIT 6
    `,
    runValues
  );

  return {
    ...aggregated,
    recentRuns: recentRunsResult.rows.map((row) => ({
      id: Number(row.id),
      cafeId: row.cafe_id === null || row.cafe_id === undefined ? null : Number(row.cafe_id),
      status: row.status,
      source: row.source,
      rangeStart: row.range_start,
      rangeEnd: row.range_end,
      predictionsWritten: Number(row.predictions_written || 0),
      startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
      finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : row.finished_at,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      modelVersionId: row.model_version_id === null || row.model_version_id === undefined ? null : Number(row.model_version_id),
      modelKey: row.model_key,
      displayName: row.display_name
    }))
  };
}

async function listShadowComparisonRows(options = {}) {
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
  const summary = await getShadowSummary({ ...options, limit: undefined });
  const selectedModelVersionId = options.modelVersionId
    ? parseInt(options.modelVersionId, 10)
    : summary.bestModelVersionId;

  const rows = await fetchShadowRows({
    ...options,
    modelVersionId: selectedModelVersionId || undefined,
    limit
  });

  return {
    summary: summary.summary,
    selectedModel: summary.models.find((row) => row.modelVersionId === selectedModelVersionId) || null,
    rows
  };
}

module.exports = {
  upsertModelVersion,
  importShadowPredictions,
  getShadowSummary,
  listShadowComparisonRows
};
