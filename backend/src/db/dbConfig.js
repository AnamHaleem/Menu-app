require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const pgSsl = isProduction ? { rejectUnauthorized: false } : false;

function resolveFromUrl() {
  const candidates = [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['Database', process.env.Database],
    ['DATABASE', process.env.DATABASE],
    ['POSTGRES_URL', process.env.POSTGRES_URL],
    ['POSTGRESQL_URL', process.env.POSTGRESQL_URL],
    ['DATABASE_PRIVATE_URL', process.env.DATABASE_PRIVATE_URL]
  ];

  for (const [source, value] of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return {
        source,
        config: {
          connectionString: value.trim(),
          ssl: pgSsl
        }
      };
    }
  }

  return null;
}

function resolveFromPgParts() {
  const required = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
  const hasAll = required.every((key) => Boolean(process.env[key]));

  if (!hasAll) return null;

  return {
    source: 'PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE',
    config: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: pgSsl
    }
  };
}

function getPresentDbEnvKeys() {
  const keys = [
    'DATABASE_URL',
    'Database',
    'DATABASE',
    'POSTGRES_URL',
    'POSTGRESQL_URL',
    'DATABASE_PRIVATE_URL',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE'
  ];

  return keys.filter((key) => Boolean(process.env[key]));
}

function getPgConfigDetails() {
  const fromUrl = resolveFromUrl();
  if (fromUrl) return fromUrl;

  const fromParts = resolveFromPgParts();
  if (fromParts) return fromParts;

  const err = new Error(
    'No database configuration found. Set DATABASE_URL (recommended) or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.'
  );
  err.meta = { presentDbEnvKeys: getPresentDbEnvKeys() };
  throw err;
}

function getPgConfig() {
  return getPgConfigDetails().config;
}

module.exports = {
  getPgConfig,
  getPgConfigDetails,
  getPresentDbEnvKeys
};
