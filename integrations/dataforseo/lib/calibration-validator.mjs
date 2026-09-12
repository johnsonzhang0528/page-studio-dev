const required = ['query','location_code','language_code','volume','kd','intent','observed_at'];

export function validateCalibrationDataset(rows, {required_count = 60,minimum_volume_coverage=0.8,minimum_kd_coverage=0.8} = {}) {
  const errors = [];
  if (!Array.isArray(rows)) return {ok: false, errors: ['DATASET_NOT_ARRAY']};
  if (rows.length !== required_count) errors.push(`ROW_COUNT_EXPECTED:${required_count}`);
  const queries = new Set();
  rows.forEach((row, index) => {
    for (const field of required) if (!(field in (row ?? {}))) errors.push(`ROW_${index}_MISSING:${field}`);
    const normalized = typeof row?.query === 'string' ? row.query.trim().normalize('NFKC').toLocaleLowerCase() : '';
    if (!normalized) errors.push(`ROW_${index}_QUERY_INVALID`);
    else if (queries.has(normalized)) errors.push(`ROW_${index}_QUERY_DUPLICATE`);
    else queries.add(normalized);
    if (row?.location_code !== 2158 || row?.language_code !== 'zh-TW') errors.push(`ROW_${index}_MARKET_INVALID`);
    if (row?.volume !== null && (!Number.isSafeInteger(row.volume) || row.volume < 0)) errors.push(`ROW_${index}_VOLUME_INVALID`);
    if (row?.kd !== null && (typeof row.kd !== 'number' || row.kd < 0 || row.kd > 100)) errors.push(`ROW_${index}_KD_INVALID`);
    if (!['informational','commercial','transactional','navigational','unknown'].includes(row?.intent)) errors.push(`ROW_${index}_INTENT_INVALID`);
    if (!Number.isFinite(Date.parse(row?.observed_at ?? ''))) errors.push(`ROW_${index}_DATE_INVALID`);
  });
  const nullVolumeRatio = rows.length ? rows.filter(row => row?.volume === null).length / rows.length : 1;
  const nullKdRatio = rows.length ? rows.filter(row => row?.kd === null).length / rows.length : 1;
  if (1-nullVolumeRatio < minimum_volume_coverage) errors.push('VOLUME_COVERAGE_BELOW_80_PERCENT');
  if (1-nullKdRatio < minimum_kd_coverage) errors.push('KD_COVERAGE_BELOW_80_PERCENT');
  return {ok: errors.length === 0, errors, metrics: {rows: rows.length, unique_queries: queries.size, volume_coverage: 1 - nullVolumeRatio, kd_coverage: 1 - nullKdRatio}};
}
