import { appendEvidenceDurable,readEvidenceChain } from '../lib/soak-evidence-chain.mjs';
const [file,configurationJson]=process.argv.slice(2),configuration=JSON.parse(configurationJson),records=[];
appendEvidenceDurable(file,{event:'start',...configuration,elapsed_ms:0},records);
appendEvidenceDurable(file,{event:'sample',sample:1,elapsed_ms:100,decisions:{},resilience:{},resources:{}},records);
process.stdout.write('READY\n');setInterval(()=>{},1000);
