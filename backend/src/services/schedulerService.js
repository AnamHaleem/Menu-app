const cron = require('node-cron');
const pool = require('../db/pool');
const forecastService = require('./forecastService');
const emailService = require('./emailService');
const mlTrainingService = require('./mlTrainingService');

const PREP_TIMEZONE = process.env.PREP_TIMEZONE || 'America/Toronto';
const ML_AUTOMATION_ENABLED = ['1', 'true', 'yes'].includes(String(process.env.ML_AUTOMATION_ENABLED || 'false').trim().toLowerCase());
const ML_AUTOMATION_CRON = process.env.ML_AUTOMATION_CRON || '15 2 * * *';
let prepDispatcherRunning = false;
let mlRefreshRunning = false;

function getTimezoneParts(date = new Date(), timezone = PREP_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const partMap = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      partMap[part.type] = part.value;
    }
  }

  return {
    date: `${partMap.year}-${partMap.month}-${partMap.day}`,
    time: `${partMap.hour}:${partMap.minute}`
  };
}

async function claimDispatchLock({ cafeId, dispatchDate, scheduledTime, source, force }) {
  if (force) {
    const upsert = await pool.query(`
      INSERT INTO prep_dispatch_logs (cafe_id, dispatch_date, scheduled_time, source, status, details)
      VALUES ($1, $2, $3, $4, 'running', 'Forced manual run')
      ON CONFLICT (cafe_id, dispatch_date) DO UPDATE SET
        scheduled_time = EXCLUDED.scheduled_time,
        source = EXCLUDED.source,
        status = 'running',
        details = 'Forced manual run',
        updated_at = NOW()
      RETURNING id
    `, [cafeId, dispatchDate, scheduledTime, source]);
    return upsert.rows[0]?.id || null;
  }

  const lock = await pool.query(`
    INSERT INTO prep_dispatch_logs (cafe_id, dispatch_date, scheduled_time, source, status, details)
    VALUES ($1, $2, $3, $4, 'running', 'Scheduled run claimed')
    ON CONFLICT (cafe_id, dispatch_date) DO NOTHING
    RETURNING id
  `, [cafeId, dispatchDate, scheduledTime, source]);

  return lock.rows[0]?.id || null;
}

async function finalizeDispatch({ logId, status, details, sentAt = false }) {
  if (!logId) return;

  await pool.query(`
    UPDATE prep_dispatch_logs
    SET status = $2,
        details = $3,
        sent_at = CASE WHEN $4 THEN NOW() ELSE sent_at END,
        updated_at = NOW()
    WHERE id = $1
  `, [logId, status, details, sentAt]);
}

async function runPrepForCafe(cafe, {
  dispatchDate,
  scheduledTime,
  source = 'scheduler',
  force = false
}) {
  const logId = await claimDispatchLock({
    cafeId: cafe.id,
    dispatchDate,
    scheduledTime,
    source,
    force
  });

  if (!logId) {
    return {
      cafeId: cafe.id,
      cafeName: cafe.name,
      status: 'skipped',
      reason: 'Already sent for this cafe/date'
    };
  }

  try {
    const forecast = await forecastService.generateForecast(cafe.id, dispatchDate);

    if (forecast.closed) {
      const reason = `Cafe closed (${forecast.holiday})`;
      await finalizeDispatch({ logId, status: 'skipped_closed', details: reason });
      return {
        cafeId: cafe.id,
        cafeName: cafe.name,
        status: 'skipped_closed',
        reason
      };
    }

    await forecastService.savePrepList(cafe.id, dispatchDate, forecast.prepList || []);
    await emailService.sendPrepList(cafe, forecast);

    const details = forecast.aiDecision?.applied
      ? `Prep sent with AI decision (${forecast.aiDecision.model || 'model'})`
      : `Prep sent with rules-based forecast (${forecast.aiDecision?.notes || 'AI unavailable'})`;

    await finalizeDispatch({ logId, status: 'sent', details, sentAt: true });

    return {
      cafeId: cafe.id,
      cafeName: cafe.name,
      status: 'sent',
      aiApplied: Boolean(forecast.aiDecision?.applied),
      aiModel: forecast.aiDecision?.model || null
    };
  } catch (err) {
    const message = err.message || 'Unknown dispatch error';
    await finalizeDispatch({ logId, status: 'failed', details: message });
    return {
      cafeId: cafe.id,
      cafeName: cafe.name,
      status: 'failed',
      error: message
    };
  }
}

