const validLimit = value => Number.isSafeInteger(value) && value >= 0;

export const DEFAULT_BUDGET_POLICY = Object.freeze({
  per_request_microusd: 20_000,
  per_project_daily_microusd: 250_000,
  global_daily_microusd: 500_000,
  global_monthly_microusd: 5_000_000
});

export function validateBudgetPolicy(policy = DEFAULT_BUDGET_POLICY) {
  const errors = [];
  for (const [key, value] of Object.entries(policy)) if (!validLimit(value)) errors.push(`INVALID_LIMIT:${key}`);
  if (policy.per_request_microusd > policy.per_project_daily_microusd) errors.push('REQUEST_EXCEEDS_PROJECT_DAILY');
  if (policy.per_project_daily_microusd > policy.global_daily_microusd) errors.push('PROJECT_EXCEEDS_GLOBAL_DAILY');
  if (policy.global_daily_microusd > policy.global_monthly_microusd) errors.push('DAILY_EXCEEDS_MONTHLY');
  return {ok: errors.length === 0, errors};
}
export function authorizeFourLayerBudget({estimated_microusd, project_day_used_microusd, global_day_used_microusd, global_month_used_microusd}, policy = DEFAULT_BUDGET_POLICY) {
  const policyResult = validateBudgetPolicy(policy);
  if (!policyResult.ok) return {ok: false, reason: 'BUDGET_POLICY_INVALID', errors: policyResult.errors};
  const values = {estimated_microusd, project_day_used_microusd, global_day_used_microusd, global_month_used_microusd};
  if (Object.values(values).some(value => !validLimit(value))) return {ok: false, reason: 'BUDGET_USAGE_INVALID'};
  if (estimated_microusd > policy.per_request_microusd) return {ok: false, reason: 'REQUEST_CAP_EXCEEDED'};
  if (project_day_used_microusd + estimated_microusd > policy.per_project_daily_microusd) return {ok: false, reason: 'PROJECT_DAILY_CAP_EXCEEDED'};
  if (global_day_used_microusd + estimated_microusd > policy.global_daily_microusd) return {ok: false, reason: 'GLOBAL_DAILY_CAP_EXCEEDED'};
  if (global_month_used_microusd + estimated_microusd > policy.global_monthly_microusd) return {ok: false, reason: 'GLOBAL_MONTHLY_CAP_EXCEEDED'};
  return {ok: true, reserved_microusd: estimated_microusd};
}
