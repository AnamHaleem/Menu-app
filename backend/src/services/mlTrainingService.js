const pool = require('../db/pool');
const mlShadowService = require('./mlShadowService');

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_HOLDOUT_DAYS = Math.max(3, Number(process.env.ML_SHADOW_HOLDOUT_DAYS || 7));
const DEFAULT_RIDGE_LAMBDA = Math.max(0.01, Number(process.env.ML_SHADOW_RIDGE_LAMBDA || 0.75));
const MAX_CATEGORY_BUCKETS = 10;
const MAX_WEATHER_BUCKETS = 8;

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

function shiftIsoDate(value, days) {
  const normalized = normalizeIsoDate(value);
  if (!normalized) return null;
  const date = new Date(`${normalized}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDateFromDate(date);
}

function toKey(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function average(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function firstPositiveNumber(values = [], fallback = 1) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return fallback;
}

function normalizeFeatureRow(row) {
  return {
    cafe_id: Number(row.cafe_id),
    cafe_name: row.cafe_name,
    feature_date: normalizeIsoDate(row.feature_date),
    item_id: Number(row.item_id),
    item_name: row.item_name,
    item_category: row.item_category || 'uncategorized',
    actual_qty: toNumber(row.actual_qty, 0),
    revenue: toNumber(row.revenue, 0),
    tx_count: toNumber(row.tx_count, 0),
    avg_price: toNumber(row.avg_price, 0),
    lag_qty_1d: toNumber(row.lag_qty_1d, 0),
    lag_qty_7d: toNumber(row.lag_qty_7d, 0),
    avg_qty_7d: toNumber(row.avg_qty_7d, 0),
    avg_qty_14d: toNumber(row.avg_qty_14d, 0),
    avg_qty_28d: toNumber(row.avg_qty_28d, 0),
    avg_qty_same_weekday_4w: toNumber(row.avg_qty_same_weekday_4w, 0),
    rolling_revenue_7d: toNumber(row.rolling_revenue_7d, 0),
    day_of_week: toNumber(row.day_of_week, 0),
    month_of_year: toNumber(row.month_of_year, 0),
    is_weekend: Boolean(row.is_weekend),
    is_holiday: Boolean(row.is_holiday),
    holiday_name: row.holiday_name || null,
    weather_condition: row.weather_condition || null,
    temp_c: row.temp_c === null || row.temp_c === undefined ? null : toNumber(row.temp_c, 0),
    weather_bucket: row.weather_bucket || 'unknown',
    learning_multiplier: toNumber(row.learning_multiplier, 1),
    learning_samples: toNumber(row.learning_samples, 0),
    ai_recent_7d_rate: toNumber(row.ai_recent_7d_rate, 0),
    prep_days_last_7d: toNumber(row.prep_days_last_7d, 0),
    waste_value_last_7d: toNumber(row.waste_value_last_7d, 0),
    items_86_last_7d: toNumber(row.items_86_last_7d, 0),
    stockout_flag: Boolean(row.stockout_flag),
    latest_forecast_qty: row.latest_forecast_qty === null || row.latest_forecast_qty === undefined ? null : toNumber(row.latest_forecast_qty, 0),
    latest_base_forecast_qty: row.latest_base_forecast_qty === null || row.latest_base_forecast_qty === undefined ? null : toNumber(row.latest_base_forecast_qty, 0)
  };
}

async function fetchFeatureRows(options = {}) {
  const cafeId = options.cafeId === null || options.cafeId === undefined || options.cafeId === ''
    ? null
    : parseInt(options.cafeId, 10);
  if (options.cafeId !== null && options.cafeId !== undefined && options.cafeId !== '' && Number.isNaN(cafeId)) {
    throw createHttpError(400, 'cafeId must be a valid number');
  }

  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate);
  if (options.startDate && !startDate) throw createHttpError(400, 'startDate must be a valid YYYY-MM-DD value');
  if (options.endDate && !endDate) throw createHttpError(400, 'endDate must be a valid YYYY-MM-DD value');
  if (!startDate || !endDate) throw createHttpError(400, 'startDate and endDate are required');
  if (startDate > endDate) throw createHttpError(400, 'startDate cannot be after endDate');

  const clauses = [
    `mlf.feature_date >= $1::date`,
    `mlf.feature_date <= $2::date`
  ];
  const values = [startDate, endDate];

  if (cafeId) {
    clauses.push(`mlf.cafe_id = $3::int`);
    values.push(cafeId);
  }

  const whereClause = `WHERE ${clauses.join(' AND ')}`;

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
        mlf.latest_base_forecast_qty
      FROM ml_daily_features mlf
      JOIN cafes c ON c.id = mlf.cafe_id
      ${whereClause}
      ORDER BY mlf.feature_date ASC, mlf.cafe_id ASC, mlf.item_id ASC
    `,
    values
  );

  return result.rows.map(normalizeFeatureRow).filter((row) => row.feature_date);
}