async function runDuePrepDispatchTick(source = 'scheduler_tick') {
  if (prepDispatcherRunning) {
    return { skipped: true, reason: 'Dispatcher already running' };
  }

  prepDispatcherRunning = true;

  try {
    const { date: dispatchDate, time: scheduledTime } = getTimezoneParts(new Date(), PREP_TIMEZONE);
    const cafes = await pool.query(`
      SELECT *
      FROM cafes
      WHERE active = true
        AND COALESCE(prep_send_time, '06:00') = $1
      ORDER BY id
    `, [scheduledTime]);

    const results = [];
    for (const cafe of cafes.rows) {
      const result = await runPrepForCafe(cafe, {
        dispatchDate,
        scheduledTime,
        source,
        force: false
      });
      results.push(result);
    }

    return {
      ok: true,
      source,
      dispatchDate,
      scheduledTime,
      cafesMatched: cafes.rows.length,
      results
    };
  } finally {
    prepDispatcherRunning = false;
  }
}

async function runPrepNow({
  cafeIds = [],
  dispatchDate = null,
  force = true,
  source = 'manual_api'
} = {}) {
  const now = getTimezoneParts(new Date(), PREP_TIMEZONE);
  const targetDate = dispatchDate || now.date;
  const runTime = now.time;

  const ids = Array.isArray(cafeIds)
    ? cafeIds.map((v) => parseInt(v, 10)).filter((v) => !Number.isNaN(v))
    : [];

  let cafes;
  if (ids.length > 0) {
    cafes = await pool.query(`
      SELECT *
      FROM cafes
      WHERE active = true
        AND id = ANY($1::int[])
      ORDER BY id
    `, [ids]);
  } else {
    cafes = await pool.query(`
      SELECT *
      FROM cafes
      WHERE active = true
      ORDER BY id
    `);
  }

  const results = [];
  for (const cafe of cafes.rows) {
    const result = await runPrepForCafe(cafe, {
      dispatchDate: targetDate,
      scheduledTime: runTime,
      source,
      force
    });
    results.push(result);
  }

  return {
    ok: true,
    source,
    dispatchDate: targetDate,
    scheduledTime: runTime,
    force,
    cafesProcessed: cafes.rows.length,
    results
  };
}

async function runAutomatedMlRefresh(source = 'scheduler_ml_refresh') {
  if (mlRefreshRunning) {
    return { skipped: true, reason: 'ML refresh already running' };
  }

  mlRefreshRunning = true;

  try {
    const result = await mlTrainingService.refreshFleetLiveModels({
      requestedBy: 'scheduler',
      source,
      status: 'active'
    });

    return {
      ok: true,
      source,
      ...result
    };
  } finally {
    mlRefreshRunning = false;
  }
}

function startScheduler() {
  // Every minute — send prep list to cafes whose prep_send_time matches current Toronto time
  cron.schedule('* * * * *', async () => {
    try {
      const tickResult = await runDuePrepDispatchTick('scheduler_tick');

      if (tickResult?.skipped) {
        return;
      }

      if (tickResult?.cafesMatched > 0) {
        console.log(
          `Prep dispatcher tick ${tickResult.scheduledTime} processed ${tickResult.cafesMatched} cafe(s)`
        );
      }
    } catch (err) {
      console.error('Prep dispatcher tick failed:', err.message);
    }
  }, { timezone: PREP_TIMEZONE });

  // 9:00 PM — send daily check-in reminder
  cron.schedule('0 21 * * *', async () => {
    console.log('Running 9pm check-in reminder job...');
    const client = await pool.connect();
    try {
      const cafes = await client.query('SELECT * FROM cafes WHERE active = true');
      for (const cafe of cafes.rows) {
        try {
          await emailService.sendDailyCheckIn(cafe);
        } catch (err) {
          console.error(`Failed to send check-in for cafe ${cafe.name}:`, err.message);
        }
      }
    } finally {
      client.release();
    }
  }, { timezone: 'America/Toronto' });

  if (ML_AUTOMATION_ENABLED) {
    cron.schedule(ML_AUTOMATION_CRON, async () => {
      try {
        const result = await runAutomatedMlRefresh('scheduler_ml_refresh');
        if (result?.skipped) {
          return;
        }

        console.log(
          `ML auto-refresh completed: ${result.cafesTrained}/${result.cafesAttempted} trained, ${result.cafesSkipped} skipped, ${result.cafesFailed} failed`
        );
      } catch (err) {
        console.error('Automated ML refresh failed:', err.message);
      }
    }, { timezone: PREP_TIMEZONE });
  }

  console.log(
    `Scheduler started — prep dispatcher every minute (${PREP_TIMEZONE}), check-in at 9pm Toronto time${ML_AUTOMATION_ENABLED ? `, ML auto-refresh on "${ML_AUTOMATION_CRON}"` : ', ML auto-refresh disabled'}`
  );
}

module.exports = { startScheduler, runPrepNow, runDuePrepDispatchTick, runAutomatedMlRefresh };
