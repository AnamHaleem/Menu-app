const mlFeatureService = require('../services/mlFeatureService');

function readArg(name) {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

async function main() {
  const cafeId = readArg('cafeId');
  const startDate = readArg('startDate');
  const endDate = readArg('endDate');
  const requestedBy = readArg('requestedBy') || 'cli';

  const result = await mlFeatureService.buildFeatureStore({
    cafeId: cafeId ? Number(cafeId) : null,
    startDate,
    endDate,
    requestedBy,
    source: 'cli'
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
