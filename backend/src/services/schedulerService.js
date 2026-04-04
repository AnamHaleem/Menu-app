const cron = require('node-cron');
const pool = require('../db/pool');
const forecastService = require('./forecastService');
const emailService = require('./emailService');

function startScheduler() {
  // 6:00 AM — send prep list to all active cafes
  cron.schedule('0 6 * * *', async () => {
    console.log('Running 6am prep list job...');
    const client = await pool.connect();
    try {
      const cafes = await client.query('SELECT * FROM cafes WHERE active = true');
      const today = new Date().toISOString().split('T')[0];
      for (const cafe of cafes.rows) {
        try {
          const forecast = await forecastService.generateForecast(cafe.id, today);
          if (!forecast.closed) {
            await forecastService.savePrepList(cafe.id, today, forecast.prepList || []);
            await emailService.sendPrepList(cafe, forecast);
          } else {
            console.log(`Skipped ${cafe.name}: closed (${forecast.holiday})`);
          }

          if (forecast.aiDecision?.applied) {
            console.log(
              `AI decision applied for ${cafe.name} using ${forecast.aiDecision.model || 'model'} (x${forecast.aiDecision.globalMultiplier || 1})`
            );
          } else {
            console.log(`AI decision not applied for ${cafe.name}: ${forecast.aiDecision?.notes || 'fallback model used'}`);
          }
        } catch (err) {
          console.error(`Failed to process cafe ${cafe.name}:`, err.message);
        }
      }
    } finally {
      client.release();
    }
  }, { timezone: 'America/Toronto' });

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

  console.log('Scheduler started — prep list at 6am, check-in at 9pm Toronto time');
}

module.exports = { startScheduler };
