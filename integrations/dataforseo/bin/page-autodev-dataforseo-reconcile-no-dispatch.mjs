import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_RECONCILIATION_REQUIRED');
const [lease_id,evidence_sha256]=process.argv.slice(2);if(!/^[a-f0-9]{64}$/.test(lease_id??'')||!/^[a-f0-9]{64}$/.test(evidence_sha256??''))throw new Error('RECONCILIATION_ARGUMENTS_INVALID');
const ledger=new DurableSpendLedger({file:'/var/lib/page-autodev/dataforseo/spend-ledger.json',daily_cap_microusd:12120});
const result=await ledger.reconcileNoDispatch(lease_id,{reason:'SERVICE_CRASHED_BEFORE_LISTENER',evidence_sha256});console.log(JSON.stringify({ok:true,lease_id:result.lease_id,status:result.status,evidence_sha256}));
