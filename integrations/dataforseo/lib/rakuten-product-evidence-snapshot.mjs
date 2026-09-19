const SNAPSHOT={
  'TW-012':{coverage:'PRODUCT_EXISTS_RATE_UNOBSERVED',rates_bps:[],urls:['https://www.rakuten.com.tw/shop/ayumi/product/24601726691-1435/']},
  'TW-020':{coverage:'NO_RELIABLE_PRODUCT_LEVEL_EVIDENCE',rates_bps:[],urls:[]},
  'TW-065':{coverage:'RATE_OBSERVED',rates_bps:[100,300],urls:['https://www.rakuten.com.tw/shop/linzhishe/product/5kpbtbyf5/','https://www.rakuten.com.tw/shop/komorebi/product/3L5SdHHo0e/']},
  'TW-066':{coverage:'RATE_OBSERVED',rates_bps:[100],urls:['https://www.rakuten.com.tw/shop/panasonic/product/nf-hc100/']},
  'TW-083':{coverage:'RATE_OBSERVED',rates_bps:[100],urls:['https://www.rakuten.com.tw/shop/sunxlinetech/product/t9jhi9g3x/']},
  'TW-086':{coverage:'RATE_OBSERVED',rates_bps:[100],urls:['https://www.rakuten.com.tw/shop/yoyooutdoor/product/gos810145591390/']},
  'TW-089':{coverage:'PRODUCT_EXISTS_RATE_UNOBSERVED',rates_bps:[],urls:['https://www.rakuten.com.tw/shop/cjdlg/product/qzhnstiec/']},
  'TW-023':{coverage:'RATE_OBSERVED',rates_bps:[100],urls:['https://www.rakuten.com.tw/shop/swd/product/734971038/']}
};

export function buildRakutenProductEvidenceSnapshot(channelVerification){
  if(channelVerification?.mode!=='AFFILIATE_CHANNEL_VERIFICATION'||channelVerification?.paid_api_spend_microusd!==0)throw new Error('VERIFIED_CHANNEL_REGISTER_REQUIRED');
  const candidates=channelVerification.candidates.filter(row=>row.applicable_channel_ids.includes('RAKUTEN_TW_REBATES')).map(candidate=>{
    const evidence=SNAPSHOT[candidate.candidate_id]??{coverage:'NO_RELIABLE_PRODUCT_LEVEL_EVIDENCE',rates_bps:[],urls:[]};
    const observedMax=evidence.rates_bps.length?Math.max(...evidence.rates_bps):null;
    return {...candidate,rakuten_product_evidence:{...evidence,observed_max_rate_bps:observedMax,evidence_scope:'REPRESENTATIVE_PRODUCTS_NOT_CATEGORY_DISTRIBUTION',observed_on:'2026-09-19'},
      decision:observedMax!==null?'HOLD_CATEGORY_SAMPLE_REQUIRED':'HOLD_PRODUCT_RATE_REQUIRED',
      category_rate_proven:false,unit_economics_proven:false,automatic_enter:false};
  });
  return {schema_version:1,mode:'RAKUTEN_PRODUCT_EVIDENCE_SNAPSHOT',market:'Taiwan',candidate_count:candidates.length,
    sampling_rule:{minimum_distinct_products:5,minimum_distinct_sellers:3,maximum_single_seller_share_bps:4000,require_current_rate:true,category_inference_from_single_product:false},
    candidates,paid_api_spend_microusd:0,paid_research_authorized:false,automatic_enter:false,can_build_site:false,
    next_gate:'BOUNDED_FIVE_PRODUCT_THREE_SELLER_SAMPLE_PER_SURVIVING_CATEGORY'};
}
