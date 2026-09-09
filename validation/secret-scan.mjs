import { scanRuntimeSecrets, scanTrackedSecrets } from '../lib/secret-scan.mjs';

const project=process.argv[2]??process.cwd(),includeRuntime=process.argv.includes('--runtime'),findings=[...scanTrackedSecrets(project),...(includeRuntime?scanRuntimeSecrets(project):[])];
if(findings.length){ console.error(JSON.stringify({ok:false,findings},null,2)); process.exitCode=1; }
else console.log(JSON.stringify({ok:true,scanned:includeRuntime?'tracked+runtime':'tracked'},null,2));