function resolveDateSplit(rows, options = {}) {
  const explicitEvalStart = normalizeIsoDate(options.evaluationStartDate);
  const explicitEvalEnd = normalizeIsoDate(options.evaluationEndDate);
  if (options.evaluationStartDate && !explicitEvalStart) {
    throw createHttpError(400, 'evaluationStartDate must be a valid YYYY-MM-DD value');
  }
  if (options.evaluationEndDate && !explicitEvalEnd) {
    throw createHttpError(400, 'evaluationEndDate must be a valid YYYY-MM-DD value');
  }
  if (explicitEvalStart && explicitEvalEnd && explicitEvalStart > explicitEvalEnd) {
    throw createHttpError(400, 'evaluationStartDate cannot be after evaluationEndDate');
  }

  const distinctDates = Array.from(new Set(rows.map((row) => row.feature_date))).sort();
  if (distinctDates.length < 6) {
    throw createHttpError(400, 'Not enough feature dates to train a shadow model yet');
  }

  let evaluationStartDate = explicitEvalStart;
  let evaluationEndDate = explicitEvalEnd;

  if (!evaluationStartDate || !evaluationEndDate) {
    const holdoutDays = Math.min(
      Math.max(1, Number(options.holdoutDays || DEFAULT_HOLDOUT_DAYS) || DEFAULT_HOLDOUT_DAYS),
      Math.max(1, distinctDates.length - 2)
    );

    const holdoutDates = distinctDates.slice(-holdoutDays);
    evaluationStartDate = holdoutDates[0];
    evaluationEndDate = holdoutDates[holdoutDates.length - 1];
  }

  const trainRows = rows.filter((row) => row.feature_date < evaluationStartDate);
  const evaluationRows = rows.filter((row) => row.feature_date >= evaluationStartDate && row.feature_date <= evaluationEndDate);

  if (trainRows.length < 20) {
    throw createHttpError(400, 'Not enough training rows before the evaluation window to fit a model');
  }
  if (evaluationRows.length < 5) {
    throw createHttpError(400, 'Not enough evaluation rows in the selected holdout window');
  }

  return {
    evaluationStartDate,
    evaluationEndDate,
    trainingStartDate: trainRows[0]?.feature_date || null,
    trainingEndDate: trainRows[trainRows.length - 1]?.feature_date || null,
    trainRows,
    evaluationRows
  };
}

