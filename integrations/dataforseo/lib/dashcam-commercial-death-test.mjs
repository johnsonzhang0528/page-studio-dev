function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function keywordEvidence(demand) {
  const receipt = demand.receipts?.find(row => row.id === 'DASH-KW-001');
  if (!receipt) throw new Error('KEYWORD_RECEIPT_MISSING');
  const task = receipt.envelope?.tasks?.[0];
  const requested = task?.data?.keywords;
  const items = task?.result?.[0]?.items;
  if (!Array.isArray(requested) || !Array.isArray(items)) throw new Error('KEYWORD_EVIDENCE_INVALID');
  const byKeyword = new Map(items.map(row => [row.keyword, row]));
  const rows = requested.map(keyword => {
    const item = byKeyword.get(keyword);
    if (!item) return {keyword, evidence_status: 'PROVIDER_OMITTED', search_volume: null};
    return {
      keyword,
      evidence_status: 'OBSERVED',
      search_volume: item.keyword_info?.search_volume ?? null,
      cpc_usd: item.keyword_info?.cpc ?? null,
      paid_ads_competition: item.keyword_info?.competition ?? null,
      paid_ads_competition_level: item.keyword_info?.competition_level ?? null,
      seo_kd: null
    };
  });
  const observed = rows.filter(row => Number.isFinite(row.search_volume));
  const total = observed.reduce((sum, row) => sum + row.search_volume, 0);
  const head = observed.toSorted((a, b) => b.search_volume - a.search_volume)[0];
  return {
    requested_count: requested.length,
    observed_count: observed.length,
    omitted_count: rows.length - observed.length,
    known_monthly_search_volume: total,
    head_keyword: head?.keyword ?? null,
    head_volume_share: total ? round(head.search_volume / total) : null,
    seo_kd_status: 'NOT_MEASURED',
    paid_ads_competition_is_not_seo_kd: true,
    rows
  };
}

function serpEvidence(demand) {
  const receipts = demand.receipts?.filter(row => row.id?.startsWith('DASH-SERP-')) ?? [];
  if (receipts.length !== 3) throw new Error('SERP_RECEIPTS_INCOMPLETE');
  const queries = receipts.map(receipt => {
    const task = receipt.envelope?.tasks?.[0];
    const items = task?.result?.[0]?.items ?? [];
    const organic = items.filter(row => row.type === 'organic');
    return {
      query: task?.data?.keyword ?? null,
      organic_result_count: organic.length,
      domains: [...new Set(organic.map(row => row.domain).filter(Boolean))]
    };
  });
  const frequency = new Map();
  for (const query of queries) for (const domain of query.domains) frequency.set(domain, (frequency.get(domain) ?? 0) + 1);
  return {
    query_count: queries.length,
    repeated_domains: [...frequency].filter(([, count]) => count >= 2).map(([domain, query_count]) => ({domain, query_count})),
    queries
  };
}

export function buildDashcamCommercialDeathTest(demand, affiliate) {
  if (demand?.completed !== true || demand?.recovery_completed !== true) throw new Error('DEMAND_EVIDENCE_INCOMPLETE');
  if (affiliate?.sample_quality !== 'PASS_DIVERSITY_GATE') throw new Error('AFFILIATE_SAMPLE_INVALID');
  const keyword = keywordEvidence(demand);
  const serp = serpEvidence(demand);
  const revenuePerSale = affiliate.median_price_twd * affiliate.median_rate_bps / 10_000;
  const scenarios = affiliate.scenarios.map(row => ({
    ...row,
    break_even_search_capture_share: keyword.known_monthly_search_volume
      ? round(row.break_even_qualified_clicks_per_month / keyword.known_monthly_search_volume)
      : null
  }));
  const optimistic = scenarios.toSorted((a, b) => b.conversion_bps - a.conversion_bps)[0];
  const fatal = [];
  if (keyword.head_volume_share > 0.8) fatal.push('DEMAND_OVERCONCENTRATED_IN_ONE_HEAD_QUERY');
  if (affiliate.median_rate_bps <= 100) fatal.push('LOW_AFFILIATE_COMMISSION_RATE');
  if (optimistic.break_even_search_capture_share > 0.1) fatal.push('OPTIMISTIC_BREAK_EVEN_REQUIRES_OVER_10_PERCENT_OF_KNOWN_SEARCH_DEMAND');
  if (scenarios.every(row => row.evidence_status === 'CONVERSION_ASSUMPTION_NOT_OBSERVED')) fatal.push('CONVERSION_RATE_UNOBSERVED');
  if (keyword.omitted_count > 0) fatal.push('KEYWORD_PROVIDER_OMISSION_REQUIRES_UNKNOWN_NOT_ZERO');
  const rejectStandalone = fatal.includes('DEMAND_OVERCONCENTRATED_IN_ONE_HEAD_QUERY')
    && fatal.includes('LOW_AFFILIATE_COMMISSION_RATE')
    && fatal.includes('OPTIMISTIC_BREAK_EVEN_REQUIRES_OVER_10_PERCENT_OF_KNOWN_SEARCH_DEMAND')
    && fatal.includes('CONVERSION_RATE_UNOBSERVED');
  return {
    schema_version: 1,
    mode: 'OFFLINE_COMMERCIAL_DEATH_TEST',
    candidate_id: affiliate.candidate_id,
    topic: affiliate.topic,
    decision: rejectStandalone ? 'REJECT_STANDALONE_SITE' : 'HOLD_EVIDENCE_INCOMPLETE',
    cluster_disposition: rejectStandalone ? 'HOLD_FOR_BROADER_AUTOMOTIVE_CLUSTER' : 'NONE',
    automatic_enter: false,
    can_build_site: false,
    paid_api_calls_made: 0,
    incremental_paid_api_spend_microusd: 0,
    prior_research_cost_microusd: demand.cumulative_research_cost_microusd,
    keyword_evidence: keyword,
    serp_evidence: serp,
    economics: {
      median_price_twd: affiliate.median_price_twd,
      median_rate_bps: affiliate.median_rate_bps,
      revenue_per_sale_twd: round(revenuePerSale, 2),
      monthly_cost_assumption_twd: affiliate.monthly_cost_assumption_twd,
      required_sales_per_month: Math.ceil(affiliate.monthly_cost_assumption_twd / revenuePerSale),
      scenarios
    },
    fatal_findings: fatal,
    conclusion: rejectStandalone
      ? 'Do not build a standalone dashcam site. Preserve the topic only as a possible cluster inside a broader automotive property.'
      : 'Do not advance until missing commercial evidence is resolved.'
  };
}
