const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const forecastService = require('../services/forecastService');
const mlFeatureService = require('../services/mlFeatureService');
const weatherService = require('../services/weatherService');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const schedulerService = require('../services/schedulerService');

const toKey = (value) => String(value || '').trim().toLowerCase();
const toNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const toNumberOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const parseBooleanValue = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return null;
};
const createHttpError = (status, message) => Object.assign(new Error(message), { status });
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const normalizeIsoDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!ISO_DATE_PATTERN.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
};
const formatRangeDateLabel = (value) => {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};
const isoDateFromDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
};
const shiftIsoDate = (value, days) => {
  const normalized = normalizeIsoDate(value);
  if (!normalized) return null;
  const date = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return isoDateFromDate(date);
};
const buildDefaultDateRange = (days = 30) => {
  const endDate = isoDateFromDate(new Date());
  const safeDays = Math.max(1, Number(days) || 30);
  return {
    startDate: shiftIsoDate(endDate, -(safeDays - 1)),
    endDate
  };
};
const buildPreviousDateRange = (startDate, endDate) => {
  const safeStart = normalizeIsoDate(startDate);
  const safeEnd = normalizeIsoDate(endDate);
  if (!safeStart || !safeEnd) return null;

  const start = new Date(`${safeStart}T12:00:00`);
  const end = new Date(`${safeEnd}T12:00:00`);
  const diffMs = end.getTime() - start.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return null;

  const spanDays = Math.floor(diffMs / 86400000) + 1;
  const previousEnd = shiftIsoDate(safeStart, -1);
  const previousStart = shiftIsoDate(previousEnd, -(spanDays - 1));

  return previousStart && previousEnd
    ? { startDate: previousStart, endDate: previousEnd, spanDays }
    : null;
};
const resolveDateRangeOptions = (query = {}) => {
  const rawStartDate = String(query.startDate || '').trim();
  const rawEndDate = String(query.endDate || '').trim();
  const startDate = normalizeIsoDate(rawStartDate);
  const endDate = normalizeIsoDate(rawEndDate);

  if (rawStartDate && !startDate) {
    throw createHttpError(400, 'startDate must be a valid YYYY-MM-DD value');
  }
  if (rawEndDate && !endDate) {
    throw createHttpError(400, 'endDate must be a valid YYYY-MM-DD value');
  }
  if (startDate && endDate && startDate > endDate) {
    throw createHttpError(400, 'startDate cannot be after endDate');
  }

  return { startDate, endDate };
};
const buildDateRangeClause = (startDate, endDate, startingIndex = 2) => {
  const clauses = [];
  const values = [];
  let index = startingIndex;

  if (startDate) {
    clauses.push(`date >= $${index++}::date`);
    values.push(startDate);
  }

  if (endDate) {
    clauses.push(`date <= $${index++}::date`);
    values.push(endDate);
  }

  return {
    clause: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    values,
    nextIndex: index
  };
};

const PREP_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isValidPrepTime = (value) => PREP_TIME_PATTERN.test(String(value || '').trim());
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const extractBearerToken = (authHeader = '') => {
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};
const isCafeEmailConflict = (err) => {
  if (!err || err.code !== '23505') return false;
  const fingerprint = `${err.constraint || ''} ${err.detail || ''} ${err.message || ''}`.toLowerCase();
  return (
    fingerprint.includes('cafes_email_key') ||
    fingerprint.includes('idx_cafes_email_active_unique') ||
    fingerprint.includes('lower(email)')
  );
};
const sendCafeWriteError = (res, err) => {
  if (isCafeEmailConflict(err)) {
    return res.status(409).json({
      error: 'Another active cafe already uses this owner email. Use a different email or deactivate the other cafe first.'
    });
  }
  return res.status(500).json({ error: err.message });
};
const isOwnerEmailConflict = (err) => {
  if (!err || err.code !== '23505') return false;
  const fingerprint = `${err.constraint || ''} ${err.detail || ''} ${err.message || ''}`.toLowerCase();
  return (
    fingerprint.includes('idx_owner_users_email_unique') ||
    fingerprint.includes('owner_users_email_key') ||
    fingerprint.includes('lower(email)')
  );
};
const sendOwnerWriteError = (res, err) => {
  if (isOwnerEmailConflict(err)) {
    return res.status(409).json({
      error: 'An owner account already exists with this email.'
    });
  }
  return res.status(500).json({ error: err.message });
};

const CANADA_PROVINCES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'
]);
const OWNER_ACCESS_ROLES = new Set(['owner', 'admin', 'editor', 'viewer']);
const OWNER_TEAM_MANAGE_ROLES = new Set(['owner', 'admin']);
const OWNER_EDIT_ROLES = new Set(['owner', 'admin', 'editor']);
const REQUIRED_OWNER_PROFILE_FIELDS = [
  'first_name',
  'last_name',
  'phone'
];

const normalizeProvinceCode = (value) => String(value || '').trim().toUpperCase();
const normalizeCanadianPostalCode = (value) => {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return null;
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(raw)) return null;
  return `${raw.slice(0, 3)} ${raw.slice(3)}`;
};
const normalizeCanadianPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
};
const normalizeOwnerAccessRole = (value, fallback = 'viewer') => {
  const normalized = String(value || '').trim().toLowerCase();
  return OWNER_ACCESS_ROLES.has(normalized) ? normalized : fallback;
};
const ownerRoleRank = (value) => {
  const normalized = normalizeOwnerAccessRole(value);
  return { owner: 0, admin: 1, editor: 2, viewer: 3 }[normalized] ?? 99;
};
const buildOwnerPermissions = (accessRole) => {
  const normalized = normalizeOwnerAccessRole(accessRole);
  return {
    canEdit: OWNER_EDIT_ROLES.has(normalized),
    canManageTeam: OWNER_TEAM_MANAGE_ROLES.has(normalized),
    canManageSettings: OWNER_TEAM_MANAGE_ROLES.has(normalized)
  };
};
const sanitizeAvatarDataUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { value: null, error: null };
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return { value: null, error: 'Profile photo must be a PNG, JPG, WEBP, or GIF image.' };
  }
  if (trimmed.length > 1_000_000) {
    return { value: null, error: 'Profile photo is too large. Please use an image under 700 KB.' };
  }
  return { value: trimmed, error: null };
};
const isSms2faRequired = () =>
  ['1', 'true', 'yes'].includes(String(process.env.OWNER_REQUIRE_SMS_2FA || '').trim().toLowerCase());

const OWNER_CODE_TTL_MINUTES = Math.max(3, parseInt(process.env.OWNER_CODE_TTL_MINUTES || '10', 10));
const OWNER_SESSION_TTL_HOURS = Math.max(1, parseInt(process.env.OWNER_SESSION_TTL_HOURS || '168', 10));
const ownerCodeStore = new Map(); // email -> { emailCodeHash, smsCodeHash, expiresAt }

const getOwnerAuthSecret = () =>
  String(process.env.OWNER_AUTH_SECRET || process.env.PREP_RUN_TOKEN || '').trim();

const hashOwnerCode = (email, channel, code, secret) => {
  return crypto
    .createHash('sha256')
    .update(`${normalizeEmail(email)}:${channel}:${String(code || '').trim()}:${secret}`)
    .digest('hex');
};

const createOwnerCode = () => String(Math.floor(100000 + Math.random() * 900000));
const isMatchingCodeHash = (expectedHash, submittedHash) => {
  if (!expectedHash || !submittedHash) return false;
  if (expectedHash.length !== submittedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(submittedHash));
};

async function getLegacyOwnerCafesByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];

  const result = await pool.query(
    `SELECT
       id,
       name,
       city,
       email,
       kitchen_lead_email,
       prep_send_time,
       CASE
         WHEN LOWER(email) = $1 THEN 'owner'
         WHEN LOWER(COALESCE(kitchen_lead_email, '')) = $1 THEN 'editor'
         ELSE 'viewer'
       END AS access_role
     FROM cafes
     WHERE active = true
       AND (
         LOWER(email) = $1
         OR LOWER(COALESCE(kitchen_lead_email, '')) = $1
       )
     ORDER BY name`,
    [normalizedEmail]
  );

  return result.rows.map((row) => ({
    ...row,
    access_role: normalizeOwnerAccessRole(row.access_role),
    permissions: buildOwnerPermissions(row.access_role)
  }));
}

