const HIGH_RISK_PATTERN=/(critical|high|security|auth|permission|payment|migration|encryption|安全|權限|認證|授權|付款|遷移|加密|資料完整|不可逆)/i;
const HIGH_RISK_LABELS=new Set(['critical','high','重大','高']);

export function hasHighRiskSignal({risk='',text=''}={}){
  return HIGH_RISK_LABELS.has(String(risk).trim().toLowerCase())||HIGH_RISK_PATTERN.test(String(text));
}

export function selectModelRoute({kind='stage',verification_mode='full',base_model='sonnet',base_effort='high',targeted_model='sonnet',risk='',text='',hybrid_enabled=false,luna_model='gpt-5.6-luna'}={}){
  const highRisk=hasHighRiskSignal({risk,text});
  const anthropic=(model,effort,reason_code,extra={})=>({dispatch:true,provider:'anthropic',model,effort,reason_code,...extra});
  if(kind==='deterministic'||kind==='noop') return {dispatch:false,provider:null,model:null,effort:null,reason_code:'DETERMINISTIC_NO_MODEL',high_risk:false};
  if(kind==='gate'){
    if(verification_mode!=='targeted') return anthropic('opus','high','FINAL_FULL_GATE',{high_risk:highRisk});
    if(highRisk) return anthropic('opus','high','SURVIVING_HIGH_RISK_FINDING',{high_risk:true});
    if(hybrid_enabled) return {dispatch:true,provider:'openai',model:luna_model,effort:'high',reason_code:'TARGETED_LOW_RISK_RECHECK_LUNA',high_risk:false,verification_mode:'read_only'};
    return anthropic(targeted_model,'high','TARGETED_LOW_RISK_RECHECK',{high_risk:false});
  }
  if(kind==='implementation'&&highRisk) return anthropic('opus','high','HIGH_RISK_IMPLEMENTATION',{high_risk:true});
  return anthropic(base_model,base_effort,kind==='implementation'?'STANDARD_IMPLEMENTATION':'STAGE_DEFAULT',{high_risk:false});
}
