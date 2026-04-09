const mlTrainingService = require('../services/mlTrainingService');

function readArg(name) {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

async function main() {
  const cafeId = readArg('cafeId');
  const startDate = readArg('startDate');
  const endDate = readArg('endDate');
  const evaluationStartDate = readArg('evaluationStartDate');
  const evaluationEndDate = readArg('evaluationEndDate');
  const holdoutDays = readArg('holdoutDays');
  const modelKey = readArg('modelKey');
  const displayName = readArg('displayName');
  const requestedBy = readArg('requestedBy') || 'cli';

  const result = await mlTrainingService.trainAndImportShadowModel({
    cafeId: cafeId ? Number(cafeId) : null,
    startDate,
    endDate,
    evaluationStartDate,
    evaluationEndDate,
    holdoutDays: holdoutDays ? Number(holdoutDays) : null,
    modelKey,
    displayName,
    requestedBy,
    source: 'cli_train'
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
