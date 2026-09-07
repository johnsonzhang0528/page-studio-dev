const HIGH_RISK_PATTERN=/(critical|high|security|auth|permission|payment|migration|encryption|安全|權限|認證|授權|付款|遷移|加密|資料完整|不可逆)/i;
const HIGH_RISK_LABELS=new Set(['critical','high','重大','高']);

export function hasHighRiskSignal({risk='',text=''}={}){
  return HIGH_RISK_LABELS.has(String(risk).trim().toLowerCase())||HIGH_RISK_PATTERN.test(String(text));
}

export function selectModelRoute({kind='stage',verification_mode='full',base_model='sonnet',base_effort='high',targeted_model='sonnet',risk='',text=''}={}){
  const highRisk=hasHighRiskSignal({risk,text});
  if(kind==='deterministic'||kind==='noop') return {dispatch:false,model:null,effort:null,reason_code:'DETERMINISTIC_NO_MODEL',high_risk:false};
  if(kind==='gate'){
    if(verification_mode!=='targeted') return {dispatch:true,model:'opus',effort:'high',reason_code:'FINAL_FULL_GATE',high_risk:highRisk};
    if(highRisk) return {dispatch:true,model:'opus',effort:'high',reason_code:'SURVIVING_HIGH_RISK_FINDING',high_risk:true};
    return {dispatch:true,model:targeted_model,effort:'high',reason_code:'TARGETED_LOW_RISK_RECHECK',high_risk:false};
  }
  if(kind==='implementation'&&highRisk) return {dispatch:true,model:'opus',effort:'high',reason_code:'HIGH_RISK_IMPLEMENTATION',high_risk:true};
  return {dispatch:true,model:base_model,effort:base_effort,reason_code:kind==='implementation'?'STANDARD_IMPLEMENTATION':'STAGE_DEFAULT',high_risk:false};
}