async function getOwnerAccessByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { owner: null, cafes: [], source: 'none' };
  }

  const ownerResult = await pool.query(
    `SELECT id, email, full_name, active
     FROM owner_users
     WHERE LOWER(email) = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  if (ownerResult.rows.length) {
    const owner = ownerResult.rows[0];
    if (!owner.active) {
      return { owner, cafes: [], source: 'owner_inactive' };
    }

    const cafesResult = await pool.query(
      `SELECT
         c.id,
         c.name,
         c.city,
         c.email,
         c.kitchen_lead_email,
         c.prep_send_time,
         oca.access_role
       FROM owner_cafe_access oca
       JOIN cafes c ON c.id = oca.cafe_id
       WHERE oca.owner_id = $1
         AND c.active = true
       ORDER BY c.name`,
      [owner.id]
    );

    return {
      owner,
      cafes: cafesResult.rows.map((row) => ({
        ...row,
        access_role: normalizeOwnerAccessRole(row.access_role),
        permissions: buildOwnerPermissions(row.access_role)
      })),
      source: 'owner_map'
    };
  }

  const cafes = await getLegacyOwnerCafesByEmail(normalizedEmail);
  return {
    owner: null,
    cafes,
    source: cafes.length ? 'legacy_match' : 'none'
  };
}

async function getOwnerById(ownerId) {
  const result = await pool.query(
    `SELECT
       id,
       email,
       full_name,
       first_name,
       last_name,
       phone,
       secondary_phone,
       city,
       province,
       street_address,
       unit_number,
       postal_code,
       avatar_data_url,
       active,
       created_at,
       updated_at
     FROM owner_users
     WHERE id = $1`,
    [ownerId]
  );
  return result.rows[0] || null;
}

async function getOwnerProfileByEmail(email) {
  const result = await pool.query(
    `SELECT
       id,
       email,
       full_name,
       first_name,
       last_name,
       phone,
       secondary_phone,
       city,
       province,
       street_address,
       unit_number,
       postal_code,
       avatar_data_url,
       active
     FROM owner_users
     WHERE LOWER(email) = $1
     LIMIT 1`,
    [normalizeEmail(email)]
  );
  return result.rows[0] || null;
}

async function getOwnerSessionByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const { owner, cafes } = await getOwnerAccessByEmail(normalizedEmail);
  return {
    email: normalizedEmail,
    ownerId: owner?.id || null,
    profile: await getOwnerProfileByEmail(normalizedEmail),
    cafes
  };
}

async function listCafeTeamMembers(cafeId) {
  const result = await pool.query(
    `SELECT
       o.id,
       o.email,
       o.full_name,
       o.first_name,
       o.last_name,
       o.phone,
       o.secondary_phone,
       o.city,
       o.province,
       o.street_address,
       o.unit_number,
       o.postal_code,
       o.avatar_data_url,
       o.active,
       oca.access_role,
       oca.created_at,
       oca.updated_at
     FROM owner_cafe_access oca
     JOIN owner_users o ON o.id = oca.owner_id
     WHERE oca.cafe_id = $1
     ORDER BY
       CASE LOWER(COALESCE(oca.access_role, 'viewer'))
         WHEN 'owner' THEN 0
         WHEN 'admin' THEN 1
         WHEN 'editor' THEN 2
         ELSE 3
       END,
       COALESCE(NULLIF(TRIM(o.full_name), ''), o.email) ASC`,
    [cafeId]
  );

  return result.rows.map((row) => ({
    ...row,
    access_role: normalizeOwnerAccessRole(row.access_role),
    permissions: buildOwnerPermissions(row.access_role)
  }));
}

function sanitizeOwnerProfileInput(raw = {}) {
  const trimOrNull = (value) => {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : null;
  };

  return {
    first_name: trimOrNull(raw.first_name),
    last_name: trimOrNull(raw.last_name),
    phone_raw: trimOrNull(raw.phone),
    secondary_phone_raw: trimOrNull(raw.secondary_phone),
    city: trimOrNull(raw.city),
    province_raw: trimOrNull(raw.province),
    street_address: trimOrNull(raw.street_address),
    unit_number: trimOrNull(raw.unit_number),
    postal_code_raw: trimOrNull(raw.postal_code)
  };
}

function mergeOwnerProfile(existing = {}, incoming = {}) {
  const provinceFromIncoming = incoming.province_raw ? normalizeProvinceCode(incoming.province_raw) : null;
  const provinceFromExisting = existing.province ? normalizeProvinceCode(existing.province) : null;

  const primaryPhone = incoming.phone_raw
    ? normalizeCanadianPhone(incoming.phone_raw)
    : (existing.phone || null);

  const secondaryPhone = incoming.secondary_phone_raw
    ? normalizeCanadianPhone(incoming.secondary_phone_raw)
    : (existing.secondary_phone || null);

  const postalCode = incoming.postal_code_raw
    ? normalizeCanadianPostalCode(incoming.postal_code_raw)
    : (existing.postal_code || null);

  const avatarDataUrl = Object.prototype.hasOwnProperty.call(incoming, 'avatar_data_url')
    ? incoming.avatar_data_url
    : (existing.avatar_data_url || null);

  return {
    first_name: incoming.first_name ?? existing.first_name ?? null,
    last_name: incoming.last_name ?? existing.last_name ?? null,
    phone: primaryPhone,
    secondary_phone: secondaryPhone,
    city: incoming.city ?? existing.city ?? null,
    province: provinceFromIncoming || provinceFromExisting || null,
    street_address: incoming.street_address ?? existing.street_address ?? null,
    unit_number: incoming.unit_number ?? existing.unit_number ?? null,
    postal_code: postalCode,
    avatar_data_url: avatarDataUrl,
    full_name: [incoming.first_name ?? existing.first_name ?? '', incoming.last_name ?? existing.last_name ?? '']
      .join(' ')
      .trim() || existing.full_name || null
  };
}

function validateMergedOwnerProfile(profile) {
  const missingFields = REQUIRED_OWNER_PROFILE_FIELDS.filter((field) => {
    const value = profile[field];
    return value === null || value === undefined || String(value).trim() === '';
  });

  const errors = [];
  if (profile.province && !CANADA_PROVINCES.has(normalizeProvinceCode(profile.province))) {
    errors.push('Province must be a valid Canadian province/territory code.');
  }
  if (profile.phone && !normalizeCanadianPhone(profile.phone)) {
    errors.push('Primary phone must be in +1 000-000-0000 format.');
  }
  if (profile.secondary_phone && !normalizeCanadianPhone(profile.secondary_phone)) {
    errors.push('Secondary phone must be in +1 000-000-0000 format.');
  }
  if (profile.postal_code && !normalizeCanadianPostalCode(profile.postal_code)) {
    errors.push('Postal code must be a valid Canadian postal code.');
  }

  return { missingFields, errors };
}

async function listOwners({ cafeId = null, includeInactive = false } = {}) {
  const params = [];
  const where = [];

  if (!includeInactive) {
    where.push('o.active = true');
  }

  if (cafeId) {
    params.push(cafeId);
    where.push(`EXISTS (
      SELECT 1 FROM owner_cafe_access x
      WHERE x.owner_id = o.id AND x.cafe_id = $${params.length}
    )`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const query = `
    SELECT
      o.id,
      o.email,
      o.full_name,
      o.active,
      o.created_at,
      o.updated_at,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'city', c.city
          )
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
      ) AS cafes
    FROM owner_users o
    LEFT JOIN owner_cafe_access oca ON oca.owner_id = o.id
    LEFT JOIN cafes c ON c.id = oca.cafe_id
    ${whereSql}
    GROUP BY o.id
    ORDER BY o.created_at DESC, o.id DESC
  `;

  const result = await pool.query(query, params);
  return result.rows.map((row) => ({
    ...row,
    cafes: Array.isArray(row.cafes) ? row.cafes : []
  }));
}

async function buildMetrics(cafeId, options = {}) {
  const { startDate = null, endDate = null } = options;
  const selectedRange = buildDateRangeClause(startDate, endDate);
  const selectedValues = [cafeId, ...selectedRange.values];

  const totalLogs = await pool.query(
    `SELECT COUNT(*) as days FROM daily_logs WHERE cafe_id = $1${selectedRange.clause}`,
    selectedValues
  );
  const selectedWindow = await pool.query(`
    SELECT
      SUM(waste_value) as total_waste,
      SUM(items_86d) as total_86,
      COUNT(*) as days,
      AVG(actual_covers) as avg_covers
    FROM daily_logs
    WHERE cafe_id = $1${selectedRange.clause}
  `, selectedValues);
  const baseline = await pool.query(`
    SELECT AVG(seed.waste_value) as avg_waste
    FROM (
      SELECT waste_value
      FROM daily_logs
      WHERE cafe_id = $1${selectedRange.clause}
      ORDER BY date ASC
      LIMIT 7
    ) seed
  `, selectedValues);

  const anchorDate = endDate || new Date().toISOString().split('T')[0];
  const trailing30 = await pool.query(`
    SELECT
      SUM(waste_value) as waste_30,
      SUM(items_86d) as incidents_86_30,
      COUNT(*) as days_30
    FROM daily_logs
    WHERE cafe_id = $1
      AND date <= $2::date
      AND date >= ($2::date - INTERVAL '29 days')
      ${startDate ? 'AND date >= $3::date' : ''}
  `, startDate ? [cafeId, anchorDate, startDate] : [cafeId, anchorDate]);
  const trailing7 = await pool.query(`
    SELECT
      SUM(waste_value) as waste_7,
      SUM(items_86d) as incidents_86_7,
      COUNT(*) as days_7
    FROM daily_logs
    WHERE cafe_id = $1
      AND date <= $2::date
      AND date >= ($2::date - INTERVAL '6 days')
      ${startDate ? 'AND date >= $3::date' : ''}
  `, startDate ? [cafeId, anchorDate, startDate] : [cafeId, anchorDate]);

  const lifetime = await pool.query(`
    SELECT
      SUM(waste_value) as total_waste,
      SUM(items_86d) as total_86,
      COUNT(*) as days
    FROM daily_logs
    WHERE cafe_id = $1
  `, [cafeId]);

  const baselineWaste = parseFloat(baseline.rows[0]?.avg_waste || 0);
  const totalWaste = parseFloat(selectedWindow.rows[0]?.total_waste || 0);
  const daysRunning = parseInt(totalLogs.rows[0]?.days || 0, 10);
  const labourSavedMins = daysRunning * 15;
  const labourSaved$ = Math.round((labourSavedMins / 60) * 21 * 100) / 100;
  const projectedWasteWithout = baselineWaste * daysRunning;
  const wasteSaved = Math.max(0, projectedWasteWithout - totalWaste);
  const totalSavings = wasteSaved + labourSaved$;
  const annualised = daysRunning > 0 ? Math.round(totalSavings * (365 / daysRunning)) : 0;

  const selectedWaste = parseFloat(selectedWindow.rows[0]?.total_waste || 0);
  const selectedIncidents = parseInt(selectedWindow.rows[0]?.total_86 || 0, 10);
  const selectedDays = Math.max(daysRunning, 1);
  const avgDailyAfter = selectedWaste / selectedDays;
  const wasteReductionPct = baselineWaste > 0
    ? Math.round(((baselineWaste - avgDailyAfter) / baselineWaste) * 100)
    : 0;

  return {
    range: {
      startDate,
      endDate,
      label: formatRangeDateLabel(startDate) && formatRangeDateLabel(endDate)
        ? `${formatRangeDateLabel(startDate)} – ${formatRangeDateLabel(endDate)}`
        : (formatRangeDateLabel(startDate) || formatRangeDateLabel(endDate) || 'All time'),
      custom: Boolean(startDate || endDate)
    },
    daysRunning,
    allTime: {
      wasteSaved: Math.round(wasteSaved * 100) / 100,
      total86: selectedIncidents,
      labourSaved$,
      totalSavings: Math.round(totalSavings * 100) / 100,
      annualised
    },
    last30: {
      waste: parseFloat(trailing30.rows[0]?.waste_30 || 0),
      incidents86: parseInt(trailing30.rows[0]?.incidents_86_30 || 0, 10),
      days: parseInt(trailing30.rows[0]?.days_30 || 0, 10)
    },
    last7: {
      waste: parseFloat(trailing7.rows[0]?.waste_7 || 0),
      incidents86: parseInt(trailing7.rows[0]?.incidents_86_7 || 0, 10),
      days: parseInt(trailing7.rows[0]?.days_7 || 0, 10)
    },
    baseline: { avgDailyWaste: Math.round(baselineWaste * 100) / 100 },
    avgDailyWasteAfter: Math.round(avgDailyAfter * 100) / 100,
    wasteReductionPct,
    forecastAccuracy: Math.max(0, 100 - Math.round((selectedIncidents / Math.max(selectedDays, 1)) * 100)),
    lifetime: {
      daysRunning: parseInt(lifetime.rows[0]?.days || 0, 10),
      totalWaste: parseFloat(lifetime.rows[0]?.total_waste || 0),
      total86: parseInt(lifetime.rows[0]?.total_86 || 0, 10)
    }
  };
}

async function buildPrepSummary(cafeId, date) {
  const rowsResult = await pool.query(
    `
      SELECT
        p.id,
        p.ingredient_id,
        p.ingredient_name,
        p.station,
        p.unit,
        p.completed,
        p.forecast_quantity,
        p.on_hand_quantity,
        p.net_quantity,
        p.quantity_needed,
        p.actual_prepped_quantity,
        p.actual_notes,
        COALESCE(s.sold_qty, 0) AS sold_quantity
      FROM prep_lists p
      LEFT JOIN (
        WITH tx AS (
          SELECT
            t.cafe_id,
            COALESCE(t.item_id, i.id) AS resolved_item_id,
            SUM(t.quantity)::numeric AS qty
          FROM transactions t
          LEFT JOIN items i
            ON i.cafe_id = t.cafe_id
           AND LOWER(TRIM(i.name)) = LOWER(TRIM(t.item_name))
          WHERE t.cafe_id = $1
            AND t.date::date = $2::date
          GROUP BY t.cafe_id, COALESCE(t.item_id, i.id)
        )
        SELECT
          r.ingredient_id,
          SUM(tx.qty * r.qty_per_portion)::numeric AS sold_qty
        FROM tx
        JOIN recipes r
          ON r.cafe_id = tx.cafe_id
         AND r.item_id = tx.resolved_item_id
        GROUP BY r.ingredient_id
      ) s ON s.ingredient_id = p.ingredient_id
      WHERE p.cafe_id = $1
        AND p.date = $2::date
      ORDER BY p.station, p.ingredient_name
    `,
    [cafeId, date]
  );

  const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
  const varianceTolerance = 0.05;

  const items = rowsResult.rows.map((row) => {
    const forecastQty = toNumberOrZero(row.forecast_quantity ?? row.quantity_needed);
    const onHandQty = toNumberOrZero(row.on_hand_quantity);
    const netQty = toNumberOrZero(row.net_quantity ?? row.quantity_needed);
    const soldQty = toNumberOrZero(row.sold_quantity);
    const actualRaw = row.actual_prepped_quantity;
    const actualPreppedQty =
      actualRaw === null || actualRaw === undefined ? null : toNumberOrZero(actualRaw);
    const varianceVsNetQty =
      actualPreppedQty === null ? null : round2(actualPreppedQty - netQty);
    const varianceVsSoldQty =
      actualPreppedQty === null ? null : round2(actualPreppedQty - soldQty);

    return {
      prepId: row.id,
      ingredientId: row.ingredient_id,
      ingredientName: row.ingredient_name,
      station: row.station,
      unit: row.unit,
      completed: Boolean(row.completed),
      forecastQty: round2(forecastQty),
      onHandQty: round2(onHandQty),
      netQty: round2(netQty),
      soldQty: round2(soldQty),
      actualPreppedQty: actualPreppedQty === null ? null : round2(actualPreppedQty),
      actualNotes: row.actual_notes || null,
      varianceVsNetQty,
      varianceVsSoldQty
    };
  });

  const withActuals = items.filter((item) => item.actualPreppedQty !== null).length;
  const pendingActualCount = items.length - withActuals;

  let overPreppedCount = 0;
  let underPreppedCount = 0;
  for (const item of items) {
    if (item.varianceVsNetQty === null) continue;
    if (item.varianceVsNetQty > varianceTolerance) overPreppedCount += 1;
    else if (item.varianceVsNetQty < -varianceTolerance) underPreppedCount += 1;
  }

  const completedCount = items.filter((item) => item.completed).length;

  return {
    cafeId,
    date,
    totals: {
      itemCount: items.length,
      completedCount,
      withActuals,
      pendingActualCount,
      overPreppedCount,
      underPreppedCount,
      onTargetCount: Math.max(0, withActuals - overPreppedCount - underPreppedCount)
    },
    items
  };
}

function aggregatePrepAnalyticsRows(cafeId, rows, startDate, endDate) {
  const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
  const varianceTolerance = 0.05;
  const stationMap = new Map();
  const dailyMap = new Map();
  const exportRows = [];

  let itemCount = 0;
  let completedCount = 0;
  let actualCaptureCount = 0;
  let onTargetCount = 0;
  let overPreppedCount = 0;
  let underPreppedCount = 0;
  let totalNetQty = 0;
  let totalActualQty = 0;
  let absoluteVarianceTotal = 0;

  for (const row of rows) {
    const dateKey = row.date instanceof Date ? isoDateFromDate(row.date) : normalizeIsoDate(row.date);
    const station = row.station || 'Other';
    const unit = row.unit || '';
    const netQty = toNumberOrZero(row.net_quantity ?? row.quantity_needed);
    const forecastQty = toNumberOrZero(row.forecast_quantity ?? row.quantity_needed);
    const onHandQty = toNumberOrZero(row.on_hand_quantity);
    const completed = Boolean(row.completed);
    const actualRaw = row.actual_prepped_quantity;
    const hasActual = !(actualRaw === null || actualRaw === undefined);
    const actualQty = hasActual ? toNumberOrZero(actualRaw) : null;
    const varianceQty = hasActual ? round2(actualQty - netQty) : null;

    itemCount += 1;
    totalNetQty += netQty;
    if (completed) completedCount += 1;
    if (hasActual) {
      actualCaptureCount += 1;
      totalActualQty += actualQty;
      absoluteVarianceTotal += Math.abs(varianceQty);
      if (varianceQty > varianceTolerance) overPreppedCount += 1;
      else if (varianceQty < -varianceTolerance) underPreppedCount += 1;
      else onTargetCount += 1;
    }

    if (!stationMap.has(station)) {
      stationMap.set(station, {
        station,
        itemCount: 0,
        completedCount: 0,
        actualCaptureCount: 0,
        onTargetCount: 0,
        overPreppedCount: 0,
        underPreppedCount: 0
      });
    }

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, {
        date: dateKey,
        itemCount: 0,
        completedCount: 0,
        actualCaptureCount: 0,
        onTargetCount: 0,
        overPreppedCount: 0,
        underPreppedCount: 0
      });
    }

    const stationSummary = stationMap.get(station);
    stationSummary.itemCount += 1;
    if (completed) stationSummary.completedCount += 1;
    if (hasActual) {
      stationSummary.actualCaptureCount += 1;
      if (varianceQty > varianceTolerance) stationSummary.overPreppedCount += 1;
      else if (varianceQty < -varianceTolerance) stationSummary.underPreppedCount += 1;
      else stationSummary.onTargetCount += 1;
    }

    const daySummary = dailyMap.get(dateKey);
    daySummary.itemCount += 1;
    if (completed) daySummary.completedCount += 1;
    if (hasActual) {
      daySummary.actualCaptureCount += 1;
      if (varianceQty > varianceTolerance) daySummary.overPreppedCount += 1;
      else if (varianceQty < -varianceTolerance) daySummary.underPreppedCount += 1;
      else daySummary.onTargetCount += 1;
    }

    exportRows.push({
      date: dateKey,
      station,
      ingredientName: row.ingredient_name,
      forecastQty: round2(forecastQty),
      onHandQty: round2(onHandQty),
      netQty: round2(netQty),
      actualQty: hasActual ? round2(actualQty) : null,
      varianceQty,
      completed,
      unit
    });
  }

  const prepDays = dailyMap.size;
  const previousLabel = formatRangeDateLabel(startDate) && formatRangeDateLabel(endDate)
    ? `${formatRangeDateLabel(startDate)} – ${formatRangeDateLabel(endDate)}`
    : (formatRangeDateLabel(startDate) || formatRangeDateLabel(endDate) || 'Selected range');

  return {
    cafeId,
    range: {
      startDate,
      endDate,
      label: previousLabel
    },
    overview: {
      itemCount,
      prepDays,
      completedCount,
      completionRate: itemCount ? round2((completedCount / itemCount) * 100) : 0,
      actualCaptureCount,
      actualCaptureRate: itemCount ? round2((actualCaptureCount / itemCount) * 100) : 0,
      onTargetCount,
      onTargetRate: actualCaptureCount ? round2((onTargetCount / actualCaptureCount) * 100) : 0,
      overPreppedCount,
      underPreppedCount,
      totalNetQty: round2(totalNetQty),
      totalActualQty: round2(totalActualQty),
      avgAbsoluteVarianceQty: actualCaptureCount ? round2(absoluteVarianceTotal / actualCaptureCount) : 0
    },
    stationBreakdown: [...stationMap.values()]
      .map((entry) => ({
        ...entry,
        completionRate: entry.itemCount ? round2((entry.completedCount / entry.itemCount) * 100) : 0,
        actualCaptureRate: entry.itemCount ? round2((entry.actualCaptureCount / entry.itemCount) * 100) : 0,
        onTargetRate: entry.actualCaptureCount ? round2((entry.onTargetCount / entry.actualCaptureCount) * 100) : 0
      }))
      .sort((a, b) => a.station.localeCompare(b.station)),
    dailyBreakdown: [...dailyMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    topVarianceRows: exportRows
      .filter((row) => row.actualQty !== null)
      .sort((a, b) => Math.abs(b.varianceQty || 0) - Math.abs(a.varianceQty || 0))
      .slice(0, 10),
    rows: exportRows
  };
}

function buildPrepAnalyticsComparison(currentOverview, previousOverview) {
  if (!previousOverview) return null;

  const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
  return {
    completionRateDelta: round2(currentOverview.completionRate - previousOverview.completionRate),
    actualCaptureRateDelta: round2(currentOverview.actualCaptureRate - previousOverview.actualCaptureRate),
    onTargetRateDelta: round2(currentOverview.onTargetRate - previousOverview.onTargetRate),
    prepDaysDelta: round2(currentOverview.prepDays - previousOverview.prepDays),
    overPreppedDelta: round2(currentOverview.overPreppedCount - previousOverview.overPreppedCount),
    underPreppedDelta: round2(currentOverview.underPreppedCount - previousOverview.underPreppedCount)
  };
}

async function buildPrepAnalytics(cafeId, options = {}) {
  const requestedRange = options.startDate && options.endDate
    ? { startDate: options.startDate, endDate: options.endDate }
    : buildDefaultDateRange(30);

  const currentRange = {
    startDate: normalizeIsoDate(requestedRange.startDate),
    endDate: normalizeIsoDate(requestedRange.endDate)
  };

  const currentRowsResult = await pool.query(
    `SELECT
       date,
       station,
       ingredient_name,
       quantity_needed,
       forecast_quantity,
       on_hand_quantity,
       net_quantity,
       actual_prepped_quantity,
       completed,
       unit
     FROM prep_lists
     WHERE cafe_id = $1
       AND date >= $2::date
       AND date <= $3::date
     ORDER BY date DESC, station, ingredient_name`,
    [cafeId, currentRange.startDate, currentRange.endDate]
  );

  const current = aggregatePrepAnalyticsRows(
    cafeId,
    currentRowsResult.rows,
    currentRange.startDate,
    currentRange.endDate
  );

  const previousRange = buildPreviousDateRange(currentRange.startDate, currentRange.endDate);
  let previous = null;

  if (previousRange) {
    const previousRowsResult = await pool.query(
      `SELECT
         date,
         station,
         ingredient_name,
         quantity_needed,
         forecast_quantity,
         on_hand_quantity,
         net_quantity,
         actual_prepped_quantity,
         completed,
         unit
       FROM prep_lists
       WHERE cafe_id = $1
         AND date >= $2::date
         AND date <= $3::date
       ORDER BY date DESC, station, ingredient_name`,
      [cafeId, previousRange.startDate, previousRange.endDate]
    );

    previous = aggregatePrepAnalyticsRows(
      cafeId,
      previousRowsResult.rows,
      previousRange.startDate,
      previousRange.endDate
    );
  }

  return {
    ...current,
    previousRange: previous?.range || null,
    previousOverview: previous?.overview || null,
    comparison: buildPrepAnalyticsComparison(current.overview, previous?.overview || null)
  };
}

function ensureAnalyticsDateRange(options = {}, fallbackDays = 30) {
  const safeEnd = normalizeIsoDate(options.endDate) || isoDateFromDate(new Date());
  const safeStart = normalizeIsoDate(options.startDate) || shiftIsoDate(safeEnd, -(Math.max(1, fallbackDays) - 1));
  return {
    startDate: safeStart,
    endDate: safeEnd,
    label: formatRangeDateLabel(safeStart) && formatRangeDateLabel(safeEnd)
      ? `${formatRangeDateLabel(safeStart)} – ${formatRangeDateLabel(safeEnd)}`
      : (formatRangeDateLabel(safeStart) || formatRangeDateLabel(safeEnd) || 'Selected range')
  };
}

function mapRowsByCafeId(rows = [], key = 'cafe_id') {
  const map = new Map();
  for (const row of rows) {
    map.set(Number(row[key]), row);
  }
  return map;
}

function averageNumbers(values = []) {
  const clean = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function diffDaysFromToday(value) {
  const normalized = normalizeIsoDate(value);
  if (!normalized) return null;
  const today = new Date(`${isoDateFromDate(new Date())}T12:00:00`);
  const target = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(today.getTime()) || Number.isNaN(target.getTime())) return null;
  return Math.floor((today.getTime() - target.getTime()) / 86400000);
}

function severityRank(severity = 'info') {
  return { critical: 0, high: 1, medium: 2, info: 3 }[severity] ?? 9;
}

function normalizeAuditRow(row) {
  let details = row.details;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      details = {};
    }
  }

  return {
    id: row.id,
    eventType: row.event_type,
    severity: row.severity,
    cafeId: row.cafe_id,
    actorEmail: row.actor_email || null,
    actorSource: row.actor_source,
    summary: row.summary,
    details: details && typeof details === 'object' ? details : {},
    createdAt: row.created_at
  };
}

async function writeAdminAuditEvent({
  eventType,
  severity = 'info',
  cafeId = null,
  actorEmail = null,
  actorSource = 'system',
  summary,
  details = {}
}) {
  if (!eventType || !summary) return;

  try {
    await pool.query(
      `INSERT INTO admin_audit_events (
         event_type,
         severity,
         cafe_id,
         actor_email,
         actor_source,
         summary,
         details
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        eventType,
        severity,
        cafeId,
        actorEmail,
        actorSource,
        summary,
        JSON.stringify(details || {})
      ]
    );
  } catch (err) {
    console.error('Failed to write admin audit event:', err.message || err);
  }
}

