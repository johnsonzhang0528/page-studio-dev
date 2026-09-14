import fs from 'node:fs';
import {buildCalibrationReport} from '../lib/calibration-report.mjs';
import {resolveCalibrationArtifactPath} from '../lib/calibration-artifact-path.mjs';
if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_REASSESSMENT_REQUIRED');
const file=resolveCalibrationArtifactPath(process.argv[2]),artifact=JSON.parse(fs.readFileSync(file,'utf8'));
artifact.report=buildCalibrationReport(artifact.rows);artifact.reassessed_at=new Date().toISOString();
const temporary=`${file}.tmp-${process.pid}`;fs.writeFileSync(temporary,`${JSON.stringify(artifact,null,2)}\n`,{mode:0o600});fs.renameSync(temporary,file);
console.log(JSON.stringify({ok:true,file,report:artifact.report}));
