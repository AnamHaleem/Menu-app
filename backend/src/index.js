require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { clerkMiddleware } = require('@clerk/express');
const apiRoutes = require('./routes/api');
const { startScheduler } = require('./services/schedulerService');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://your-menu-app.railway.app']
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

app.use(express.json());
app.use(clerkMiddleware());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

const { exec } = require('child_process');

app.listen(PORT, async () => {
  console.log(`Menu API running on port ${PORT}`);

  // Run migrations automatically
  exec('npm run db:migrate && npm run db:seed', (err, stdout, stderr) => {
    if (err) {
      console.error('Migration error:', err);
      return;
    }
    console.log('Migrations + seed complete');
  });

  startScheduler();
});