function getAdminActorEmail(req) {
  const headerEmail = normalizeEmail(req.headers['x-admin-actor-email']);
  if (isValidEmail(headerEmail)) return headerEmail;

  const candidates = [
    req.auth?.sessionClaims?.email,
    req.auth?.sessionClaims?.email_address,
    req.auth?.claims?.email_address,
    req.auth?.user?.primaryEmailAddress?.emailAddress
  ];

  for (const candidate of candidates) {
    const normalized = normalizeEmail(candidate);
    if (isValidEmail(normalized)) return normalized;
  }

  return null;
}

function buildCafeAlerts(healthRow) {
  const alerts = [];

  if (!healthRow.ownerAccessCount) {
    alerts.push({
      severity: 'critical',
      title: 'No owner access assigned',
      description: 'This cafe has no active owner/team members assigned in the owner portal.'
    });
  }

  if (healthRow.daysSinceTransaction === null || healthRow.daysSinceTransaction > 3) {
    alerts.push({
      severity: 'high',
      title: 'Sales data is stale',
      description: 'Recent transactions are missing or delayed, which can distort tomorrow’s prep forecast.'
    });
  }

  if (healthRow.daysSinceDailyLog === null || healthRow.daysSinceDailyLog > 2) {
    alerts.push({
      severity: 'medium',
      title: 'End-of-day actuals are missing',
      description: 'Daily logs have not been updated recently, so savings and waste metrics are running blind.'
    });
  }

  if (healthRow.recipeCoveragePct < 80 && healthRow.activeItems > 0) {
    alerts.push({
      severity: 'high',
      title: 'Recipe coverage is incomplete',
      description: `${healthRow.activeItems - healthRow.itemsWithRecipes} active menu item(s) do not have recipe mappings.`
    });
  }

  if (healthRow.unmappedTransactions > 0) {
    alerts.push({
      severity: 'medium',
      title: 'Unmapped sales rows detected',
      description: `${healthRow.unmappedTransactions} transaction row(s) could not be matched to menu items in the selected range.`
    });
  }

  if (healthRow.ingredientsMissingUnit > 0 || healthRow.duplicateItemGroups > 0) {
    alerts.push({
      severity: 'medium',
      title: 'Data quality cleanup needed',
      description: `${healthRow.ingredientsMissingUnit} ingredient unit gaps and ${healthRow.duplicateItemGroups} duplicate active item name group(s).`
    });
  }

  if (healthRow.avgAbsErrorPct !== null && healthRow.avgAbsErrorPct > 25) {
    alerts.push({
      severity: 'high',
      title: 'Forecast drift is rising',
      description: `Average absolute forecast error is ${Math.round(healthRow.avgAbsErrorPct)}% in the selected range.`
    });
  }

  if (healthRow.actualCaptureRate < 35 && healthRow.prepRowsInRange > 0) {
    alerts.push({
      severity: 'medium',
      title: 'Actual prep capture is low',
      description: `Only ${Math.round(healthRow.actualCaptureRate)}% of prep rows have actual prep recorded.`
    });
  }

  if (healthRow.learningCoveragePct < 40 && healthRow.activeItems > 0 && healthRow.learningEnabled) {
    alerts.push({
      severity: 'info',
      title: 'Learning coverage is still thin',
      description: 'This cafe is still building enough item-level history for stronger auto-learning adjustments.'
    });
  }

  return alerts.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function summarizeCafeHealth(cafe, metrics, supplemental = {}) {
  const recipeCoveragePct = supplemental.activeItems
    ? Math.round((supplemental.itemsWithRecipes / supplemental.activeItems) * 100)
    : 0;
  const learningCoveragePct = supplemental.activeItems
    ? Math.round((supplemental.learningItems / supplemental.activeItems) * 100)
    : 0;
  const completionRate = supplemental.prepRowsInRange
    ? Math.round((supplemental.prepCompletedInRange / supplemental.prepRowsInRange) * 100)
    : 0;
  const actualCaptureRate = supplemental.prepRowsInRange
    ? Math.round((supplemental.prepActualsInRange / supplemental.prepRowsInRange) * 100)
    : 0;
  const reportingRate = supplemental.rangeDayCount
    ? Math.round((supplemental.logCountInRange / supplemental.rangeDayCount) * 100)
    : 0;

  const syncStatus = supplemental.daysSinceTransaction === null
    ? 'No POS data'
    : supplemental.daysSinceTransaction <= 1
      ? 'Live'
      : supplemental.daysSinceTransaction <= 3
        ? 'Lagging'
        : 'Stale';
  const loggingStatus = supplemental.daysSinceDailyLog === null
    ? 'No actuals'
    : supplemental.daysSinceDailyLog <= 1
      ? 'Current'
      : supplemental.daysSinceDailyLog <= 3
        ? 'Behind'
        : 'Missing';
  const prepStatus = supplemental.prepItemsToday > 0 ? 'Generated today' : 'Missing today';
  const forecastStatus = supplemental.avgAbsErrorPct === null
    ? 'Warming up'
    : supplemental.avgAbsErrorPct <= 15
      ? 'Stable'
      : supplemental.avgAbsErrorPct <= 25
        ? 'Watch'
        : 'Drift';
  const learningStatus = !cafe.learning_enabled
    ? 'Paused'
    : learningCoveragePct >= 70
      ? 'Strong'
      : learningCoveragePct >= 35
        ? 'Growing'
        : 'Thin';

  const healthRow = {
    cafeId: cafe.id,
    cafeName: cafe.name,
    city: cafe.city,
    ownerName: cafe.owner_name || null,
    cafe,
    metrics,
    totalSavings: Math.round(Number(metrics?.allTime?.totalSavings || 0)),
    wasteSaved: Math.round(Number(metrics?.allTime?.wasteSaved || 0)),
    labourSaved: Math.round(Number(metrics?.allTime?.labourSaved$ || 0)),
    forecastAccuracy: Math.round(Number(metrics?.forecastAccuracy || 0)),
    wasteReductionPct: Math.round(Number(metrics?.wasteReductionPct || 0)),
    recorded86: Number(metrics?.allTime?.total86 || 0),
    daysRunning: Number(metrics?.daysRunning || 0),
    ownerAccessCount: supplemental.ownerAccessCount,
    activeItems: supplemental.activeItems,
    itemsWithRecipes: supplemental.itemsWithRecipes,
    recipeCoveragePct,
    ingredientsMissingUnit: supplemental.ingredientsMissingUnit,
    duplicateItemGroups: supplemental.duplicateItemGroups,
    unmappedTransactions: supplemental.unmappedTransactions,
    learningEnabled: cafe.learning_enabled !== false,
    aiDecisionEnabled: cafe.ai_decision_enabled !== false,
    weatherSensitivity: Math.round(Number(cafe.weather_sensitivity || 1) * 100) / 100,
    learningCoveragePct,
    learningItems: supplemental.learningItems,
    avgAbsErrorPct: supplemental.avgAbsErrorPct === null ? null : Math.round(Number(supplemental.avgAbsErrorPct)),
    actualForecastSamples: supplemental.actualForecastSamples,
    aiAppliedCount: supplemental.aiAppliedCount,
    prepRowsInRange: supplemental.prepRowsInRange,
    completionRate,
    actualCaptureRate,
    reportingRate,
    logCountInRange: supplemental.logCountInRange,
    prepItemsToday: supplemental.prepItemsToday,
    lastTransactionDate: supplemental.lastTransactionDate,
    lastDailyLogDate: supplemental.lastDailyLogDate,
    lastPrepDate: supplemental.lastPrepDate,
    daysSinceTransaction: supplemental.daysSinceTransaction,
    daysSinceDailyLog: supplemental.daysSinceDailyLog,
    daysSincePrep: supplemental.daysSincePrep,
    syncStatus,
    loggingStatus,
    prepStatus,
    forecastStatus,
    learningStatus
  };

  const alerts = buildCafeAlerts(healthRow);
  const riskScore = alerts.reduce((score, alert) => {
    if (alert.severity === 'critical') return score + 40;
    if (alert.severity === 'high') return score + 25;
    if (alert.severity === 'medium') return score + 12;
    return score + 4;
  }, 0) + Math.min(20, Math.round(Number(healthRow.avgAbsErrorPct || 0) / 4));

  return {
    ...healthRow,
    issueCount: alerts.length,
    riskScore,
    riskLevel: riskScore >= 70 ? 'High' : riskScore >= 35 ? 'Medium' : 'Low',
    alerts
  };
}

async function getOwnerContactsForCafe(cafeId) {
  const result = await pool.query(
    `SELECT
       o.id,
       o.email,
       COALESCE(NULLIF(o.full_name, ''), CONCAT_WS(' ', NULLIF(o.first_name, ''), NULLIF(o.last_name, ''))) AS full_name,
       o.active,
       oca.access_role
     FROM owner_cafe_access oca
     JOIN owner_users o ON o.id = oca.owner_id
     WHERE oca.cafe_id = $1
     ORDER BY CASE oca.access_role
       WHEN 'owner' THEN 0
       WHEN 'admin' THEN 1
       WHEN 'editor' THEN 2
       ELSE 3
     END, LOWER(o.email)`,
    [cafeId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name || row.email,
    active: Boolean(row.active),
    accessRole: normalizeOwnerAccessRole(row.access_role)
  }));
}