function topBucketValues(rows, key, maxValues) {
  const counts = new Map();
  rows.forEach((row) => {
    const normalized = toKey(row[key] || 'unknown');
    if (!normalized) return;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxValues)
    .map(([bucket]) => bucket);
}

function buildModelSpec(trainRows = []) {
  const categories = topBucketValues(trainRows, 'item_category', MAX_CATEGORY_BUCKETS);
  const weatherBuckets = topBucketValues(trainRows, 'weather_bucket', MAX_WEATHER_BUCKETS);

  const featureNames = [
    'log_baseline',
    'lag_qty_1d_ratio',
    'lag_qty_7d_ratio',
    'avg_qty_7d_ratio',
    'avg_qty_14d_ratio',
    'avg_qty_28d_ratio',
    'avg_qty_same_weekday_ratio',
    'base_forecast_ratio',
    'avg_price',
    'learning_multiplier',
    'learning_samples_scaled',
    'ai_recent_7d_rate',
    'prep_days_last_7d_scaled',
    'waste_value_last_7d_scaled',
    'items_86_last_7d_scaled',
    'temp_c_scaled',
    'is_weekend',
    'is_holiday',
    'stockout_flag',
    'day_sin',
    'day_cos',
    'month_sin',
    'month_cos',
    ...categories.map((value) => `category:${value}`),
    ...weatherBuckets.map((value) => `weather:${value}`)
  ];

  return {
    algorithm: 'ridge-linear-multiplier',
    target: 'actual_qty / adaptive_baseline_qty',
    baselineStrategy: [
      'latest_forecast_qty',
      'latest_base_forecast_qty',
      'avg_qty_7d',
      'avg_qty_28d',
      'lag_qty_7d',
      'avg_qty_same_weekday_4w',
      'lag_qty_1d'
    ],
    featureNames,
    categories,
    weatherBuckets
  };
}

function baselineForRow(row) {
  return firstPositiveNumber([
    row.latest_forecast_qty,
    row.latest_base_forecast_qty,
    row.avg_qty_7d,
    row.avg_qty_28d,
    row.lag_qty_7d,
    row.avg_qty_same_weekday_4w,
    row.lag_qty_1d
  ], 1);
}

function encodeRow(row, modelSpec) {
  const baselineQty = Math.max(1, baselineForRow(row));
  const avgPrice = Math.max(0, row.avg_price || 0);
  const revenueScale = Math.max(row.rolling_revenue_7d || 0, baselineQty * Math.max(avgPrice, 1));
  const weatherKey = toKey(row.weather_bucket || 'unknown');
  const categoryKey = toKey(row.item_category || 'uncategorized');
  const dayRadians = ((Math.max(1, row.day_of_week) - 1) / 7) * Math.PI * 2;
  const monthRadians = ((Math.max(1, row.month_of_year) - 1) / 12) * Math.PI * 2;

  const values = [
    Math.log1p(baselineQty),
    row.lag_qty_1d / baselineQty,
    row.lag_qty_7d / baselineQty,
    row.avg_qty_7d / baselineQty,
    row.avg_qty_14d / baselineQty,
    row.avg_qty_28d / baselineQty,
    row.avg_qty_same_weekday_4w / baselineQty,
    row.latest_base_forecast_qty ? row.latest_base_forecast_qty / baselineQty : 0,
    avgPrice,
    row.learning_multiplier || 1,
    row.learning_samples / 25,
    row.ai_recent_7d_rate || 0,
    row.prep_days_last_7d / 7,
    row.waste_value_last_7d / Math.max(revenueScale, 1),
    row.items_86_last_7d / 7,
    row.temp_c === null || row.temp_c === undefined ? 0 : row.temp_c / 30,
    row.is_weekend ? 1 : 0,
    row.is_holiday ? 1 : 0,
    row.stockout_flag ? 1 : 0,
    Math.sin(dayRadians),
    Math.cos(dayRadians),
    Math.sin(monthRadians),
    Math.cos(monthRadians),
    ...modelSpec.categories.map((bucket) => (bucket === categoryKey ? 1 : 0)),
    ...modelSpec.weatherBuckets.map((bucket) => (bucket === weatherKey ? 1 : 0))
  ];

  const actualQty = Math.max(0, row.actual_qty || 0);
  const targetMultiplier = clamp(actualQty / baselineQty, 0, 4.5);
  const featureCoverage = average([
    row.lag_qty_1d > 0 ? 1 : 0,
    row.lag_qty_7d > 0 ? 1 : 0,
    row.avg_qty_7d > 0 ? 1 : 0,
    row.avg_qty_28d > 0 ? 1 : 0,
    row.latest_forecast_qty > 0 ? 1 : 0,
    row.learning_samples > 0 ? 1 : 0
  ]);

  return {
    baselineQty,
    actualQty,
    targetMultiplier,
    values,
    featureCoverage,
    categoryKey,
    weatherKey
  };
}

function buildStandardizer(vectors = []) {
  const columnCount = vectors[0]?.length || 0;
  const means = new Array(columnCount).fill(0);
  const stdDevs = new Array(columnCount).fill(1);

  for (let column = 0; column < columnCount; column += 1) {
    const values = vectors.map((row) => toNumber(row[column], 0));
    const mean = average(values);
    const variance = average(values.map((value) => (value - mean) ** 2));
    means[column] = mean;
    stdDevs[column] = variance > 0 ? Math.sqrt(variance) : 1;
  }

  return { means, stdDevs };
}

function standardizeVector(values, standardizer) {
  return values.map((value, index) => (toNumber(value, 0) - standardizer.means[index]) / standardizer.stdDevs[index]);
}

function transpose(matrix) {
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]));
}

function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let maxRow = pivotIndex;
    for (let row = pivotIndex + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivotIndex]) > Math.abs(augmented[maxRow][pivotIndex])) {
        maxRow = row;
      }
    }

    if (maxRow !== pivotIndex) {
      [augmented[pivotIndex], augmented[maxRow]] = [augmented[maxRow], augmented[pivotIndex]];
    }

    const pivotValue = augmented[pivotIndex][pivotIndex];
    if (Math.abs(pivotValue) < 1e-10) {
      continue;
    }

    for (let column = pivotIndex; column <= size; column += 1) {
      augmented[pivotIndex][column] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivotIndex) continue;
      const factor = augmented[row][pivotIndex];
      if (!factor) continue;
      for (let column = pivotIndex; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivotIndex][column];
      }
    }
  }

  return augmented.map((row) => row[size] || 0);
}

