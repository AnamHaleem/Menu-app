const { Pool } = require('pg');
const { getPgConfigDetails } = require('./dbConfig');

const { config, source } = getPgConfigDetails();
console.log(`Database config source: ${source}`);

const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
