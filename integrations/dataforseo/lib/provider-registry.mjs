const requiredCapabilities = ['keyword_overview','keyword_ideas','serp_standard'];

export function validateProviderRegistry(registry, options = {}) {
  const now = options.now ?? Date.now();
  const errors = [];
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return {ok:false, errors:['REGISTRY_INVALID']};
  if (!Number.isSafeInteger(registry.version) || registry.version < 1) errors.push('VERSION_REQUIRED');
  if (registry.provider !== 'dataforseo') errors.push('PROVIDER_INVALID');
  if (!Array.isArray(registry.capabilities)) errors.push('CAPABILITIES_REQUIRED');
  else for (const capability of requiredCapabilities) if (!registry.capabilities.includes(capability)) errors.push(`CAPABILITY_MISSING:${capability}`);
  if (!Array.isArray(registry.markets) || !registry.markets.some(item => item.location_code === 2158 && item.language_code === 'zh-TW')) errors.push('TAIWAN_ZHTW_UNVERIFIED');
  const priceExpiry = Date.parse(registry.price_snapshot?.expires_at ?? '');
  const priceCaptured = Date.parse(registry.price_snapshot?.captured_at ?? '');
  if (!Number.isFinite(priceExpiry) || priceExpiry <= now) errors.push('PRICE_SNAPSHOT_STALE');
  if (!Number.isFinite(priceCaptured) || priceCaptured > now || priceExpiry - priceCaptured > 7 * 86400000) errors.push('PRICE_SNAPSHOT_WINDOW_INVALID');
  if (registry.price_snapshot?.source !== 'https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api') errors.push('PRICE_SOURCE_UNTRUSTED');
  for (const field of ['keyword_overview_task_microusd','keyword_overview_item_microusd']) if (!Number.isSafeInteger(registry.price_snapshot?.[field]) || registry.price_snapshot[field] < 0) errors.push(`PRICE_MISSING:${field}`);
  const expectedActivation = options.expected_activation ?? 'disabled';
  if (!['disabled','canary'].includes(expectedActivation) || registry.activation !== expectedActivation) errors.push('ACTIVATION_NOT_AUTHORIZED');
  if (registry.fallback?.automatic !== false) errors.push('AUTOMATIC_FALLBACK_FORBIDDEN');
  return {ok:errors.length === 0, errors};
}

export function estimateKeywordIdeasMicrousd(registry,limit){if(limit!==60)throw new Error('IDEAS_LIMIT_INVALID');return (registry.price_snapshot.keyword_ideas_task_microusd??registry.price_snapshot.keyword_overview_task_microusd)+limit*(registry.price_snapshot.keyword_ideas_item_microusd??registry.price_snapshot.keyword_overview_item_microusd);}

export function estimateKeywordOverviewMicrousd(registry, keywordCount) {
  if (!Number.isSafeInteger(keywordCount) || keywordCount < 1 || keywordCount > 60) throw new Error('KEYWORD_COUNT_INVALID');
  return registry.price_snapshot.keyword_overview_task_microusd + keywordCount * registry.price_snapshot.keyword_overview_item_microusd;
}