function trainRidgeModel(vectors, targets, lambda = DEFAULT_RIDGE_LAMBDA) {
  const designMatrix = vectors.map((values) => [1, ...values]);
  const featureCount = designMatrix[0].length;
  const xtx = Array.from({ length: featureCount }, () => new Array(featureCount).fill(0));
  const xty = new Array(featureCount).fill(0);

  for (let row = 0; row < designMatrix.length; row += 1) {
    const vector = designMatrix[row];
    const target = targets[row];
    for (let i = 0; i < featureCount; i += 1) {
      xty[i] += vector[i] * target;
      for (let j = 0; j < featureCount; j += 1) {
        xtx[i][j] += vector[i] * vector[j];
      }
    }
  }

  for (let i = 1; i < featureCount; i += 1) {
    xtx[i][i] += lambda;
  }

  const weights = solveLinearSystem(xtx, xty);
  return weights.map((value) => roundNumber(value, 8));
}

function predictMultiplier(standardizedValues, weights) {
  const prediction = [1, ...standardizedValues].reduce(
    (sum, value, index) => sum + value * toNumber(weights[index], 0),
    0
  );
  return clamp(prediction, 0, 4.5);
}

function meanAbsolutePercentageError(actualQty, predictedQty) {
  return roundNumber((Math.abs(predictedQty - actualQty) / Math.max(actualQty, 1)) * 100, 4);
}

function summarizePredictionQuality(rows = []) {
  const mlErrors = [];
  const ruleErrors = [];

  rows.forEach((row) => {
    if (Number.isFinite(row.ml_abs_error_pct)) mlErrors.push(row.ml_abs_error_pct);
    if (Number.isFinite(row.rule_abs_error_pct)) ruleErrors.push(row.rule_abs_error_pct);
  });

  const mlAvgAbsErrorPct = roundNumber(average(mlErrors), 2);
  const ruleAvgAbsErrorPct = roundNumber(average(ruleErrors), 2);
  const liftPct = ruleAvgAbsErrorPct > 0
    ? roundNumber(((ruleAvgAbsErrorPct - mlAvgAbsErrorPct) / ruleAvgAbsErrorPct) * 100, 2)
    : 0;

  return {
    comparedRows: mlErrors.length,
    mlAvgAbsErrorPct,
    ruleAvgAbsErrorPct,
    liftPct
  };
}

