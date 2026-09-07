import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../lib/rollout-control.mjs',import.meta.url),'utf8');
const stopSignals=['gate_bypass','quality_bypass','approval_bypass','source_recheck_bypass','cache_provenance_invalid','state_unrecoverable','finding_revision_unknown','token_duplicate','quota_oversold','migration_non_idempotent','progress_without_evidence','legacy_death_test_failed','mutation_survived','machine_signature_redispatched'];
const mutants=[
  ...stopSignals.map(signal=>({id:`drop-stop-${signal}`,change:text=>text.replace(`'${signal}',`,''),kill:module=>{ const result=module.evaluateRollback({[signal]:true}); assert.equal(result.stop_required,true); assert.ok(result.reasons.includes(signal)); }})),
  {id:'allow-shadow-dispatch',change:text=>text.replace('dispatch_allowed:false,write_allowed:false','dispatch_allowed:true,write_allowed:false'),kill:module=>assert.equal(module.buildShadowReceipt({project:'fixture',state:{},featureRegistry:module.resolveFeatureRegistry({rollout:{mode:'shadow'}})}).receipt.dispatch_allowed,false)},
  {id:'allow-shadow-write',change:text=>text.replace('dispatch_allowed:false,write_allowed:false','dispatch_allowed:false,write_allowed:true'),kill:module=>assert.equal(module.buildShadowReceipt({project:'fixture',state:{},featureRegistry:module.resolveFeatureRegistry({rollout:{mode:'shadow'}})}).receipt.write_allowed,false)},
  ...['gate_pass','quality_pass','approval_current','source_current'].map(key=>({id:`drop-quality-${key}`,change:text=>text.replace(key==='source_current'?`'${key}']`:`'${key}',`,key==='source_current'?']':''),kill:module=>{ const registry=module.resolveFeatureRegistry({rollout:{mode:'shadow'}}),result=module.buildShadowReceipt({project:'fixture',state:{},featureRegistry:registry,baseline:{[key]:true},candidate:{[key]:false}}); assert.equal(result.ok,false); }})),
  {id:'allow-required-feature-disable',change:text=>text.replace('if(definition.required&&!features[name])','if(false&&definition.required&&!features[name])'),kill:module=>assert.equal(module.resolveFeatureRegistry({rollout:{mode:'active',features:{canonical_schema:false,selective_invalidation:false,architecture_ir:false,bounded_findings:false,progress_metrics:false}}}).ok,false)},
  {id:'allow-unknown-feature',change:text=>text.replace('if(!FEATURE_DEFINITIONS[name])','if(false&&!FEATURE_DEFINITIONS[name])'),kill:module=>assert.equal(module.resolveFeatureRegistry({rollout:{features:{invented:true}}}).ok,false)}
];

let killed=0;
for(const mutant of mutants){
  const changed=mutant.change(source); assert.notEqual(changed,source,`${mutant.id} 未實際修改受測程式`);
  const module=await import(`data:text/javascript;base64,${Buffer.from(changed).toString('base64')}#${mutant.id}`);
  try { mutant.kill(module); } catch { killed+=1; continue; }
  throw new Error(`MUTANT_SURVIVED：${mutant.id}`);
}
assert.equal(killed,mutants.length);
console.log(JSON.stringify({ok:true,total:mutants.length,killed,kill_rate_percent:100},null,2));
