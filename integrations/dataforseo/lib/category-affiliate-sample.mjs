const SAMPLE={
  candidate_id:'TW-065',topic:'烘焙模具比較',observed_on:'2026-09-20',
  products:[
    {seller:'tinaestore',price_twd:173,rate_bps:100,url:'https://www.rakuten.com.tw/shop/tinaestore/product/rmsm16277327/'},
    {seller:'cwow1',price_twd:792,rate_bps:100,url:'https://www.rakuten.com.tw/shop/cwow1/product/2233362/'},
    {seller:'linzhishe',price_twd:433,rate_bps:100,url:'https://www.rakuten.com.tw/shop/linzhishe/product/5kpbtbyf5/'},
    {seller:'metis',price_twd:1177,rate_bps:100,url:'https://www.rakuten.com.tw/shop/metis/product/cwlkkr05b/'},
    {seller:'hyhtrade11ruten',price_twd:308,rate_bps:100,url:'https://www.rakuten.com.tw/shop/hyhtrade11ruten/product/1pxrrs161/'}
  ],
  excluded:[{reason:'EXPIRED_LIMITED_PROMOTION',rate_bps:1000,expired_on:'2026-07-31',url:'https://www.rakuten.com.tw/shop/starrain/product/2ty0wknfn/'}]
};

function median(values){const rows=[...values].sort((a,b)=>a-b);return rows[Math.floor(rows.length/2)];}

export function buildCategoryAffiliateSample(snapshot){
  if(snapshot?.mode!=='RAKUTEN_PRODUCT_EVIDENCE_SNAPSHOT'||snapshot?.paid_api_spend_microusd!==0)throw new Error('VERIFIED_PRODUCT_SNAPSHOT_REQUIRED');
  const sellers=new Set(SAMPLE.products.map(row=>row.seller));
  if(SAMPLE.products.length<5||sellers.size<3)throw new Error('INSUFFICIENT_DIVERSIFIED_SAMPLE');
  const medianPrice=median(SAMPLE.products.map(row=>row.price_twd));
  const medianRate=median(SAMPLE.products.map(row=>row.rate_bps));
  const scenarios=[100,200,300].map(conversion_bps=>{
    const rpc=medianPrice*medianRate*conversion_bps/100_000_000;
    return {conversion_bps,revenue_per_qualified_click_twd:Number(rpc.toFixed(4)),break_even_qualified_clicks_per_month:Math.ceil(2000/rpc)};
  });
  return {schema_version:1,mode:'CATEGORY_AFFILIATE_SAMPLE',market:'Taiwan',...SAMPLE,distinct_product_count:SAMPLE.products.length,distinct_seller_count:sellers.size,
    maximum_single_seller_share_bps:2000,median_price_twd:medianPrice,median_rate_bps:medianRate,monthly_cost_assumption_twd:2000,scenarios,
    sample_quality:'PASS_DIVERSITY_GATE',decision:'HOLD_LOW_STABLE_COMMISSION_AND_TRAFFIC_BURDEN',category_rate_proven:true,unit_economics_proven:false,
    paid_api_spend_microusd:0,paid_research_authorized:false,automatic_enter:false,can_build_site:false,
    next_gate:'DO_NOT_SPEND_ON_KEYWORDS_UNLESS_A_SECOND_STABLE_REVENUE_CHANNEL_OR_HIGHER_CURRENT_RATE_IS_VERIFIED'};
}
