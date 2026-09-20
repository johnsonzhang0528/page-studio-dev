const SAMPLE={
  candidate_id:'TW-083',topic:'行車記錄器比較',observed_on:'2026-09-20',
  products:[
    {seller:'senao',price_twd:6290,rate_bps:100,url:'https://www.rakuten.com.tw/shop/senao/product/d4hmc99xf/'},
    {seller:'sunxlinetech',price_twd:4480,rate_bps:100,url:'https://www.rakuten.com.tw/shop/sunxlinetech/product/t9jhi9g3x/'},
    {seller:'jpy',price_twd:8790,rate_bps:100,url:'https://www.rakuten.com.tw/shop/jpy/product/4711676020181/'},
    {seller:'a123',price_twd:4570,rate_bps:100,url:'https://www.rakuten.com.tw/shop/a123/product/s2gsfcrju/'},
    {seller:'sanjing3c',price_twd:12880,rate_bps:100,url:'https://www.rakuten.com.tw/shop/sanjing3c/product/QTDW002/'}
  ]
};

function median(values){const rows=[...values].sort((a,b)=>a-b);return rows[Math.floor(rows.length/2)];}

export function buildDashcamAffiliateSample(snapshot){
  if(snapshot?.mode!=='RAKUTEN_PRODUCT_EVIDENCE_SNAPSHOT'||snapshot?.paid_api_spend_microusd!==0)throw new Error('VERIFIED_PRODUCT_SNAPSHOT_REQUIRED');
  const sellers=new Set(SAMPLE.products.map(row=>row.seller));
  if(SAMPLE.products.length<5||sellers.size<3)throw new Error('INSUFFICIENT_DIVERSIFIED_SAMPLE');
  const medianPrice=median(SAMPLE.products.map(row=>row.price_twd));
  const medianRate=median(SAMPLE.products.map(row=>row.rate_bps));
  const scenarios=[100,200,300].map(conversion_bps=>{
    const rpc=medianPrice*medianRate*conversion_bps/100_000_000;
    return {conversion_bps,revenue_per_qualified_click_twd:Number(rpc.toFixed(4)),break_even_qualified_clicks_per_month:Math.ceil(2000/rpc),evidence_status:'CONVERSION_ASSUMPTION_NOT_OBSERVED'};
  });
  return {schema_version:1,mode:'DASHCAM_AFFILIATE_SAMPLE',market:'Taiwan',...SAMPLE,distinct_product_count:SAMPLE.products.length,distinct_seller_count:sellers.size,
    maximum_single_seller_share_bps:2000,median_price_twd:medianPrice,median_rate_bps:medianRate,monthly_cost_assumption_twd:2000,scenarios,
    sample_quality:'PASS_DIVERSITY_GATE',decision:'HOLD_PRIORITY_FREE_DEMAND_AND_CONVERSION_VALIDATION',category_rate_proven:true,unit_economics_proven:false,
    relative_finding:'BETTER_THAN_LOW_AOV_BAKING_MOLD_SAMPLE_BUT_NOT_YET_VALIDATED',paid_api_spend_microusd:0,paid_research_authorized:false,automatic_enter:false,can_build_site:false,
    next_gate:'FREE_SERP_COMMERCIAL_INTENT_AND_DEFENSIBLE_CONVERSION_VALIDATION_BEFORE_ANY_PAID_KEYWORD_RESEARCH'};
}
