const axios = require('axios');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || '12000', 10);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toSafeNumber(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeItemMultipliers(value) {
  const output = {};
  if (!value || typeof value !== 'object') return output;

  for (const [itemName, rawMultiplier] of Object.entries(value)) {
    const key = String(itemName || '').trim();
    if (!key) continue;
    output[key] = clamp(toSafeNumber(rawMultiplier, 1), 0.6, 1.8);
  }

  return output;
}

function parseJsonSafe(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function getForecastAdjustments({
  cafe,
  targetDate,
  dayName,
  weather,
  isHoliday,
  holidayName,
  baselinePredictions,
  itemTrends
}) {
  const enabled = (process.env.ENABLE_AI_DECISIONS || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    return { applied: false, reason: 'ENABLE_AI_DECISIONS=false' };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { applied: false, reason: 'OPENAI_API_KEY missing' };
  }

  const predictionRows = Object.entries(baselinePredictions).map(([item_name, p]) => ({
    item_name,
    category: p.category || 'Unknown',
    avg_28d: Number(p.avgQty || 0),
    base_predicted: Number(p.predicted || 0)
  }));

  const trendRows = Object.entries(itemTrends || {}).map(([item_name, trend]) => ({
    item_name,
    last_14d_avg: Number(trend.last14 || 0),
    previous_14d_avg: Number(trend.prev14 || 0),
    trend_pct: Number(trend.trendPct || 0)
  }));

  const systemPrompt = `
You optimize cafe prep quantities.
Return ONLY strict JSON with this shape:
{
  "global_multiplier": number,
  "item_multipliers": { "Item Name": number },
  "notes": string
}

Rules:
- Keep multipliers conservative for kitchen operations.
- global_multiplier range: 0.8 to 1.2
- item_multipliers range: 0.6 to 1.8
- Include item-level multipliers only when you have a clear reason.
- If uncertain, use 1.0.
`.trim();

  const userPrompt = {
    cafe: {
      name: cafe.name,
      city: cafe.city,
      holiday_behaviour: cafe.holiday_behaviour
    },
    forecast_context: {
      date: targetDate,
      day_name: dayName,
      weather,
      is_holiday: Boolean(isHoliday),
      holiday_name: holidayName || null
    },
    base_predictions: predictionRows,
    recent_trends: trendRows
  };

  try {
    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: OPENAI_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPrompt) }
        ]
      },
      {
        timeout: OPENAI_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response?.data?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonSafe(content) || {};

    const globalMultiplier = clamp(toSafeNumber(parsed.global_multiplier, 1), 0.8, 1.2);
    const itemMultipliers = normalizeItemMultipliers(parsed.item_multipliers);
    const notes = typeof parsed.notes === 'string' ? parsed.notes.trim() : '';

    return {
      applied: true,
      model: OPENAI_MODEL,
      globalMultiplier,
      itemMultipliers,
      notes
    };
  } catch (err) {
    return {
      applied: false,
      reason: `AI request failed: ${err.message}`
    };
  }
}

module.exports = { getForecastAdjustments };