async function buildAdminHqSnapshot(options = {}) {
  const selectedCafeId = Number(options.selectedCafeId) || null;
  const range = ensureAnalyticsDateRange(options, 30);
  const rangeDayCount = Math.max(
    1,
    Math.floor(
      (
        new Date(`${range.endDate}T12:00:00`).getTime() -
        new Date(`${range.startDate}T12:00:00`).getTime()
      ) / 86400000
    ) + 1
  );

  const cafesResult = await pool.query(
    `SELECT
       c.*,
       COALESCE(oca.owner_access_count, 0)::int AS owner_access_count
     FROM cafes c
     LEFT JOIN (
       SELECT cafe_id, COUNT(*)::int AS owner_access_count
       FROM owner_cafe_access
       GROUP BY cafe_id
     ) oca ON oca.cafe_id = c.id
     WHERE c.active = true
     ORDER BY c.name ASC`
  );

  const cafes = cafesResult.rows;
  if (!cafes.length) {
    return {
      range,
      overview: {
        activeCafes: 0,
        cafesReporting: 0,
        totalSavings: 0,
        wasteSaved: 0,
        labourSaved: 0,
        recorded86: 0,
        avgForecastAccuracy: 0,
        avgActualCaptureRate: 0,
        prepReadyToday: 0,
        criticalAlerts: 0
      },
      chartSeries: { savingsByCafe: [] },
      cafeHealth: [],
      alerts: [],
      benchmarking: {
        topSavings: [],
        topAccuracy: [],
        strongestAdoption: [],
        highestRisk: []
      },
      dataQuality: {
        summary: {
          duplicateItemGroups: 0,
          ingredientsMissingUnit: 0,
          unmappedTransactions: 0,
          lowRecipeCoverageCafes: 0
        },
        cafes: []
      },
      modelCenter: {
        config: {
          aiEnabled: ['1', 'true', 'yes'].includes(String(process.env.ENABLE_AI_DECISIONS || 'true').trim().toLowerCase()),
          model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          learningHistoryDays: Number(process.env.LEARNING_HISTORY_DAYS || 60),
          confidenceSamples: Number(process.env.LEARNING_CONFIDENCE_SAMPLES || 8)
        },
        summary: {
          cafesLearningDisabled: 0,
          avgLearningCoveragePct: 0,
          avgAbsErrorPct: 0,
          driftCafes: 0
        },
        cafes: []
      },
      selectedCafe: null,
      auditTrail: []
    };
  }

  const cafeIds = cafes.map((cafe) => cafe.id);
  const today = isoDateFromDate(new Date());

  const [
    metricsEntries,
    transactionFreshness,
    logFreshness,
    prepFreshness,
    recipeCoverage,
    ingredientUnitGaps,
    duplicateItems,
    unmappedTransactions,
    learningCoverage,
    forecastPerformance,
    auditRows
  ] = await Promise.all([
    Promise.all(
      cafes.map(async (cafe) => [cafe.id, await buildMetrics(cafe.id, range)])
    ),
    pool.query(
      `SELECT
         cafe_id,
         MAX(date)::date AS last_transaction_date,
         COUNT(*) FILTER (WHERE date >= $1::date AND date <= $2::date)::int AS tx_count_in_range
       FROM transactions
       WHERE cafe_id = ANY($3::int[])
       GROUP BY cafe_id`,
      [range.startDate, range.endDate, cafeIds]
    ),
    pool.query(
      `SELECT
         cafe_id,
         MAX(date)::date AS last_daily_log_date,
         COUNT(*) FILTER (WHERE date >= $1::date AND date <= $2::date)::int AS log_count_in_range
       FROM daily_logs
       WHERE cafe_id = ANY($3::int[])
       GROUP BY cafe_id`,
      [range.startDate, range.endDate, cafeIds]
    ),
    pool.query(
      `SELECT
         cafe_id,
         MAX(date)::date AS last_prep_date,
         COUNT(*) FILTER (WHERE date = $1::date)::int AS prep_items_today,
         COUNT(*) FILTER (WHERE date >= $2::date AND date <= $3::date)::int AS prep_rows_in_range,
         COUNT(*) FILTER (WHERE date >= $2::date AND date <= $3::date AND completed = true)::int AS prep_completed_in_range,
         COUNT(*) FILTER (WHERE date >= $2::date AND date <= $3::date AND actual_prepped_quantity IS NOT NULL)::int AS prep_actuals_in_range
       FROM prep_lists
       WHERE cafe_id = ANY($4::int[])
       GROUP BY cafe_id`,
      [today, range.startDate, range.endDate, cafeIds]
    ),
    pool.query(
      `SELECT
         i.cafe_id,
         COUNT(DISTINCT i.id) FILTER (WHERE i.active = true)::int AS active_items,
         COUNT(DISTINCT CASE WHEN i.active = true AND r.item_id IS NOT NULL THEN i.id END)::int AS items_with_recipes
       FROM items i
       LEFT JOIN recipes r ON r.cafe_id = i.cafe_id AND r.item_id = i.id
       WHERE i.cafe_id = ANY($1::int[])
       GROUP BY i.cafe_id`,
      [cafeIds]
    ),
    pool.query(
      `SELECT cafe_id, COUNT(*)::int AS ingredients_missing_unit
       FROM ingredients
       WHERE cafe_id = ANY($1::int[])
         AND COALESCE(TRIM(unit), '') = ''
       GROUP BY cafe_id`,
      [cafeIds]
    ),
    pool.query(
      `SELECT cafe_id, COUNT(*)::int AS duplicate_item_groups
       FROM (
         SELECT cafe_id, LOWER(TRIM(name)) AS normalized_name
         FROM items
         WHERE cafe_id = ANY($1::int[]) AND active = true
         GROUP BY cafe_id, LOWER(TRIM(name))
         HAVING COUNT(*) > 1
       ) grouped
       GROUP BY cafe_id`,
      [cafeIds]
    ),
    pool.query(
      `SELECT t.cafe_id, COUNT(*)::int AS unmapped_transactions
       FROM transactions t
       LEFT JOIN items i
         ON i.cafe_id = t.cafe_id
        AND (i.id = t.item_id OR LOWER(TRIM(i.name)) = LOWER(TRIM(t.item_name)))
       WHERE t.cafe_id = ANY($1::int[])
         AND t.date >= $2::date
         AND t.date <= $3::date
         AND i.id IS NULL
       GROUP BY t.cafe_id`,
      [cafeIds, range.startDate, range.endDate]
    ),
    pool.query(
      `SELECT
         i.cafe_id,
         COUNT(DISTINCT i.id) FILTER (WHERE i.active = true)::int AS active_items,
         COUNT(DISTINCT ils.item_id)::int AS learning_items
       FROM items i
       LEFT JOIN item_learning_state ils
         ON ils.cafe_id = i.cafe_id
        AND ils.item_id = i.id
       WHERE i.cafe_id = ANY($1::int[])
       GROUP BY i.cafe_id`,
      [cafeIds]
    ),
    pool.query(
      `SELECT
         cafe_id,
         COUNT(*) FILTER (WHERE forecast_date >= $1::date AND forecast_date <= $2::date AND actual_qty IS NOT NULL)::int AS actual_forecast_samples,
         AVG(ABS(error_pct)) FILTER (WHERE forecast_date >= $1::date AND forecast_date <= $2::date AND actual_qty IS NOT NULL) AS avg_abs_error_pct,
         COUNT(*) FILTER (WHERE forecast_date >= $1::date AND forecast_date <= $2::date AND ai_applied = true)::int AS ai_applied_count
       FROM forecast_item_actuals
       WHERE cafe_id = ANY($3::int[])
       GROUP BY cafe_id`,
      [range.startDate, range.endDate, cafeIds]
    ),
    pool.query(
      `SELECT *
       FROM admin_audit_events
       ORDER BY created_at DESC
       LIMIT 40`
    )
  ]);

  const metricsByCafeId = new Map(metricsEntries);
  const txByCafeId = mapRowsByCafeId(transactionFreshness.rows);
  const logsByCafeId = mapRowsByCafeId(logFreshness.rows);
  const prepByCafeId = mapRowsByCafeId(prepFreshness.rows);
  const recipeByCafeId = mapRowsByCafeId(recipeCoverage.rows);
  const unitsByCafeId = mapRowsByCafeId(ingredientUnitGaps.rows);
  const duplicateByCafeId = mapRowsByCafeId(duplicateItems.rows);
  const unmappedByCafeId = mapRowsByCafeId(unmappedTransactions.rows);
  const learningByCafeId = mapRowsByCafeId(learningCoverage.rows);
  const forecastByCafeId = mapRowsByCafeId(forecastPerformance.rows);

  const cafeHealth = cafes.map((cafe) => {
    const metrics = metricsByCafeId.get(cafe.id) || null;
    const txRow = txByCafeId.get(cafe.id) || {};
    const logRow = logsByCafeId.get(cafe.id) || {};
    const prepRow = prepByCafeId.get(cafe.id) || {};
    const recipeRow = recipeByCafeId.get(cafe.id) || {};
    const unitRow = unitsByCafeId.get(cafe.id) || {};
    const duplicateRow = duplicateByCafeId.get(cafe.id) || {};
    const unmappedRow = unmappedByCafeId.get(cafe.id) || {};
    const learningRow = learningByCafeId.get(cafe.id) || {};
    const forecastRow = forecastByCafeId.get(cafe.id) || {};

    return summarizeCafeHealth(cafe, metrics, {
      ownerAccessCount: Number(cafe.owner_access_count || 0),
      activeItems: Number(recipeRow.active_items || learningRow.active_items || 0),
      itemsWithRecipes: Number(recipeRow.items_with_recipes || 0),
      ingredientsMissingUnit: Number(unitRow.ingredients_missing_unit || 0),
      duplicateItemGroups: Number(duplicateRow.duplicate_item_groups || 0),
      unmappedTransactions: Number(unmappedRow.unmapped_transactions || 0),
      learningItems: Number(learningRow.learning_items || 0),
      avgAbsErrorPct: forecastRow.avg_abs_error_pct === null || forecastRow.avg_abs_error_pct === undefined
        ? null
        : Number(forecastRow.avg_abs_error_pct),
      actualForecastSamples: Number(forecastRow.actual_forecast_samples || 0),
      aiAppliedCount: Number(forecastRow.ai_applied_count || 0),
      prepRowsInRange: Number(prepRow.prep_rows_in_range || 0),
      prepCompletedInRange: Number(prepRow.prep_completed_in_range || 0),
      prepActualsInRange: Number(prepRow.prep_actuals_in_range || 0),
      prepItemsToday: Number(prepRow.prep_items_today || 0),
      logCountInRange: Number(logRow.log_count_in_range || 0),
      lastTransactionDate: normalizeIsoDate(txRow.last_transaction_date),
      lastDailyLogDate: normalizeIsoDate(logRow.last_daily_log_date),
      lastPrepDate: normalizeIsoDate(prepRow.last_prep_date),
      daysSinceTransaction: diffDaysFromToday(txRow.last_transaction_date),
      daysSinceDailyLog: diffDaysFromToday(logRow.last_daily_log_date),
      daysSincePrep: diffDaysFromToday(prepRow.last_prep_date),
      rangeDayCount
    });
  });

  const flattenedAlerts = cafeHealth
    .flatMap((row) => row.alerts.map((alert) => ({
      ...alert,
      cafeId: row.cafeId,
      cafeName: row.cafeName,
      city: row.city,
      riskLevel: row.riskLevel
    })))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const overview = {
    activeCafes: cafeHealth.length,
    cafesReporting: cafeHealth.filter((row) => row.logCountInRange > 0 || row.prepRowsInRange > 0).length,
    totalSavings: Math.round(cafeHealth.reduce((sum, row) => sum + row.totalSavings, 0)),
    wasteSaved: Math.round(cafeHealth.reduce((sum, row) => sum + row.wasteSaved, 0)),
    labourSaved: Math.round(cafeHealth.reduce((sum, row) => sum + row.labourSaved, 0)),
    recorded86: Math.round(cafeHealth.reduce((sum, row) => sum + row.recorded86, 0)),
    avgForecastAccuracy: Math.round(averageNumbers(cafeHealth.map((row) => row.forecastAccuracy))),
    avgActualCaptureRate: Math.round(averageNumbers(cafeHealth.map((row) => row.actualCaptureRate))),
    avgReportingRate: Math.round(averageNumbers(cafeHealth.map((row) => row.reportingRate))),
    prepReadyToday: cafeHealth.filter((row) => row.prepItemsToday > 0).length,
    criticalAlerts: flattenedAlerts.filter((alert) => ['critical', 'high'].includes(alert.severity)).length
  };

  const chartSeries = {
    savingsByCafe: [...cafeHealth]
      .sort((a, b) => b.totalSavings - a.totalSavings)
      .slice(0, 8)
      .map((row) => ({
        cafeId: row.cafeId,
        cafeName: row.cafeName,
        totalSavings: row.totalSavings,
        forecastAccuracy: row.forecastAccuracy,
        riskScore: row.riskScore
      }))
  };

  const benchmarking = {
    topSavings: [...cafeHealth]
      .sort((a, b) => b.totalSavings - a.totalSavings)
      .slice(0, 5),
    topAccuracy: [...cafeHealth]
      .sort((a, b) => b.forecastAccuracy - a.forecastAccuracy)
      .slice(0, 5),
    strongestAdoption: [...cafeHealth]
      .sort((a, b) => b.actualCaptureRate - a.actualCaptureRate)
      .slice(0, 5),
    highestRisk: [...cafeHealth]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 5)
  };

  const dataQuality = {
    summary: {
      duplicateItemGroups: cafeHealth.reduce((sum, row) => sum + row.duplicateItemGroups, 0),
      ingredientsMissingUnit: cafeHealth.reduce((sum, row) => sum + row.ingredientsMissingUnit, 0),
      unmappedTransactions: cafeHealth.reduce((sum, row) => sum + row.unmappedTransactions, 0),
      lowRecipeCoverageCafes: cafeHealth.filter((row) => row.activeItems > 0 && row.recipeCoveragePct < 80).length
    },
    cafes: [...cafeHealth]
      .sort((a, b) =>
        (b.duplicateItemGroups + b.ingredientsMissingUnit + b.unmappedTransactions) -
        (a.duplicateItemGroups + a.ingredientsMissingUnit + a.unmappedTransactions)
      )
      .slice(0, 8)
  };

  const modelCenter = {
    config: {
      aiEnabled: ['1', 'true', 'yes'].includes(String(process.env.ENABLE_AI_DECISIONS || 'true').trim().toLowerCase()),
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      learningHistoryDays: Number(process.env.LEARNING_HISTORY_DAYS || 60),
      confidenceSamples: Number(process.env.LEARNING_CONFIDENCE_SAMPLES || 8),
      ratioMin: Number(process.env.LEARNING_RATIO_MIN || 0.75),
      ratioMax: Number(process.env.LEARNING_RATIO_MAX || 1.25)
    },
    summary: {
      cafesLearningDisabled: cafeHealth.filter((row) => !row.learningEnabled).length,
      cafesAiDisabled: cafeHealth.filter((row) => !row.aiDecisionEnabled).length,
      avgLearningCoveragePct: Math.round(averageNumbers(cafeHealth.map((row) => row.learningCoveragePct))),
      avgAbsErrorPct: Math.round(averageNumbers(cafeHealth.map((row) => row.avgAbsErrorPct))),
      driftCafes: cafeHealth.filter((row) => row.avgAbsErrorPct !== null && row.avgAbsErrorPct > 25).length
    },
    cafes: [...cafeHealth]
      .sort((a, b) => (b.avgAbsErrorPct || 0) - (a.avgAbsErrorPct || 0))
      .slice(0, 8)
  };

  const resolvedSelectedCafe =
    cafeHealth.find((row) => row.cafeId === selectedCafeId)
    || benchmarking.highestRisk[0]
    || cafeHealth[0]
    || null;

  const selectedCafe = resolvedSelectedCafe
    ? {
        ...resolvedSelectedCafe,
        ownerContacts: await getOwnerContactsForCafe(resolvedSelectedCafe.cafeId),
        recentAudit: auditRows.rows
          .filter((row) => Number(row.cafe_id) === resolvedSelectedCafe.cafeId)
          .slice(0, 8)
          .map(normalizeAuditRow)
      }
    : null;

  return {
    range,
    overview,
    chartSeries,
    cafeHealth,
    alerts: flattenedAlerts.slice(0, 24),
    benchmarking,
    dataQuality,
    modelCenter,
    selectedCafe,
    auditTrail: auditRows.rows.map(normalizeAuditRow)
  };
}