async function trainAndImportShadowModel(options = {}) {
  const featureRows = await fetchFeatureRows(options);
  if (!featureRows.length) {
    throw createHttpError(400, 'No ML feature rows found in the requested date range');
  }

  const split = resolveDateSplit(featureRows, options);
  const modelSpec = buildModelSpec(split.trainRows);

  const encodedTrain = split.trainRows.map((row) => ({ row, encoded: encodeRow(row, modelSpec) }));
  const encodedEval = split.evaluationRows.map((row) => ({ row, encoded: encodeRow(row, modelSpec) }));

  const standardizer = buildStandardizer(encodedTrain.map((entry) => entry.encoded.values));
  const standardizedTrainVectors = encodedTrain.map((entry) => standardizeVector(entry.encoded.values, standardizer));
  const trainTargets = encodedTrain.map((entry) => entry.encoded.targetMultiplier);

  const weights = trainRidgeModel(standardizedTrainVectors, trainTargets, DEFAULT_RIDGE_LAMBDA);

  const evaluationPreview = encodedEval.map((entry) => {
    const standardizedValues = standardizeVector(entry.encoded.values, standardizer);
    const predictedMultiplier = predictMultiplier(standardizedValues, weights);
    const predictedQty = roundNumber(predictedMultiplier * entry.encoded.baselineQty, 4);
    const actualQty = roundNumber(entry.encoded.actualQty, 4);
    const mlAbsErrorPct = meanAbsolutePercentageError(actualQty, predictedQty);
    const rulePredictedQty = entry.row.latest_forecast_qty;
    const ruleAbsErrorPct = Number.isFinite(rulePredictedQty)
      ? meanAbsolutePercentageError(actualQty, rulePredictedQty)
      : null;

    return {
      cafeId: entry.row.cafe_id,
      cafeName: entry.row.cafe_name,
      predictionDate: entry.row.feature_date,
      itemId: entry.row.item_id,
      itemName: entry.row.item_name,
      actualQty,
      baselineQty: roundNumber(entry.encoded.baselineQty, 4),
      predictedQty,
      predictedMultiplier: roundNumber(predictedMultiplier, 4),
      featureCoverage: roundNumber(entry.encoded.featureCoverage, 4),
      confidenceScore: clamp(
        roundNumber(
          0.3 +
            (entry.encoded.featureCoverage * 0.35) +
            ((1 - Math.min(mlAbsErrorPct, 100) / 100) * 0.35),
          4
        ),
        0.05,
        0.99
      ),
      mlAbsErrorPct,
      rulePredictedQty: Number.isFinite(rulePredictedQty) ? roundNumber(rulePredictedQty, 4) : null,
      ruleAbsErrorPct,
      metadata: {
        baseline_qty: roundNumber(entry.encoded.baselineQty, 4),
        predicted_multiplier: roundNumber(predictedMultiplier, 4),
        feature_coverage: roundNumber(entry.encoded.featureCoverage, 4),
        weather_bucket: entry.encoded.weatherKey,
        category: entry.encoded.categoryKey
      }
    };
  });

  const quality = summarizePredictionQuality(evaluationPreview);
  const modelKey = String(
    options.modelKey ||
    `linear-shadow-v1-${options.cafeId ? `cafe-${options.cafeId}` : 'fleet'}-${split.evaluationStartDate}-to-${split.evaluationEndDate}`
  ).trim();
  const displayName = String(
    options.displayName ||
    `Linear Shadow v1${options.cafeId ? ` Cafe ${options.cafeId}` : ' Fleet'}`
  ).trim();

  const featureSpec = {
    ...modelSpec,
    ridgeLambda: DEFAULT_RIDGE_LAMBDA,
    standardizer: {
      means: standardizer.means.map((value) => roundNumber(value, 8)),
      stdDevs: standardizer.stdDevs.map((value) => roundNumber(value, 8))
    },
    weights
  };

  const metrics = {
    trainingRows: encodedTrain.length,
    evaluationRows: encodedEval.length,
    cafesCovered: Array.from(new Set(evaluationPreview.map((row) => row.cafeId))).length,
    itemsCovered: Array.from(new Set(evaluationPreview.map((row) => `${row.cafeId}:${row.itemId}`))).length,
    comparedRows: quality.comparedRows,
    mlAvgAbsErrorPct: quality.mlAvgAbsErrorPct,
    ruleAvgAbsErrorPct: quality.ruleAvgAbsErrorPct,
    liftPct: quality.liftPct,
    avgConfidenceScore: roundNumber(average(evaluationPreview.map((row) => row.confidenceScore)), 4),
    trainingStartDate: split.trainingStartDate,
    trainingEndDate: split.trainingEndDate,
    evaluationStartDate: split.evaluationStartDate,
    evaluationEndDate: split.evaluationEndDate
  };

  const importResult = await mlShadowService.importShadowPredictions({
    cafeId: options.cafeId || null,
    modelKey,
    displayName,
    modelFamily: 'ridge-linear',
    status: options.status || 'shadow',
    featureSpec,
    metrics,
    notes: options.notes || `Auto-trained on ML feature store and backtested against ${split.evaluationStartDate} to ${split.evaluationEndDate}.`,
    trainedRangeStart: split.trainingStartDate,
    trainedRangeEnd: split.trainingEndDate,
    trainingRows: encodedTrain.length,
    requestedBy: options.requestedBy || 'admin',
    source: options.source || 'admin_train',
    predictions: evaluationPreview.map((row) => ({
      cafeId: row.cafeId,
      prediction_date: row.predictionDate,
      item_id: row.itemId,
      predicted_qty: row.predictedQty,
      confidence_score: row.confidenceScore,
      metadata: row.metadata
    }))
  });

  return {
    modelVersion: importResult.modelVersion,
    importRun: importResult.importRun,
    split: {
      trainingStartDate: split.trainingStartDate,
      trainingEndDate: split.trainingEndDate,
      evaluationStartDate: split.evaluationStartDate,
      evaluationEndDate: split.evaluationEndDate
    },
    metrics,
    predictionsWritten: importResult.predictionsWritten,
    cafesProcessed: importResult.cafesProcessed,
    itemsProcessed: importResult.itemsProcessed,
    preview: evaluationPreview.slice(0, 25)
  };
}

module.exports = {
  trainAndImportShadowModel
};
