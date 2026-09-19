const PHYSICAL=/(貓砂|玩具|模具|家電|行車記錄器|背包|自行車|桌遊)/u;

export const CHANNELS=[
  {id:'SHOPEE_TW',status:'OPEN_APPROVAL_REQUIRED',rate_status:'BASE_1_PERCENT_PRODUCT_VARIANCE',publisher_fit:'WEBSITE_ALLOWED_SUBJECT_TO_APPROVAL',source:'https://help.shopee.tw/portal/10/article/123888'},
  {id:'RAKUTEN_TW_REBATES',status:'OPEN_REGISTRATION',rate_status:'STORE_AND_PRODUCT_DYNAMIC',publisher_fit:'SHARE_LINK_AVAILABLE',source:'https://www.rakuten.com.tw/affiliate/'},
  {id:'MOMO_POINT_EARN',status:'CLOSED',rate_status:'NOT_APPLICABLE',publisher_fit:'DISQUALIFIED',closed_on:'2026-01-31',source:'https://www.momoshop.com.tw/league/indexServlet?cid=memb&oid=league'},
  {id:'MOMO_NEW_AFFILIATE',status:'UNVERIFIED_PUBLIC_PUBLISHER_ACCESS',rate_status:'SELLER_CONFIGURED',publisher_fit:'NOT_PROVEN_FOR_GENERAL_WEBSITE',source:'https://rules.momo.com.tw/payment/00003/'},
  {id:'NOTION_AFFILIATE',status:'CLOSED_TO_NEW_AFFILIATES',rate_status:'HISTORICAL_TERMS_NOT_ACTIONABLE',publisher_fit:'DISQUALIFIED_FOR_NEW_PROJECT',source:'https://www.notion.com/affiliates'},
  {id:'CLICKUP_AFFILIATE',status:'OPEN_APPLICATION',rate_status:'UP_TO_USD_25_PER_QUALIFIED_REFERRAL',publisher_fit:'TAIWAN_COMMISSIONABILITY_UNVERIFIED',source:'https://clickup.com/partners/affiliates'}
];

export function buildAffiliateChannelVerification(stressTest){
  if(stressTest?.mode!=='AFFILIATE_ECONOMICS_STRESS_TEST'||stressTest?.paid_api_spend_microusd!==0)throw new Error('VERIFIED_FREE_STRESS_TEST_REQUIRED');
  const candidates=stressTest.candidates.map(candidate=>{
    const physical=PHYSICAL.test(candidate.topic);
    return {
      candidate_id:candidate.candidate_id,topic:candidate.topic,
      applicable_channel_ids:physical?['SHOPEE_TW','RAKUTEN_TW_REBATES']:['CLICKUP_AFFILIATE'],
      excluded_channel_ids:physical?['MOMO_POINT_EARN','MOMO_NEW_AFFILIATE']:['NOTION_AFFILIATE'],
      decision:'HOLD_PRODUCT_LEVEL_CHANNEL_EVIDENCE_REQUIRED',
      blockers:physical?['PRODUCT_EXISTS_IN_CHANNEL_UNVERIFIED','CURRENT_PRODUCT_RATE_UNVERIFIED','COMPLETED_ORDER_CONVERSION_UNVERIFIED']:['TAIWAN_COMMISSIONABILITY_UNVERIFIED','QUALIFIED_REFERRAL_CONVERSION_UNVERIFIED'],
      paid_research_authorized:false,automatic_enter:false
    };
  });
  return {schema_version:1,mode:'AFFILIATE_CHANNEL_VERIFICATION',verified_at:new Date().toISOString(),market:'Taiwan',evidence_policy:'OFFICIAL_PUBLIC_SOURCE_ONLY',channels:CHANNELS,candidates,
    paid_api_spend_microusd:0,paid_research_authorized:false,automatic_enter:false,can_build_site:false,
    next_gate:'VERIFY_EXACT_PRODUCTS_CURRENT_RATES_AND_TAIWAN_PAYOUT_ELIGIBILITY'};
}
