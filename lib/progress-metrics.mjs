const COMPLETE=new Set(['complete','completed','done','passed']);
const clamp=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
const fraction=items=>Array.isArray(items)&&items.length?items.filter(item=>COMPLETE.has(String(item?.status??'').toLowerCase())).length/items.length:0;

export function computeProgressMetrics({state={},phaseGraph={},taskGraph={},phases=[],weights={}}={}){
  if(state.phase==='complete'||state.status==='complete') return {product_percent:100,workflow_percent:100,current_phase_percent:100,journey_percent:100,is_rework:false,furthest_phase:'complete',release_confidence_percent:100,phase_fraction:1,verification:{done:0,total:0,percent:100}};
  const currentIndex=phases.indexOf(state.phase),planningGateIndex=phases.indexOf('planning_gate'),taskGraphCurrent=currentIndex>planningGateIndex||state.gates?.planning_gate?.status==='passed',tasks=taskGraphCurrent?(taskGraph.tasks??[]).filter(task=>!String(task.id??'').startsWith('REQ-')):[],taskFraction=fraction(tasks),currentPlan=phaseGraph.phases?.[state.phase],phaseFraction=currentPlan?.units?.length?fraction(currentPlan.units):state.phase==='implementation'?taskFraction:state.gates?.[state.phase]?.status==='passed'?1:0;
  let workflow=state.phase==='not_started'||currentIndex<0?0:phases.slice(0,currentIndex).reduce((sum,phase)=>sum+Number(weights[phase]??0),0)+Number(weights[state.phase]??0)*phaseFraction;
  const progressedPlans=Object.entries(phaseGraph.phases??{}).filter(([,plan])=>COMPLETE.has(String(plan?.status??'').toLowerCase())||(plan?.units??[]).some(unit=>COMPLETE.has(String(unit?.status??'').toLowerCase()))).map(([phase])=>phase);
  const reached=new Set([state.phase,...progressedPlans,...(state.history??[]).map(entry=>entry?.phase)].filter(Boolean));
  let furthestIndex=currentIndex;
  for(const phase of reached) furthestIndex=Math.max(furthestIndex,phases.indexOf(phase));
  const furthestPhase=furthestIndex>=0?phases[furthestIndex]:state.phase;
  const reachedBase=furthestIndex<0?0:phases.slice(0,furthestIndex).reduce((sum,phase)=>sum+Number(weights[phase]??0),0);
  const persistedPeak=Math.max(0,Number(state.workflow_peak_percent??0));
  const journey=Math.max(workflow,reachedBase,persistedPeak);
  let release=80*taskFraction;
  for(const [phase,weight] of [['implementation_gate',10],['qa',8],['release_gate',2]]){ const index=phases.indexOf(phase),plan=phaseGraph.phases?.[phase]; let part=0; if(currentIndex>index) part=1; else if(plan?.units?.length) part=fraction(plan.units); else if(state.gates?.[phase]?.status==='passed') part=1; release+=weight*part; }
  const done=currentPlan?.units?.filter(unit=>COMPLETE.has(String(unit.status??'').toLowerCase())).length??0,total=currentPlan?.units?.length??0;
  return {product_percent:clamp(taskFraction*100),workflow_percent:clamp(journey),current_phase_percent:clamp(workflow),journey_percent:clamp(journey),is_rework:currentIndex>=0&&furthestIndex>currentIndex,furthest_phase:furthestPhase,release_confidence_percent:clamp(release),phase_fraction:phaseFraction,verification:{done,total,percent:total?clamp(done/total*100):0}};
}
