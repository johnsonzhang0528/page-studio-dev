const STATES=new Set(['VERIFIED','UNVERIFIED','NOT_APPLICABLE']);

function money(value,name){
  if(!Number.isInteger(value)||value<0)throw new Error(`INVALID_${name}`);
  return value;
}

export function evaluateBusinessModelGate(input){
  if(!input||input.schema_version!==1)throw new Error('INVALID_BUSINESS_MODEL_INPUT');
  const pilotCap=money(input.pilot_cash_cap_twd,'PILOT_CASH_CAP_TWD');
  const hourCap=money(input.pilot_hour_cap,'PILOT_HOUR_CAP');
  const hourValue=input.operator_hour_value_twd;
  const evidence=input.evidence??{};
  for(const [name,value] of Object.entries(evidence))if(!STATES.has(value))throw new Error(`INVALID_EVIDENCE_${name}`);
  const scenarios=(input.product_scenarios??[]).map(row=>{
    const price=money(row.price_twd,'PRICE_TWD');
    const feeBuffer=money(row.fee_buffer_bps,'FEE_BUFFER_BPS');
    if(feeBuffer>10000)throw new Error('INVALID_FEE_BUFFER_BPS');
    const netPerSale=Math.floor(price*(10000-feeBuffer)/10000);
    return {...row,price_twd:price,fee_buffer_bps:feeBuffer,net_per_sale_twd:netPerSale,
      cash_break_even_sales:netPerSale>0?Math.ceil(pilotCap/netPerSale):null,
      full_cost_break_even_sales:Number.isInteger(hourValue)&&hourValue>=0&&netPerSale>0
        ?Math.ceil((pilotCap+hourCap*hourValue)/netPerSale):null};
  });
  const blockers=[];
  if(evidence.product_demand!=='VERIFIED')blockers.push('PRODUCT_DEMAND_UNVERIFIED');
  if(evidence.price_willingness!=='VERIFIED')blockers.push('PRICE_WILLINGNESS_UNVERIFIED');
  if(evidence.checkout_payout!=='VERIFIED')blockers.push('CHECKOUT_PAYOUT_UNVERIFIED');
  if(!Number.isInteger(hourValue)||hourValue<0)blockers.push('OPERATOR_HOUR_VALUE_MISSING');
  if(scenarios.length!==3)blockers.push('THREE_SCENARIOS_REQUIRED');
  return {
    schema_version:1,
    gate:'BUSINESS_MODEL_AND_UNIT_ECONOMICS',
    decision:blockers.length?'HOLD_BUSINESS_MODEL_NOT_VALIDATED':'PILOT_ECONOMICS_APPROVED',
    can_register_domain:false,
    can_build_site:false,
    can_release_pilot:blockers.length===0,
    primary_model:'ORIGINAL_EXCEL_DIGITAL_PRODUCTS',
    secondary_models:{ads:'SECONDARY_UNMODELED',affiliate:'UNVERIFIED_NOT_MODELED',b2b:'OPTIONAL_DIFFERENT_BUSINESS_MODEL'},
    scenarios,
    blockers,
    evidence,
    caveats:['SCENARIOS_ARE_TEST_ASSUMPTIONS_NOT_REVENUE_FORECASTS','SEO_TRAFFIC_AND_CONVERSION_REMAIN_UNPROVEN','PLATFORM_APPROVAL_AND_PAYOUT_SETUP_REQUIRED']
  };
}
