require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { clerkMiddleware } = require('@clerk/express');
const apiRoutes = require('./routes/api');
const { startScheduler } = require('./services/schedulerService');

const app = express();
const PORT = process.env.PORT || 3001;

const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

const devOrigins = ['http://localhost:3000', 'http://localhost:5173'];
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (configuredOrigins.length ? configuredOrigins : ['https://your-menu-app.railway.app'])
  : Array.from(new Set([...devOrigins, ...configuredOrigins]));

console.log('CORS allowed origins:', allowedOrigins.join(', '));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(new Error(`Not allowed by CORS: ${origin}`));
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

  exec('npm run db:migrate && npm run db:seed', { cwd: __dirname + '/..' }, (err, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    if (err) {
      console.error('Migration/seed command failed:', err.message || err);
      return;
    }

    console.log('Migrations + seed complete');
  });

  startScheduler();
});

module.exports = app;
