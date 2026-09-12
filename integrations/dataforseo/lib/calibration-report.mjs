import {validateCalibrationDataset} from './calibration-validator.mjs';

export function buildCalibrationReport(rows){
  const validation=validateCalibrationDataset(rows,{minimum_kd_coverage:0});
  if(!validation.ok)return {ok:false,decision:'REJECT',errors:validation.errors,metrics:validation.metrics};
  const volumes=rows.map(row=>row.volume).filter(Number.isFinite).sort((a,b)=>a-b),kds=rows.map(row=>row.kd).filter(Number.isFinite).sort((a,b)=>a-b),median=values=>values.length?values[Math.floor(values.length/2)]:null;
  const kdFallbackRequired=validation.metrics.kd_coverage<0.8;
  return {ok:true,decision:kdFallbackRequired?'ELIGIBLE_FOR_SHADOW_WITH_SERP_KD_FALLBACK':'ELIGIBLE_FOR_SHADOW',warnings:kdFallbackRequired?['KD_COVERAGE_BELOW_80_PERCENT','MISSING_KD_MUST_NOT_BECOME_ZERO']:[],required_fallbacks:kdFallbackRequired?['SERP_COMPETITION_ANALYSIS']:[],metrics:{...validation.metrics,median_volume:median(volumes),median_kd:median(kds),zero_volume_ratio:rows.filter(row=>row.volume===0).length/rows.length}};
}
