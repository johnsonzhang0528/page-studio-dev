import {validateDataForSeoEnvelope} from './dataforseo-errors.mjs';

const nullableNumber = value => value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;

function keywordItems(envelope) {
  return envelope.tasks.flatMap(task => (task.result ?? []).flatMap(result => result.items ?? []));
}

function taskCost(envelope) {
  const values = envelope.tasks.map(task => nullableNumber(task?.cost)).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function normalizeKeywordOverview(envelope, context) {
  const validation = validateDataForSeoEnvelope(envelope);
  if (!validation.ok) {
    const error = new Error(`DATAFORSEO_RESPONSE_REJECTED:${validation.errors.join(',')}`);
    error.code = 'DATAFORSEO_RESPONSE_REJECTED';
    throw error;
  }
  if (!context?.request_fingerprint || !context?.retrieved_at || !context?.location_code || !context?.language_code) {
    const error = new Error('EVIDENCE_CONTEXT_REQUIRED');
    error.code = 'EVIDENCE_CONTEXT_REQUIRED';
    throw error;
  }
  return keywordItems(envelope).map(item => {
    const info = item.keyword_info ?? {};
    const props = item.keyword_properties ?? {};
    const intent = item.search_intent_info ?? {};
    const volume = nullableNumber(info.search_volume);
    const difficulty = nullableNumber(props.keyword_difficulty ?? item.keyword_difficulty);
    return {
      schema_version: 1,
      module: 'keyword',
      metric_subject: String(item.keyword ?? ''),
      provider: 'dataforseo',
      endpoint: 'dataforseo_labs/google/keyword_overview/live',
      location_code: context.location_code,
      language_code: context.language_code,
      retrieved_at: context.retrieved_at,
      source_updated_at: info.last_updated_time ?? props.last_updated_time ?? null,
      request_fingerprint: context.request_fingerprint,
      provider_cost: taskCost(envelope),
      search_volume_estimate: volume,
      search_volume_null_reason: volume === null ? 'PROVIDER_NULL_OR_INVALID' : null,
      organic_kd: difficulty,
      organic_kd_null_reason: difficulty === null ? 'PROVIDER_NULL_OR_INVALID' : null,
      paid_competition: nullableNumber(info.competition),
      cpc_usd: nullableNumber(info.cpc),
      intent_provider: intent.main_intent ?? null,
      core_keyword: props.core_keyword ?? null,
      monthly_searches: Array.isArray(info.monthly_searches) ? info.monthly_searches : [],
      confidence: volume === null || difficulty === null ? 'low' : 'unvalidated'
    };
  });
}
