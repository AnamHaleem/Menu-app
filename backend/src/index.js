require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { clerkMiddleware } = require('@clerk/express');
const apiRoutes = require('./routes/api');
const { startScheduler } = require('./services/schedulerService');

const app = express();
const PORT = process.env.PORT || 3001;

const normalizeOrigin = (value = '') => value.trim().replace(/\/+$/, '');

const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const devOrigins = ['http://localhost:3000', 'http://localhost:5173'];
const allowVercelPreviews = process.env.ALLOW_VERCEL_PREVIEWS === 'true';

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (configuredOrigins.length ? configuredOrigins : ['https://your-menu-app.railway.app'])
  : Array.from(new Set([...devOrigins, ...configuredOrigins]));

console.log('CORS allowed origins:', allowedOrigins.join(', '));
console.log('CORS allow Vercel previews:', allowVercelPreviews ? 'true' : 'false');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const normalizedOrigin = normalizeOrigin(origin);
    const isConfigured = allowedOrigins.includes(normalizedOrigin);
    const isVercelPreview = allowVercelPreviews && /^https:\/\/.*\.vercel\.app$/.test(normalizedOrigin);

    if (isConfigured || isVercelPreview) {
      return callback(null, true);
    }

    console.error(`CORS blocked origin: ${normalizedOrigin}`);
    return callback(new Error(`Not allowed by CORS: ${normalizedOrigin}`));
  },
  credentials: true
}));

app.use(express.json());

if (process.env.CLERK_SECRET_KEY) {
  app.use(clerkMiddleware());
} else {
  console.warn('CLERK_SECRET_KEY not set. Clerk middleware is disabled.');
}

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack || err.message || err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Menu API running on port ${PORT}`);

  const autoSeedDemoData = String(process.env.AUTO_SEED_DEMO_DATA || '').trim().toLowerCase() === 'true';
  const startupCommand = autoSeedDemoData ? 'npm run db:migrate && npm run db:seed' : 'npm run db:migrate';

  console.log(`Auto demo seed on boot: ${autoSeedDemoData ? 'enabled' : 'disabled'}`);

  exec(startupCommand, { cwd: __dirname + '/..' }, (err, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    if (err) {
      console.error('Migration/seed command failed:', err.message || err);
      return;
    }

    if (autoSeedDemoData) {
      console.log('Migrations + seed complete');
    } else {
      console.log('Migrations complete');
    }
  });

  startScheduler();
});

module.exports = app;
