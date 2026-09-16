import {validateKeywordOverviewRequest,validateKeywordIdeasRequest,validateBalancedKeywordIdeasBatch,validateKeywordIdeasExpansionRequest,requestFingerprint} from './dataforseo-contract.mjs';
import {validateSerpStandardRequest,validateSerpLiveAdvancedRequest} from './dataforseo-serp-contract.mjs';
import {authorizeFourLayerBudget} from './budget-policy.mjs';
import {validateProviderRegistry} from './provider-registry.mjs';
import {estimateKeywordOverviewMicrousd,estimateKeywordIdeasMicrousd,estimateBalancedKeywordIdeasMicrousd,estimateKeywordIdeasExpansionMicrousd,estimateSerpLiveAdvancedMicrousd} from './provider-registry.mjs';

export class BillingGateway {
  constructor({ledger, registry, budget_policy, usage_reader, clock = () => Date.now(), activation_mode = 'disabled'}) {
    if (!ledger || typeof ledger.reserve !== 'function') throw new Error('LEDGER_REQUIRED');
    if (typeof usage_reader !== 'function') throw new Error('USAGE_READER_REQUIRED');
    this.ledger = ledger;
    this.registry = registry;
    this.budgetPolicy = budget_policy;
    this.usageReader = usage_reader;
    this.clock = clock;
    this.activationMode = activation_mode;
  }

  async authorize({capability, request, estimated_microusd, project_id, day}) {
    const registryCheck = validateProviderRegistry(this.registry, {now: this.clock(), expected_activation: this.activationMode});
    if (!registryCheck.ok) return {ok: false, reason: 'PROVIDER_DISABLED_OR_INVALID', errors: registryCheck.errors};
    const contract = capability === 'keyword_overview' ? validateKeywordOverviewRequest(request)
      : capability === 'keyword_ideas' ? validateKeywordIdeasRequest(request)
      : capability === 'keyword_ideas_balanced' ? validateBalancedKeywordIdeasBatch(request)
      : capability === 'keyword_ideas_expansion' ? (()=>{const errors=[];if(!Array.isArray(request)||request.length<1||request.length>6)return {ok:false,errors:['EXPANSION_BATCH_INVALID']};request.forEach((item,index)=>{const check=validateKeywordIdeasExpansionRequest(item);if(!check.ok)errors.push(...check.errors.map(error=>`TASK_${index}:${error}`));});return {ok:errors.length===0,errors,fingerprint:errors.length?null:requestFingerprint(request)};})()
      : capability === 'serp_standard' ? validateSerpStandardRequest(request)
      : capability === 'serp_live_advanced' ? validateSerpLiveAdvancedRequest(request)
      : {ok: false, errors: ['CAPABILITY_FORBIDDEN']};
    if (!contract.ok) return {ok: false, reason: 'REQUEST_CONTRACT_REJECTED', errors: contract.errors};
    if (capability === 'keyword_overview') {
      const trustedEstimate = estimateKeywordOverviewMicrousd(this.registry, request.keywords.length);
      if (estimated_microusd !== trustedEstimate) return {ok: false, reason: 'UNTRUSTED_COST_ESTIMATE', trusted_estimated_microusd: trustedEstimate};
    }
    if (capability === 'keyword_ideas') {const trustedEstimate=estimateKeywordIdeasMicrousd(this.registry,request.limit);if(estimated_microusd!==trustedEstimate)return {ok:false,reason:'UNTRUSTED_COST_ESTIMATE',trusted_estimated_microusd:trustedEstimate};}
    if (capability === 'keyword_ideas_balanced') {const trustedEstimate=estimateBalancedKeywordIdeasMicrousd(this.registry,request);if(estimated_microusd!==trustedEstimate)return {ok:false,reason:'UNTRUSTED_COST_ESTIMATE',trusted_estimated_microusd:trustedEstimate};}
    if (capability === 'keyword_ideas_expansion') {const trustedEstimate=estimateKeywordIdeasExpansionMicrousd(this.registry,request);if(estimated_microusd!==trustedEstimate)return {ok:false,reason:'UNTRUSTED_COST_ESTIMATE',trusted_estimated_microusd:trustedEstimate};}
    if (capability === 'serp_live_advanced') {let trustedEstimate;try{trustedEstimate=estimateSerpLiveAdvancedMicrousd(this.registry,this.clock());}catch(error){return {ok:false,reason:'SERP_PRICE_SNAPSHOT_INVALID',errors:[error.message]};}if(estimated_microusd!==trustedEstimate)return {ok:false,reason:'UNTRUSTED_COST_ESTIMATE',trusted_estimated_microusd:trustedEstimate};}
    const usage = await this.usageReader({project_id, day});
    const budget = authorizeFourLayerBudget({estimated_microusd, ...usage}, this.budgetPolicy);
    if (!budget.ok) return budget;
    const lease = await this.ledger.reserve({fingerprint: contract.fingerprint, estimated_microusd, project_id, day});
    return lease.status === 'RESERVED' ? {ok: true, lease} : {ok: false, reason: lease.reason ?? `LEASE_${lease.status}`};
  }
}