// ─── ADMIN HQ ────────────────────────────────────────────────────────────────
router.get('/admin/hq', async (req, res) => {
  try {
    const selectedCafeId = req.query.selectedCafeId ? parseInt(req.query.selectedCafeId, 10) : null;
    if (req.query.selectedCafeId && Number.isNaN(selectedCafeId)) {
      return res.status(400).json({ error: 'selectedCafeId must be a valid number' });
    }

    const snapshot = await buildAdminHqSnapshot({
      ...resolveDateRangeOptions(req.query),
      selectedCafeId
    });
    res.json(snapshot);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/admin/ml/feature-store/summary', async (req, res) => {
  try {
    const cafeId = req.query.cafeId ? parseInt(req.query.cafeId, 10) : null;
    if (req.query.cafeId && Number.isNaN(cafeId)) {
      return res.status(400).json({ error: 'cafeId must be a valid number' });
    }

    const summary = await mlFeatureService.getFeatureStoreSummary({
      cafeId,
      ...resolveDateRangeOptions(req.query)
    });
    res.json(summary);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/admin/ml/feature-store/rebuild', async (req, res) => {
  try {
    const rawCafeId = req.body?.cafeId ?? req.query?.cafeId ?? null;
    const cafeId = rawCafeId === null || rawCafeId === '' ? null : parseInt(rawCafeId, 10);
    if (rawCafeId !== null && rawCafeId !== '' && Number.isNaN(cafeId)) {
      return res.status(400).json({ error: 'cafeId must be a valid number' });
    }

    const startDate = normalizeIsoDate(req.body?.startDate || req.query?.startDate);
    const endDate = normalizeIsoDate(req.body?.endDate || req.query?.endDate);
    if ((req.body?.startDate || req.query?.startDate) && !startDate) {
      return res.status(400).json({ error: 'startDate must be a valid YYYY-MM-DD value' });
    }
    if ((req.body?.endDate || req.query?.endDate) && !endDate) {
      return res.status(400).json({ error: 'endDate must be a valid YYYY-MM-DD value' });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ error: 'startDate cannot be after endDate' });
    }

    const actorEmail = getAdminActorEmail(req);
    const result = await mlFeatureService.buildFeatureStore({
      cafeId,
      startDate,
      endDate,
      requestedBy: actorEmail || 'admin',
      source: 'admin_portal'
    });

    await writeAdminAuditEvent({
      eventType: 'ml.feature_store.rebuild',
      severity: 'medium',
      cafeId,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `ML feature store rebuilt${cafeId ? ` for cafe ${cafeId}` : ' across active cafes'}`,
      details: result
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/admin/ml/feature-store', async (req, res) => {
  try {
    const cafeId = req.query.cafeId ? parseInt(req.query.cafeId, 10) : null;
    if (req.query.cafeId && Number.isNaN(cafeId)) {
      return res.status(400).json({ error: 'cafeId must be a valid number' });
    }

    const rows = await mlFeatureService.listFeatureRows({
      cafeId,
      ...resolveDateRangeOptions(req.query),
      limit: req.query.limit
    });
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/admin/ml/feature-store/export.csv', async (req, res) => {
  try {
    const cafeId = req.query.cafeId ? parseInt(req.query.cafeId, 10) : null;
    if (req.query.cafeId && Number.isNaN(cafeId)) {
      return res.status(400).json({ error: 'cafeId must be a valid number' });
    }

    const csv = await mlFeatureService.exportFeatureRowsCsv({
      cafeId,
      ...resolveDateRangeOptions(req.query),
      limit: req.query.limit
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ml-feature-store.csv"');
    res.send(csv);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/admin/cafes/:cafeId/support-actions', async (req, res) => {
  const cafeId = parseInt(req.params.cafeId, 10);
  const action = String(req.body?.action || '').trim().toLowerCase();
  const date = normalizeIsoDate(req.body?.date) || isoDateFromDate(new Date());
  const actorEmail = getAdminActorEmail(req);

  if (Number.isNaN(cafeId)) {
    return res.status(400).json({ error: 'Invalid cafe id' });
  }

  const supportedActions = new Set(['send_prep_list', 'rerun_forecast', 'refresh_learning', 'send_check_in']);
  if (!supportedActions.has(action)) {
    return res.status(400).json({ error: 'Unsupported support action' });
  }

  try {
    const cafeResult = await pool.query('SELECT * FROM cafes WHERE id = $1 AND active = true', [cafeId]);
    if (!cafeResult.rows.length) {
      return res.status(404).json({ error: 'Cafe not found' });
    }
    const cafe = cafeResult.rows[0];

    let response;
    if (action === 'send_prep_list') {
      const forecast = await forecastService.generateForecast(cafeId, date);
      const emailResult = await emailService.sendPrepList(cafe, forecast);
      response = {
        ok: true,
        action,
        date,
        message: 'Prep list re-sent to cafe contacts.',
        recipient: emailResult?.to || cafe.kitchen_lead_email || cafe.email
      };
    } else if (action === 'rerun_forecast') {
      const forecast = await forecastService.generateForecast(cafeId, date);
      if (!forecast.closed) {
        await forecastService.savePrepList(cafeId, date, forecast.prepList);
      }
      response = {
        ok: true,
        action,
        date,
        message: forecast.closed
          ? 'Cafe is closed on the selected date. No prep list generated.'
          : 'Forecast rerun completed and prep list refreshed.',
        learning: forecast.learning,
        aiDecision: forecast.aiDecision
      };
    } else if (action === 'refresh_learning') {
      const forecast = await forecastService.generateForecast(cafeId, date);
      response = {
        ok: true,
        action,
        date,
        message: 'Learning state refreshed from latest actuals.',
        learning: forecast.learning,
        aiDecision: forecast.aiDecision
      };
    } else {
      const emailResult = await emailService.sendDailyCheckIn(cafe);
      response = {
        ok: true,
        action,
        date,
        message: 'Daily check-in reminder sent.',
        recipient: emailResult?.to || cafe.kitchen_lead_email || cafe.email
      };
    }

    await writeAdminAuditEvent({
      eventType: `support.${action}`,
      severity: action === 'send_prep_list' ? 'info' : 'medium',
      cafeId,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${cafe.name}: ${response.message}`,
      details: {
        action,
        date,
        recipient: response.recipient || null
      }
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/cafes/:cafeId/model-controls', async (req, res) => {
  const cafeId = parseInt(req.params.cafeId, 10);
  const actorEmail = getAdminActorEmail(req);

  if (Number.isNaN(cafeId)) {
    return res.status(400).json({ error: 'Invalid cafe id' });
  }

  const learningEnabled = parseBooleanValue(req.body?.learning_enabled);
  const aiDecisionEnabled = parseBooleanValue(req.body?.ai_decision_enabled);
  const weatherSensitivity = toNumberOrNull(req.body?.weather_sensitivity);

  if (learningEnabled === null && aiDecisionEnabled === null && weatherSensitivity === null) {
    return res.status(400).json({
      error: 'Provide learning_enabled, ai_decision_enabled, or weather_sensitivity to update model controls.'
    });
  }

  if (weatherSensitivity !== null && (weatherSensitivity < 0.5 || weatherSensitivity > 1.5)) {
    return res.status(400).json({ error: 'weather_sensitivity must be between 0.5 and 1.5' });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (learningEnabled !== null) {
    updates.push(`learning_enabled = $${idx++}`);
    values.push(learningEnabled);
  }
  if (aiDecisionEnabled !== null) {
    updates.push(`ai_decision_enabled = $${idx++}`);
    values.push(aiDecisionEnabled);
  }
  if (weatherSensitivity !== null) {
    updates.push(`weather_sensitivity = $${idx++}`);
    values.push(weatherSensitivity);
  }

  values.push(cafeId);

  try {
    const result = await pool.query(
      `UPDATE cafes
       SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Cafe not found' });
    }

    const updatedCafe = result.rows[0];

    await writeAdminAuditEvent({
      eventType: 'model_controls.updated',
      severity: 'info',
      cafeId,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${updatedCafe.name}: model controls updated`,
      details: {
        learning_enabled: updatedCafe.learning_enabled,
        ai_decision_enabled: updatedCafe.ai_decision_enabled,
        weather_sensitivity: updatedCafe.weather_sensitivity
      }
    });

    res.json(updatedCafe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function requireOwnerAuth(req, res, next) {
  const secret = getOwnerAuthSecret();
  if (!secret) {
    return res.status(503).json({
      error: 'Owner auth is not configured. Set OWNER_AUTH_SECRET (or PREP_RUN_TOKEN).'
    });
  }

  const token = extractBearerToken(req.headers.authorization || '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, secret);
    if (payload?.role !== 'owner' || !payload?.email) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.owner = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

async function requireOwnerCafeAccess(req, res, next) {
  try {
    const cafeId = parseInt(req.params.cafeId, 10);
    if (Number.isNaN(cafeId)) {
      return res.status(400).json({ error: 'Invalid cafe id' });
    }

    const { cafes } = await getOwnerAccessByEmail(req.owner.email);
    const allowedCafe = cafes.find((cafe) => cafe.id === cafeId);
    if (!allowedCafe) {
      return res.status(403).json({ error: 'You do not have access to this cafe' });
    }

    req.ownerCafe = allowedCafe;
    req.ownerCafeAccessRole = normalizeOwnerAccessRole(allowedCafe.access_role);
    req.ownerCafePermissions = buildOwnerPermissions(allowedCafe.access_role);
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function requireOwnerCafeEditAccess(req, res, next) {
  if (req.ownerCafePermissions?.canEdit) {
    return next();
  }
  return res.status(403).json({ error: 'Your role is view-only for this cafe.' });
}

function requireOwnerCafeAdminAccess(req, res, next) {
  if (req.ownerCafePermissions?.canManageTeam) {
    return next();
  }
  return res.status(403).json({ error: 'Only cafe admins can manage team access.' });
}

// ─── OWNER AUTH ────────────────────────────────────────────────────────────────
router.post('/owner-auth/request-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const secret = getOwnerAuthSecret();

  if (!secret) {
    return res.status(503).json({
      error: 'Owner auth is not configured. Set OWNER_AUTH_SECRET (or PREP_RUN_TOKEN).'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    const { cafes } = await getOwnerAccessByEmail(email);
    if (!cafes.length) {
      return res.status(404).json({ error: 'No active cafe found for this email' });
    }

    const incomingProfile = sanitizeOwnerProfileInput(req.body || {});
    const existingProfile = await getOwnerProfileByEmail(email);
    const mergedProfile = mergeOwnerProfile(existingProfile || {}, incomingProfile);
    const { missingFields, errors } = validateMergedOwnerProfile(mergedProfile);

    if (missingFields.length) {
      return res.status(400).json({
        error: 'Please complete all required profile fields before signing in.',
        missingFields
      });
    }
    if (errors.length) {
      return res.status(400).json({ error: errors[0] });
    }

    const requiresSms2fa = isSms2faRequired() || smsService.isConfigured();
    if (requiresSms2fa && !mergedProfile.phone) {
      return res.status(400).json({
        error: 'A valid primary phone number is required for SMS verification.'
      });
    }

    if (existingProfile?.id) {
      await pool.query(
        `UPDATE owner_users
         SET full_name = $1,
             first_name = $2,
             last_name = $3,
             phone = $4,
             secondary_phone = $5,
             city = $6,
             province = $7,
             street_address = $8,
             unit_number = $9,
             postal_code = $10,
             active = true,
             updated_at = NOW()
         WHERE id = $11`,
        [
          mergedProfile.full_name,
          mergedProfile.first_name,
          mergedProfile.last_name,
          mergedProfile.phone,
          mergedProfile.secondary_phone,
          mergedProfile.city,
          mergedProfile.province,
          mergedProfile.street_address,
          mergedProfile.unit_number,
          mergedProfile.postal_code,
          existingProfile.id
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO owner_users (
           email,
           full_name,
           first_name,
           last_name,
           phone,
           secondary_phone,
           city,
           province,
           street_address,
           unit_number,
           postal_code,
           active
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
        [
          email,
          mergedProfile.full_name,
          mergedProfile.first_name,
          mergedProfile.last_name,
          mergedProfile.phone,
          mergedProfile.secondary_phone,
          mergedProfile.city,
          mergedProfile.province,
          mergedProfile.street_address,
          mergedProfile.unit_number,
          mergedProfile.postal_code
        ]
      );
    }

    const emailCode = createOwnerCode();
    const emailCodeHash = hashOwnerCode(email, 'email', emailCode, secret);
    let smsCodeHash = null;

    await emailService.sendOwnerLoginCode({
      email,
      code: emailCode,
      cafes,
      expiresMinutes: OWNER_CODE_TTL_MINUTES
    });

    if (requiresSms2fa) {
      const smsCode = createOwnerCode();
      await smsService.sendOwnerLoginCode({
        phone: mergedProfile.phone,
        code: smsCode,
        expiresMinutes: OWNER_CODE_TTL_MINUTES
      });
      smsCodeHash = hashOwnerCode(email, 'sms', smsCode, secret);
    }

    ownerCodeStore.set(email, {
      emailCodeHash,
      smsCodeHash,
      expiresAt: Date.now() + OWNER_CODE_TTL_MINUTES * 60 * 1000
    });

    return res.json({
      ok: true,
      requiresPhoneCode: Boolean(smsCodeHash),
      message: Boolean(smsCodeHash)
        ? 'Verification code sent to your email and phone.'
        : 'Verification code sent to your email.'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/owner-auth/verify-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const emailCode = String(req.body?.email_code || req.body?.code || '').trim();
  const phoneCode = String(req.body?.phone_code || '').trim();
  const secret = getOwnerAuthSecret();

  if (!secret) {
    return res.status(503).json({
      error: 'Owner auth is not configured. Set OWNER_AUTH_SECRET (or PREP_RUN_TOKEN).'
    });
  }

  if (!isValidEmail(email) || !/^\d{6}$/.test(emailCode)) {
    return res.status(400).json({ error: 'Email and 6-digit email code are required' });
  }

  try {
    const stored = ownerCodeStore.get(email);
    if (!stored || stored.expiresAt < Date.now()) {
      ownerCodeStore.delete(email);
      return res.status(401).json({ error: 'Code expired or invalid. Request a new one.' });
    }

    const expectedEmailHash = stored.emailCodeHash;
    const submittedEmailHash = hashOwnerCode(email, 'email', emailCode, secret);
    if (!isMatchingCodeHash(expectedEmailHash, submittedEmailHash)) {
      return res.status(401).json({ error: 'Incorrect email code' });
    }

    if (stored.smsCodeHash) {
      if (!/^\d{6}$/.test(phoneCode)) {
        return res.status(400).json({ error: '6-digit phone code is required' });
      }
      const submittedSmsHash = hashOwnerCode(email, 'sms', phoneCode, secret);
      if (!isMatchingCodeHash(stored.smsCodeHash, submittedSmsHash)) {
        return res.status(401).json({ error: 'Incorrect phone code' });
      }
    }

    ownerCodeStore.delete(email);
    const session = await getOwnerSessionByEmail(email);
    if (!session.cafes.length) {
      return res.status(404).json({ error: 'No active cafe found for this account' });
    }

    const token = jwt.sign(
      { role: 'owner', email, cafeIds: session.cafes.map((cafe) => cafe.id) },
      secret,
      { expiresIn: `${OWNER_SESSION_TTL_HOURS}h` }
    );

    return res.json({
      ok: true,
      token,
      owner: session
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/owner-auth/me', requireOwnerAuth, async (req, res) => {
  try {
    const session = await getOwnerSessionByEmail(req.owner.email);
    if (!session.cafes.length) {
      return res.status(403).json({ error: 'No active cafes found for this account' });
    }

    return res.json(session);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/owner/cafes', requireOwnerAuth, async (req, res) => {
  try {
    const { cafes } = await getOwnerAccessByEmail(req.owner.email);
    return res.json(cafes);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/owner/profile', requireOwnerAuth, async (req, res) => {
  try {
    const session = await getOwnerSessionByEmail(req.owner.email);
    return res.json({
      email: session.email,
      ownerId: session.ownerId,
      profile: session.profile,
      cafes: session.cafes
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/owner/profile', requireOwnerAuth, async (req, res) => {
  try {
    const existingProfile = await getOwnerProfileByEmail(req.owner.email);
    if (!existingProfile?.id) {
      return res.status(404).json({ error: 'Owner profile not found' });
    }

    const incomingProfile = sanitizeOwnerProfileInput(req.body || {});
    const avatarResult = sanitizeAvatarDataUrl(req.body?.avatar_data_url);
    if (avatarResult.error) {
      return res.status(400).json({ error: avatarResult.error });
    }

    const mergedProfile = mergeOwnerProfile(existingProfile, {
      ...incomingProfile,
      avatar_data_url: avatarResult.value
    });
    const { missingFields, errors } = validateMergedOwnerProfile(mergedProfile);

    if (missingFields.length) {
      return res.status(400).json({
        error: 'Please complete all required profile fields before saving.',
        missingFields
      });
    }
    if (errors.length) {
      return res.status(400).json({ error: errors[0] });
    }

    const result = await pool.query(
      `UPDATE owner_users
       SET full_name = $1,
           first_name = $2,
           last_name = $3,
           phone = $4,
           secondary_phone = $5,
           city = $6,
           province = $7,
           street_address = $8,
           unit_number = $9,
           postal_code = $10,
           avatar_data_url = $11,
           updated_at = NOW()
       WHERE id = $12
       RETURNING
         id,
         email,
         full_name,
         first_name,
         last_name,
         phone,
         secondary_phone,
         city,
         province,
         street_address,
         unit_number,
         postal_code,
         avatar_data_url,
         active`,
      [
        mergedProfile.full_name,
        mergedProfile.first_name,
        mergedProfile.last_name,
        mergedProfile.phone,
        mergedProfile.secondary_phone,
        mergedProfile.city,
        mergedProfile.province,
        mergedProfile.street_address,
        mergedProfile.unit_number,
        mergedProfile.postal_code,
        mergedProfile.avatar_data_url,
        existingProfile.id
      ]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/owner/cafes/:cafeId/team', requireOwnerAuth, requireOwnerCafeAccess, requireOwnerCafeAdminAccess, async (req, res) => {
  try {
    const members = await listCafeTeamMembers(parseInt(req.params.cafeId, 10));
    return res.json(members);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/owner/cafes/:cafeId/team', requireOwnerAuth, requireOwnerCafeAccess, requireOwnerCafeAdminAccess, async (req, res) => {
  const cafeId = parseInt(req.params.cafeId, 10);
  const email = normalizeEmail(req.body?.email);
  const firstName = String(req.body?.first_name || '').trim() || null;
  const lastName = String(req.body?.last_name || '').trim() || null;
  const fullName = String(req.body?.full_name || '').trim() || [firstName, lastName].filter(Boolean).join(' ') || null;
  const phone = req.body?.phone ? normalizeCanadianPhone(req.body.phone) : null;
  const accessRole = normalizeOwnerAccessRole(req.body?.access_role, 'viewer');

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid team member email is required.' });
  }
  if (!['admin', 'editor', 'viewer'].includes(accessRole)) {
    return res.status(400).json({ error: 'Team members can be added as admin, editor, or viewer.' });
  }
  if (req.body?.phone && !phone) {
    return res.status(400).json({ error: 'Phone must be in +1 000-000-0000 format.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actingProfile = await getOwnerProfileByEmail(req.owner.email);
    if (!actingProfile?.id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Current owner profile not found.' });
    }

    const existingUser = await client.query(
      `SELECT id, email, first_name, last_name, full_name, phone, active
       FROM owner_users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    let ownerId;
    if (existingUser.rows.length) {
      ownerId = existingUser.rows[0].id;
      await client.query(
        `UPDATE owner_users
         SET first_name = COALESCE($1, first_name),
             last_name = COALESCE($2, last_name),
             full_name = COALESCE($3, full_name),
             phone = COALESCE($4, phone),
             active = true,
             updated_at = NOW()
         WHERE id = $5`,
        [firstName, lastName, fullName, phone, ownerId]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO owner_users (email, full_name, first_name, last_name, phone, active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id`,
        [email, fullName, firstName, lastName, phone]
      );
      ownerId = inserted.rows[0].id;
    }

    await client.query(
      `INSERT INTO owner_cafe_access (owner_id, cafe_id, access_role, invited_by_owner_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (owner_id, cafe_id) DO UPDATE
         SET access_role = EXCLUDED.access_role,
             invited_by_owner_id = EXCLUDED.invited_by_owner_id,
             updated_at = NOW()`,
      [ownerId, cafeId, accessRole, actingProfile.id]
    );

    await client.query('COMMIT');
    const members = await listCafeTeamMembers(cafeId);
    const member = members.find((entry) => entry.id === ownerId) || null;
    return res.status(201).json({ ok: true, member, members });
  } catch (err) {
    await client.query('ROLLBACK');
    return sendOwnerWriteError(res, err);
  } finally {
    client.release();
  }
});

router.patch('/owner/cafes/:cafeId/team/:memberOwnerId', requireOwnerAuth, requireOwnerCafeAccess, requireOwnerCafeAdminAccess, async (req, res) => {
  const cafeId = parseInt(req.params.cafeId, 10);
  const memberOwnerId = parseInt(req.params.memberOwnerId, 10);
  const requestedRole = normalizeOwnerAccessRole(req.body?.access_role, '');

  if (Number.isNaN(memberOwnerId)) {
    return res.status(400).json({ error: 'Invalid team member id.' });
  }
  if (!requestedRole || !['admin', 'editor', 'viewer'].includes(requestedRole)) {
    return res.status(400).json({ error: 'Valid role is required (admin, editor, or viewer).' });
  }

  try {
    const currentMembers = await listCafeTeamMembers(cafeId);
    const member = currentMembers.find((entry) => entry.id === memberOwnerId);
    if (!member) {
      return res.status(404).json({ error: 'Team member not found for this cafe.' });
    }
    if (member.access_role === 'owner') {
      return res.status(400).json({ error: 'Owner access cannot be changed from the cafe portal.' });
    }

    const result = await pool.query(
      `UPDATE owner_cafe_access
       SET access_role = $1,
           updated_at = NOW()
       WHERE cafe_id = $2 AND owner_id = $3
       RETURNING owner_id`,
      [requestedRole, cafeId, memberOwnerId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Team member not found for this cafe.' });
    }

    const members = await listCafeTeamMembers(cafeId);
    const updatedMember = members.find((entry) => entry.id === memberOwnerId) || null;
    return res.json({ ok: true, member: updatedMember, members });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/owner/cafes/:cafeId/team/:memberOwnerId', requireOwnerAuth, requireOwnerCafeAccess, requireOwnerCafeAdminAccess, async (req, res) => {
  const cafeId = parseInt(req.params.cafeId, 10);
  const memberOwnerId = parseInt(req.params.memberOwnerId, 10);

  if (Number.isNaN(memberOwnerId)) {
    return res.status(400).json({ error: 'Invalid team member id.' });
  }

  try {
    const currentMembers = await listCafeTeamMembers(cafeId);
    const member = currentMembers.find((entry) => entry.id === memberOwnerId);
    if (!member) {
      return res.status(404).json({ error: 'Team member not found for this cafe.' });
    }
    if (member.access_role === 'owner') {
      return res.status(400).json({ error: 'Owner access cannot be removed from the cafe portal.' });
    }

    await pool.query(
      `DELETE FROM owner_cafe_access
       WHERE cafe_id = $1 AND owner_id = $2`,
      [cafeId, memberOwnerId]
    );

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN OWNER MANAGEMENT ────────────────────────────────────────────────────
router.get('/admin/owners', async (req, res) => {
  try {
    const includeInactive = ['1', 'true', 'yes'].includes(
      String(req.query.includeInactive || '').trim().toLowerCase()
    );
    const cafeIdRaw = req.query.cafeId;
    const cafeId = cafeIdRaw ? parseInt(cafeIdRaw, 10) : null;
    if (cafeIdRaw && Number.isNaN(cafeId)) {
      return res.status(400).json({ error: 'Invalid cafeId' });
    }

    const owners = await listOwners({ includeInactive, cafeId });
    return res.json(owners);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/owners', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const fullName = String(req.body?.full_name || '').trim() || null;
  const actorEmail = getAdminActorEmail(req);
  const cafeIds = Array.from(new Set(
    (Array.isArray(req.body?.cafe_ids) ? req.body.cafe_ids : [])
      .map((value) => parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  ));

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid owner email is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let owner = await client.query(
      `SELECT id, email, full_name, active
       FROM owner_users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    let ownerId;
    let created = false;

    if (owner.rows.length) {
      ownerId = owner.rows[0].id;
      const existingName = owner.rows[0].full_name;
      await client.query(
        `UPDATE owner_users
         SET full_name = COALESCE($1, full_name),
             active = true,
             updated_at = NOW()
         WHERE id = $2`,
        [fullName || existingName || null, ownerId]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO owner_users (email, full_name, active)
         VALUES ($1, $2, true)
         RETURNING id`,
        [email, fullName]
      );
      ownerId = inserted.rows[0].id;
      created = true;
    }

    for (const cafeId of cafeIds) {
      await client.query(
        `INSERT INTO owner_cafe_access (owner_id, cafe_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [ownerId, cafeId]
      );
    }

    await client.query('COMMIT');

    const owners = await listOwners({ includeInactive: true });
    const ownerPayload = owners.find((entry) => entry.id === ownerId) || null;
    await writeAdminAuditEvent({
      eventType: created ? 'owner.created' : 'owner.access_updated',
      severity: 'info',
      cafeId: cafeIds[0] || null,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${email}: ${created ? 'owner created' : 'owner access updated'}`,
      details: {
        owner_id: ownerId,
        cafe_ids: cafeIds
      }
    });
    return res.status(created ? 201 : 200).json(ownerPayload || { id: ownerId, email, full_name: fullName, cafes: [] });
  } catch (err) {
    await client.query('ROLLBACK');
    return sendOwnerWriteError(res, err);
  } finally {
    client.release();
  }
});

router.patch('/admin/owners/:ownerId', async (req, res) => {
  const ownerId = parseInt(req.params.ownerId, 10);
  const actorEmail = getAdminActorEmail(req);
  if (Number.isNaN(ownerId)) {
    return res.status(400).json({ error: 'Invalid owner id' });
  }

  try {
    const existing = await getOwnerById(ownerId);
    if (!existing) {
      return res.status(404).json({ error: 'Owner not found' });
    }

    const nextEmailRaw = req.body?.email ?? existing.email;
    const nextEmail = normalizeEmail(nextEmailRaw);
    if (!isValidEmail(nextEmail)) {
      return res.status(400).json({ error: 'Valid owner email is required' });
    }

    const nextNameRaw = req.body?.full_name;
    const nextName = nextNameRaw === undefined ? existing.full_name : (String(nextNameRaw || '').trim() || null);
    const nextActive = req.body?.active === undefined ? existing.active : Boolean(req.body.active);

    await pool.query(
      `UPDATE owner_users
       SET email = $1,
           full_name = $2,
           active = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [nextEmail, nextName, nextActive, ownerId]
    );

    const owners = await listOwners({ includeInactive: true });
    const updated = owners.find((entry) => entry.id === ownerId);
    await writeAdminAuditEvent({
      eventType: 'owner.updated',
      severity: 'info',
      cafeId: updated?.cafes?.[0]?.id || null,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${nextEmail}: owner profile updated`,
      details: {
        owner_id: ownerId,
        active: nextActive
      }
    });
    return res.json(updated || { ...existing, email: nextEmail, full_name: nextName, active: nextActive });
  } catch (err) {
    return sendOwnerWriteError(res, err);
  }
});

router.delete('/admin/owners/:ownerId', async (req, res) => {
  const ownerId = parseInt(req.params.ownerId, 10);
  const actorEmail = getAdminActorEmail(req);
  if (Number.isNaN(ownerId)) {
    return res.status(400).json({ error: 'Invalid owner id' });
  }

  try {
    const result = await pool.query(
      `UPDATE owner_users
       SET active = false,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, full_name, active`,
      [ownerId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Owner not found' });
    }

    await writeAdminAuditEvent({
      eventType: 'owner.deactivated',
      severity: 'medium',
      cafeId: null,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${result.rows[0].email}: owner account deactivated`,
      details: { owner_id: ownerId }
    });
    return res.json({ deleted: true, owner: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/owners/:ownerId/cafes', async (req, res) => {
  const ownerId = parseInt(req.params.ownerId, 10);
  const cafeId = parseInt(req.body?.cafe_id, 10);
  const actorEmail = getAdminActorEmail(req);

  if (Number.isNaN(ownerId) || Number.isNaN(cafeId)) {
    return res.status(400).json({ error: 'ownerId and cafe_id are required' });
  }

  try {
    const owner = await getOwnerById(ownerId);
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    await pool.query(
      `INSERT INTO owner_cafe_access (owner_id, cafe_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [ownerId, cafeId]
    );

    const owners = await listOwners({ includeInactive: true });
    const updated = owners.find((entry) => entry.id === ownerId);
    await writeAdminAuditEvent({
      eventType: 'owner.cafe_assigned',
      severity: 'info',
      cafeId,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${owner.email}: assigned to cafe ${cafeId}`,
      details: { owner_id: ownerId, cafe_id: cafeId }
    });
    return res.json(updated || owner);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/owners/:ownerId/cafes/:cafeId', async (req, res) => {
  const ownerId = parseInt(req.params.ownerId, 10);
  const cafeId = parseInt(req.params.cafeId, 10);
  const actorEmail = getAdminActorEmail(req);

  if (Number.isNaN(ownerId) || Number.isNaN(cafeId)) {
    return res.status(400).json({ error: 'Invalid ownerId or cafeId' });
  }

  try {
    await pool.query(
      'DELETE FROM owner_cafe_access WHERE owner_id = $1 AND cafe_id = $2',
      [ownerId, cafeId]
    );

    const owners = await listOwners({ includeInactive: true });
    const updated = owners.find((entry) => entry.id === ownerId);
    await writeAdminAuditEvent({
      eventType: 'owner.cafe_unassigned',
      severity: 'medium',
      cafeId,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `Owner ${ownerId}: removed from cafe ${cafeId}`,
      details: { owner_id: ownerId, cafe_id: cafeId }
    });
    return res.json(updated || { id: ownerId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/owners/:ownerId/send-invite', async (req, res) => {
  const ownerId = parseInt(req.params.ownerId, 10);
  const secret = getOwnerAuthSecret();
  const actorEmail = getAdminActorEmail(req);

  if (Number.isNaN(ownerId)) {
    return res.status(400).json({ error: 'Invalid owner id' });
  }

  if (!secret) {
    return res.status(503).json({
      error: 'Owner auth is not configured. Set OWNER_AUTH_SECRET (or PREP_RUN_TOKEN).'
    });
  }

  try {
    const owner = await getOwnerById(ownerId);
    if (!owner) return res.status(404).json({ error: 'Owner not found' });
    if (!owner.active) return res.status(400).json({ error: 'Owner account is inactive' });

    const access = await getOwnerAccessByEmail(owner.email);
    if (!access.cafes.length) {
      return res.status(400).json({ error: 'Owner has no cafe access assigned yet' });
    }

    const code = createOwnerCode();
    ownerCodeStore.set(owner.email, {
      emailCodeHash: hashOwnerCode(owner.email, 'email', code, secret),
      smsCodeHash: null,
      expiresAt: Date.now() + OWNER_CODE_TTL_MINUTES * 60 * 1000
    });

    const emailResult = await emailService.sendOwnerLoginCode({
      email: owner.email,
      code,
      cafes: access.cafes,
      expiresMinutes: OWNER_CODE_TTL_MINUTES
    });

    await writeAdminAuditEvent({
      eventType: 'owner.invite_sent',
      severity: 'info',
      cafeId: access.cafes[0]?.id || null,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${owner.email}: owner invite sent`,
      details: {
        owner_id: ownerId,
        cafe_ids: access.cafes.map((cafe) => cafe.id)
      }
    });
    return res.json({
      ok: true,
      ownerId: owner.id,
      to: emailResult?.to || owner.email
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── CAFES ────────────────────────────────────────────────────────────────────
router.get('/cafes', async (req, res) => {
  try {
    const includeInactive = ['1', 'true', 'yes'].includes(
      String(req.query.includeInactive || '').trim().toLowerCase()
    );

    const result = includeInactive
      ? await pool.query('SELECT * FROM cafes ORDER BY name')
      : await pool.query('SELECT * FROM cafes WHERE active = true ORDER BY name');

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cafes/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cafes WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Cafe not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes', async (req, res) => {
  const {
    name,
    owner_name,
    email,
    city,
    holiday_behaviour,
    kitchen_lead_email,
    prep_send_time
  } = req.body;
  const actorEmail = getAdminActorEmail(req);
  try {
    const prepSendTime = prep_send_time || '06:00';
    if (!isValidPrepTime(prepSendTime)) {
      return res.status(400).json({ error: 'prep_send_time must be in HH:MM (24-hour) format' });
    }

    const result = await pool.query(`
      INSERT INTO cafes (name, owner_name, email, city, holiday_behaviour, kitchen_lead_email, prep_send_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [name, owner_name, email, city || 'Toronto', holiday_behaviour || 'Manual', kitchen_lead_email, prepSendTime]);
    await writeAdminAuditEvent({
      eventType: 'cafe.created',
      severity: 'info',
      cafeId: result.rows[0].id,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${result.rows[0].name}: cafe created`,
      details: {
        city: result.rows[0].city,
        prep_send_time: result.rows[0].prep_send_time
      }
    });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    sendCafeWriteError(res, err);
  }
});

router.put('/cafes/:id', async (req, res) => {
  const {
    name,
    owner_name,
    email,
    city,
    holiday_behaviour,
    kitchen_lead_email,
    active,
    prep_send_time
  } = req.body;
  try {
    const prepSendTime = prep_send_time || '06:00';
    if (!isValidPrepTime(prepSendTime)) {
      return res.status(400).json({ error: 'prep_send_time must be in HH:MM (24-hour) format' });
    }

    const result = await pool.query(`
      UPDATE cafes
      SET name=$1,
          owner_name=$2,
          email=$3,
          city=$4,
          holiday_behaviour=$5,
          kitchen_lead_email=$6,
          active=$7,
          prep_send_time=$8
      WHERE id=$9
      RETURNING *
    `, [name, owner_name, email, city, holiday_behaviour, kitchen_lead_email, active, prepSendTime, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    sendCafeWriteError(res, err);
  }
});

router.patch('/cafes/:id', async (req, res) => {
  const actorEmail = getAdminActorEmail(req);
  try {
    const existing = await pool.query('SELECT * FROM cafes WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Cafe not found' });
    }

    const current = existing.rows[0];
    const patch = req.body || {};

    const next = {
      name: patch.name ?? current.name,
      owner_name: patch.owner_name ?? current.owner_name,
      email: patch.email ?? current.email,
      city: patch.city ?? current.city,
      holiday_behaviour: patch.holiday_behaviour ?? current.holiday_behaviour,
      kitchen_lead_email: patch.kitchen_lead_email ?? current.kitchen_lead_email,
      active: patch.active ?? current.active,
      prep_send_time: patch.prep_send_time ?? current.prep_send_time ?? '06:00'
    };

    if (!isValidPrepTime(next.prep_send_time)) {
      return res.status(400).json({ error: 'prep_send_time must be in HH:MM (24-hour) format' });
    }

    const updated = await pool.query(`
      UPDATE cafes
      SET name=$1,
          owner_name=$2,
          email=$3,
          city=$4,
          holiday_behaviour=$5,
          kitchen_lead_email=$6,
          active=$7,
          prep_send_time=$8
      WHERE id=$9
      RETURNING *
    `, [
      next.name,
      next.owner_name,
      next.email,
      next.city,
      next.holiday_behaviour,
      next.kitchen_lead_email,
      next.active,
      next.prep_send_time,
      req.params.id
    ]);

    await writeAdminAuditEvent({
      eventType: 'cafe.updated',
      severity: 'info',
      cafeId: updated.rows[0].id,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${updated.rows[0].name}: cafe settings updated`,
      details: {
        city: updated.rows[0].city,
        holiday_behaviour: updated.rows[0].holiday_behaviour,
        prep_send_time: updated.rows[0].prep_send_time,
        active: updated.rows[0].active
      }
    });
    res.json(updated.rows[0]);
  } catch (err) {
    sendCafeWriteError(res, err);
  }
});

router.delete('/cafes/:id', async (req, res) => {
  const mode = String(req.query.mode || 'soft').trim().toLowerCase();
  const actorEmail = getAdminActorEmail(req);

  try {
    if (mode === 'hard') {
      const expectedToken = String(process.env.ADMIN_DELETE_TOKEN || process.env.PREP_RUN_TOKEN || '').trim();
      if (!expectedToken) {
        return res.status(503).json({
          error: 'ADMIN_DELETE_TOKEN (or PREP_RUN_TOKEN) is not configured on server'
        });
      }

      const bearer = extractBearerToken(req.headers.authorization || '');
      const headerToken = String(req.headers['x-admin-delete-token'] || req.headers['x-prep-run-token'] || '').trim();
      const providedToken = bearer || headerToken;

      if (!providedToken || providedToken !== expectedToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const deleted = await pool.query('DELETE FROM cafes WHERE id = $1 RETURNING *', [req.params.id]);
      if (!deleted.rows.length) {
        return res.status(404).json({ error: 'Cafe not found' });
      }

      await writeAdminAuditEvent({
        eventType: 'cafe.deleted',
        severity: 'high',
        cafeId: deleted.rows[0].id,
        actorEmail,
        actorSource: 'admin_portal',
        summary: `${deleted.rows[0].name}: cafe permanently deleted`,
        details: { mode: 'hard' }
      });
      return res.json({
        deleted: true,
        mode: 'hard',
        cafe: deleted.rows[0]
      });
    }

    const softDeleted = await pool.query(
      'UPDATE cafes SET active = false WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (!softDeleted.rows.length) {
      return res.status(404).json({ error: 'Cafe not found' });
    }

    await writeAdminAuditEvent({
      eventType: 'cafe.deactivated',
      severity: 'medium',
      cafeId: softDeleted.rows[0].id,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${softDeleted.rows[0].name}: cafe deactivated`,
      details: { mode: 'soft' }
    });
    res.json({
      deleted: true,
      mode: 'soft',
      cafe: softDeleted.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/cafes/:id/prep-time', async (req, res) => {
  const { prep_send_time } = req.body || {};
  const actorEmail = getAdminActorEmail(req);

  if (!isValidPrepTime(prep_send_time)) {
    return res.status(400).json({ error: 'prep_send_time must be in HH:MM (24-hour) format' });
  }

  try {
    const result = await pool.query(
      'UPDATE cafes SET prep_send_time = $1 WHERE id = $2 RETURNING *',
      [prep_send_time, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Cafe not found' });
    }

    await writeAdminAuditEvent({
      eventType: 'cafe.prep_time_updated',
      severity: 'info',
      cafeId: result.rows[0].id,
      actorEmail,
      actorSource: 'admin_portal',
      summary: `${result.rows[0].name}: prep dispatch time updated`,
      details: { prep_send_time: result.rows[0].prep_send_time }
    });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ITEMS ────────────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items WHERE cafe_id = $1 ORDER BY category, name', [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/items', async (req, res) => {
  const { name, category, price } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO items (cafe_id, name, category, price) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.cafeId, name, category, price]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/cafes/:cafeId/items/:id', async (req, res) => {
  const { name, category, price, active } = req.body;
  try {
    const result = await pool.query(
      'UPDATE items SET name=$1, category=$2, price=$3, active=$4 WHERE id=$5 AND cafe_id=$6 RETURNING *',
      [name, category, price, active, req.params.id, req.params.cafeId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INGREDIENTS ──────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/ingredients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ingredients WHERE cafe_id = $1 ORDER BY name', [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/ingredients', async (req, res) => {
  const { name, unit, par_level, shelf_life_days, cost_per_unit } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO ingredients (cafe_id, name, unit, par_level, shelf_life_days, cost_per_unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.cafeId, name, unit, par_level || 0, shelf_life_days || 7, cost_per_unit || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── RECIPES ─────────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/recipes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, i.name as item_name, ing.name as ingredient_name, ing.unit
      FROM recipes r
      JOIN items i ON r.item_id = i.id
      JOIN ingredients ing ON r.ingredient_id = ing.id
      WHERE r.cafe_id = $1
      ORDER BY i.name, ing.name
    `, [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/recipes', async (req, res) => {
  const { item_id, ingredient_id, qty_per_portion, station } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO recipes (cafe_id, item_id, ingredient_id, qty_per_portion, station) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.cafeId, item_id, ingredient_id, qty_per_portion, station]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CATALOG SYNC (ITEMS + INGREDIENTS + RECIPES) ────────────────────────────
router.post('/cafes/:cafeId/catalog/sync', async (req, res) => {
  const cafeId = parseInt(req.params.cafeId, 10);
  const {
    items = [],
    ingredients = [],
    recipes = [],
    deactivateMissingItems = true
  } = req.body || {};

  if (Number.isNaN(cafeId)) {
    return res.status(400).json({ error: 'Invalid cafe ID' });
  }

  if (!Array.isArray(items) || !Array.isArray(ingredients) || !Array.isArray(recipes)) {
    return res.status(400).json({ error: 'items, ingredients, and recipes must be arrays' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingItemsResult = await client.query(
      'SELECT id, name FROM items WHERE cafe_id = $1',
      [cafeId]
    );
    const itemByKey = new Map(existingItemsResult.rows.map(row => [toKey(row.name), row]));
    const seenItemKeys = new Set();
    const itemIdByKey = new Map();

    let itemsInserted = 0;
    let itemsUpdated = 0;
    let itemsDeactivated = 0;

    for (const raw of items) {
      const name = String(raw?.name || raw?.item_name || '').trim();
      if (!name) continue;

      const key = toKey(name);
      seenItemKeys.add(key);
      const category = String(raw?.category || 'Beverage').trim() || 'Beverage';
      const price = toNumberOrNull(raw?.price);
      const active = raw?.active === false ? false : true;

      if (itemByKey.has(key)) {
        const existing = itemByKey.get(key);
        const updated = await client.query(`
          UPDATE items
          SET name = $1, category = $2, price = $3, active = $4
          WHERE id = $5 AND cafe_id = $6
          RETURNING id, name
        `, [name, category, price, active, existing.id, cafeId]);
        itemIdByKey.set(key, updated.rows[0].id);
        itemsUpdated += 1;
      } else {
        const inserted = await client.query(`
          INSERT INTO items (cafe_id, name, category, price, active)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name
        `, [cafeId, name, category, price, active]);
        itemIdByKey.set(key, inserted.rows[0].id);
        itemsInserted += 1;
      }
    }

    if (deactivateMissingItems && items.length > 0) {
      for (const row of existingItemsResult.rows) {
        if (!seenItemKeys.has(toKey(row.name))) {
          await client.query(
            'UPDATE items SET active = false WHERE id = $1 AND cafe_id = $2',
            [row.id, cafeId]
          );
          itemsDeactivated += 1;
        }
      }
    }

    const existingIngredientsResult = await client.query(
      'SELECT id, name FROM ingredients WHERE cafe_id = $1',
      [cafeId]
    );
    const ingredientByKey = new Map(existingIngredientsResult.rows.map(row => [toKey(row.name), row]));
    const ingredientIdByKey = new Map();

    let ingredientsInserted = 0;
    let ingredientsUpdated = 0;

    for (const raw of ingredients) {
      const name = String(raw?.name || raw?.ingredient_name || '').trim();
      if (!name) continue;

      const key = toKey(name);
      const unit = String(raw?.unit || '').trim() || null;
      const parLevel = toNumberOrNull(raw?.par_level) ?? 0;
      const shelfLife = parseInt(raw?.shelf_life_days, 10);
      const shelfLifeDays = Number.isNaN(shelfLife) ? 7 : shelfLife;
      const costPerUnit = toNumberOrNull(raw?.cost_per_unit) ?? 0;

      if (ingredientByKey.has(key)) {
        const existing = ingredientByKey.get(key);
        const updated = await client.query(`
          UPDATE ingredients
          SET name = $1, unit = $2, par_level = $3, shelf_life_days = $4, cost_per_unit = $5
          WHERE id = $6 AND cafe_id = $7
          RETURNING id, name
        `, [name, unit, parLevel, shelfLifeDays, costPerUnit, existing.id, cafeId]);
        ingredientIdByKey.set(key, updated.rows[0].id);
        ingredientsUpdated += 1;
      } else {
        const inserted = await client.query(`
          INSERT INTO ingredients (cafe_id, name, unit, par_level, shelf_life_days, cost_per_unit)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, name
        `, [cafeId, name, unit, parLevel, shelfLifeDays, costPerUnit]);
        ingredientIdByKey.set(key, inserted.rows[0].id);
        ingredientsInserted += 1;
      }
    }

    const allItemsForCafe = await client.query(
      'SELECT id, name FROM items WHERE cafe_id = $1',
      [cafeId]
    );
    allItemsForCafe.rows.forEach(row => {
      itemIdByKey.set(toKey(row.name), row.id);
    });

    const allIngredientsForCafe = await client.query(
      'SELECT id, name FROM ingredients WHERE cafe_id = $1',
      [cafeId]
    );
    allIngredientsForCafe.rows.forEach(row => {
      ingredientIdByKey.set(toKey(row.name), row.id);
    });

    await client.query('DELETE FROM recipes WHERE cafe_id = $1', [cafeId]);

    let recipesInserted = 0;
    const skippedRecipes = [];

    for (const raw of recipes) {
      const itemName = String(raw?.item_name || raw?.item || '').trim();
      const ingredientName = String(raw?.ingredient_name || raw?.ingredient || '').trim();
      const qty = toNumberOrNull(raw?.qty_per_portion ?? raw?.qty);
      const station = String(raw?.station || 'General').trim() || 'General';

      const itemId = itemIdByKey.get(toKey(itemName));
      const ingredientId = ingredientIdByKey.get(toKey(ingredientName));

      if (!itemName || !ingredientName || !itemId || !ingredientId || qty === null || qty <= 0) {
        skippedRecipes.push({
          item_name: itemName,
          ingredient_name: ingredientName,
          qty_per_portion: qty,
          reason: 'Missing item/ingredient match or invalid qty_per_portion'
        });
        continue;
      }

      await client.query(`
        INSERT INTO recipes (cafe_id, item_id, ingredient_id, qty_per_portion, station)
        VALUES ($1, $2, $3, $4, $5)
      `, [cafeId, itemId, ingredientId, qty, station]);
      recipesInserted += 1;
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      counts: {
        itemsInserted,
        itemsUpdated,
        itemsDeactivated,
        ingredientsInserted,
        ingredientsUpdated,
        recipesInserted,
        recipesSkipped: skippedRecipes.length
      },
      skippedRecipes: skippedRecipes.slice(0, 50)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/transactions', async (req, res) => {
  const { days = 28 } = req.query;
  try {
    const result = await pool.query(`
      SELECT * FROM transactions
      WHERE cafe_id = $1 AND date >= NOW() - INTERVAL '${parseInt(days)} days'
      ORDER BY date DESC
    `, [req.params.cafeId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/transactions/bulk', async (req, res) => {
  const { transactions } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of transactions) {
      await client.query(`
        INSERT INTO transactions (cafe_id, item_name, date, quantity, revenue, order_type, daypart)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [req.params.cafeId, t.item_name, t.date, t.quantity, t.revenue || 0, t.order_type || 'Dine-in', t.daypart || 'Morning']);
    }
    await client.query('COMMIT');
    res.status(201).json({ imported: transactions.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── FORECAST & PREP LIST ─────────────────────────────────────────────────────
router.get('/cafes/:cafeId/forecast', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId), date, {
      persistLearningSnapshot: false
    });
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cafes/:cafeId/prep-list', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const result = await pool.query(`
      SELECT * FROM prep_lists WHERE cafe_id = $1 AND date = $2 ORDER BY station, ingredient_name
    `, [req.params.cafeId, date]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/cafes/:cafeId/prep-list/:prepId', async (req, res) => {
  const completedProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'completed');
  const actualQtyProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'actual_prepped_quantity');
  const actualNotesProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'actual_notes');

  if (!completedProvided && !actualQtyProvided && !actualNotesProvided) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (completedProvided) {
    const parsedCompleted = parseBooleanValue(req.body.completed);
    if (parsedCompleted === null) {
      return res.status(400).json({ error: 'completed must be true or false' });
    }
    updates.push(`completed = $${idx++}`);
    values.push(parsedCompleted);
  }

  if (actualQtyProvided) {
    const parsedActual = toNumberOrNull(req.body.actual_prepped_quantity);
    const isBlank =
      req.body.actual_prepped_quantity === '' ||
      req.body.actual_prepped_quantity === null ||
      req.body.actual_prepped_quantity === undefined;
    if (!isBlank && parsedActual === null) {
      return res.status(400).json({ error: 'actual_prepped_quantity must be a number or blank' });
    }
    updates.push(`actual_prepped_quantity = $${idx++}`);
    values.push(parsedActual);
  }

  if (actualNotesProvided) {
    const cleanedNotes = String(req.body.actual_notes || '').trim();
    updates.push(`actual_notes = $${idx++}`);
    values.push(cleanedNotes || null);
  }

  updates.push('updated_at = NOW()');
  values.push(req.params.prepId, req.params.cafeId);

  try {
    const result = await pool.query(
      `UPDATE prep_lists
       SET ${updates.join(', ')}
       WHERE id = $${idx++} AND cafe_id = $${idx++}
       RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Prep item not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cafes/:cafeId/prep-summary', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const summary = await buildPrepSummary(parseInt(req.params.cafeId, 10), date);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cafes/:cafeId/prep-analytics', async (req, res) => {
  try {
    const requestedRange = resolveDateRangeOptions(req.query);
    const analytics = await buildPrepAnalytics(parseInt(req.params.cafeId, 10), requestedRange);
    res.json(analytics);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/forecast/generate', async (req, res) => {
  const date = req.body.date || new Date().toISOString().split('T')[0];
  try {
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId), date);
    if (!forecast.closed) {
      await forecastService.savePrepList(req.params.cafeId, date, forecast.prepList);
    }
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DAILY LOGS ───────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/logs', async (req, res) => {
  try {
    const { startDate, endDate } = resolveDateRangeOptions(req.query);
    let result;

    if (startDate || endDate) {
      const range = buildDateRangeClause(startDate, endDate);
      result = await pool.query(
        `SELECT * FROM daily_logs
         WHERE cafe_id = $1${range.clause}
         ORDER BY date DESC`,
        [req.params.cafeId, ...range.values]
      );
    } else {
      const parsedDays = Math.max(1, parseInt(req.query.days || '30', 10) || 30);
      result = await pool.query(
        `SELECT * FROM daily_logs
         WHERE cafe_id = $1
           AND date >= (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')
         ORDER BY date DESC`,
        [req.params.cafeId, parsedDays]
      );
    }

    res.json(result.rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/cafes/:cafeId/logs', async (req, res) => {
  const { date, waste_items, waste_value, items_86d, actual_covers, notes } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO daily_logs (cafe_id, date, waste_items, waste_value, items_86d, actual_covers, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (cafe_id, date) DO UPDATE SET
        waste_items = EXCLUDED.waste_items, waste_value = EXCLUDED.waste_value,
        items_86d = EXCLUDED.items_86d, actual_covers = EXCLUDED.actual_covers, notes = EXCLUDED.notes
      RETURNING *
    `, [req.params.cafeId, date, waste_items || 0, waste_value || 0, items_86d || 0, actual_covers || 0, notes || '']);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── METRICS ──────────────────────────────────────────────────────────────────
router.get('/cafes/:cafeId/metrics', async (req, res) => {
  try {
    const metrics = await buildMetrics(req.params.cafeId, resolveDateRangeOptions(req.query));
    res.json(metrics);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── WEATHER ─────────────────────────────────────────────────────────────────
router.get('/weather', async (req, res) => {
  const city = req.query.city || 'Toronto';
  try {
    const weather = await weatherService.getWeather(city);
    res.json(weather);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SEND PREP LIST MANUALLY ──────────────────────────────────────────────────
router.post('/cafes/:cafeId/send-prep-list', async (req, res) => {
  const date = req.body.date || new Date().toISOString().split('T')[0];
  try {
    const cafeResult = await pool.query('SELECT * FROM cafes WHERE id = $1', [req.params.cafeId]);
    if (!cafeResult.rows.length) return res.status(404).json({ error: 'Cafe not found' });
    const cafe = cafeResult.rows[0];
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId), date);
    const emailResult = await emailService.sendPrepList(cafe, forecast);
    res.json({
      sent: true,
      to: emailResult?.to || cafe.kitchen_lead_email || cafe.email,
      from: emailResult?.from || null,
      messageId: emailResult?.messageId || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OWNER PORTAL DATA ROUTES (TOKEN PROTECTED) ───────────────────────────────
router.get('/owner/cafes/:cafeId/forecast', requireOwnerAuth, requireOwnerCafeAccess, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId, 10), date, {
      persistLearningSnapshot: false
    });
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/owner/cafes/:cafeId/prep-list', requireOwnerAuth, requireOwnerCafeAccess, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const result = await pool.query(`
      SELECT * FROM prep_lists WHERE cafe_id = $1 AND date = $2 ORDER BY station, ingredient_name
    `, [req.params.cafeId, date]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/owner/cafes/:cafeId/prep-list/:prepId', requireOwnerAuth, requireOwnerCafeAccess, requireOwnerCafeEditAccess, async (req, res) => {
  const completedProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'completed');
  const actualQtyProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'actual_prepped_quantity');
  const actualNotesProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'actual_notes');

  if (!completedProvided && !actualQtyProvided && !actualNotesProvided) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (completedProvided) {
    const parsedCompleted = parseBooleanValue(req.body.completed);
    if (parsedCompleted === null) {
      return res.status(400).json({ error: 'completed must be true or false' });
    }
    updates.push(`completed = $${idx++}`);
    values.push(parsedCompleted);
  }

  if (actualQtyProvided) {
    const parsedActual = toNumberOrNull(req.body.actual_prepped_quantity);
    const isBlank =
      req.body.actual_prepped_quantity === '' ||
      req.body.actual_prepped_quantity === null ||
      req.body.actual_prepped_quantity === undefined;
    if (!isBlank && parsedActual === null) {
      return res.status(400).json({ error: 'actual_prepped_quantity must be a number or blank' });
    }
    updates.push(`actual_prepped_quantity = $${idx++}`);
    values.push(parsedActual);
  }

  if (actualNotesProvided) {
    const cleanedNotes = String(req.body.actual_notes || '').trim();
    updates.push(`actual_notes = $${idx++}`);
    values.push(cleanedNotes || null);
  }

  updates.push('updated_at = NOW()');
  values.push(req.params.prepId, req.params.cafeId);

  try {
    const result = await pool.query(
      `UPDATE prep_lists
       SET ${updates.join(', ')}
       WHERE id = $${idx++} AND cafe_id = $${idx++}
       RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Prep item not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/owner/cafes/:cafeId/prep-summary', requireOwnerAuth, requireOwnerCafeAccess, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const summary = await buildPrepSummary(parseInt(req.params.cafeId, 10), date);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/owner/cafes/:cafeId/prep-analytics', requireOwnerAuth, requireOwnerCafeAccess, async (req, res) => {
  try {
    const requestedRange = resolveDateRangeOptions(req.query);
    const analytics = await buildPrepAnalytics(parseInt(req.params.cafeId, 10), requestedRange);
    res.json(analytics);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/owner/cafes/:cafeId/forecast/generate', requireOwnerAuth, requireOwnerCafeAccess, requireOwnerCafeEditAccess, async (req, res) => {
  const date = req.body.date || new Date().toISOString().split('T')[0];
  try {
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId, 10), date);
    if (!forecast.closed) {
      await forecastService.savePrepList(req.params.cafeId, date, forecast.prepList);
    }
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/owner/cafes/:cafeId/logs', requireOwnerAuth, requireOwnerCafeAccess, async (req, res) => {
  try {
    const { startDate, endDate } = resolveDateRangeOptions(req.query);
    let result;

    if (startDate || endDate) {
      const range = buildDateRangeClause(startDate, endDate);
      result = await pool.query(
        `SELECT * FROM daily_logs
         WHERE cafe_id = $1${range.clause}
         ORDER BY date DESC`,
        [req.params.cafeId, ...range.values]
      );
    } else {
      const parsedDays = Math.max(1, parseInt(req.query.days || '30', 10) || 30);
      result = await pool.query(
        `SELECT * FROM daily_logs
         WHERE cafe_id = $1
           AND date >= (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')
         ORDER BY date DESC`,
        [req.params.cafeId, parsedDays]
      );
    }

    res.json(result.rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/owner/cafes/:cafeId/logs', requireOwnerAuth, requireOwnerCafeAccess, requireOwnerCafeEditAccess, async (req, res) => {
  const { date, waste_items, waste_value, items_86d, actual_covers, notes } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO daily_logs (cafe_id, date, waste_items, waste_value, items_86d, actual_covers, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (cafe_id, date) DO UPDATE SET
        waste_items = EXCLUDED.waste_items, waste_value = EXCLUDED.waste_value,
        items_86d = EXCLUDED.items_86d, actual_covers = EXCLUDED.actual_covers, notes = EXCLUDED.notes
      RETURNING *
    `, [req.params.cafeId, date, waste_items || 0, waste_value || 0, items_86d || 0, actual_covers || 0, notes || '']);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/owner/cafes/:cafeId/metrics', requireOwnerAuth, requireOwnerCafeAccess, async (req, res) => {
  try {
    const metrics = await buildMetrics(req.params.cafeId, resolveDateRangeOptions(req.query));
    res.json(metrics);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/owner/cafes/:cafeId/send-prep-list', requireOwnerAuth, requireOwnerCafeAccess, requireOwnerCafeEditAccess, async (req, res) => {
  const date = req.body.date || new Date().toISOString().split('T')[0];
  try {
    const cafeResult = await pool.query('SELECT * FROM cafes WHERE id = $1 AND active = true', [req.params.cafeId]);
    if (!cafeResult.rows.length) return res.status(404).json({ error: 'Cafe not found' });
    const cafe = cafeResult.rows[0];
    const forecast = await forecastService.generateForecast(parseInt(req.params.cafeId, 10), date);
    const emailResult = await emailService.sendPrepList(cafe, forecast);
    res.json({
      sent: true,
      to: emailResult?.to || cafe.kitchen_lead_email || cafe.email,
      from: emailResult?.from || null,
      messageId: emailResult?.messageId || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MANUAL PREP DISPATCH (PROTECTED) ───────────────────────────────────────
router.post('/admin/run-prep-now', async (req, res) => {
  const expectedToken = String(process.env.PREP_RUN_TOKEN || '').trim();

  if (!expectedToken) {
    return res.status(503).json({
      error: 'PREP_RUN_TOKEN is not configured on server'
    });
  }

  const bearer = extractBearerToken(req.headers.authorization || '');
  const headerToken = String(req.headers['x-prep-run-token'] || '').trim();
  const providedToken = bearer || headerToken;

  if (!providedToken || providedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { cafeIds = [], date = null, force = true } = req.body || {};

  if (date && Number.isNaN(Date.parse(date))) {
    return res.status(400).json({ error: 'date must be ISO-like (YYYY-MM-DD)' });
  }

  try {
    const result = await schedulerService.runPrepNow({
      cafeIds,
      dispatchDate: date,
      force: Boolean(force),
      source: 'manual_api'
    });
    await writeAdminAuditEvent({
      eventType: 'support.run_prep_now',
      severity: 'medium',
      cafeId: null,
      actorEmail: null,
      actorSource: 'manual_api',
      summary: `Manual fleet prep dispatch triggered for ${result.cafesProcessed || 0} cafe(s)`,
      details: {
        cafeIds,
        dispatchDate: date,
        force: Boolean(force)
      }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
