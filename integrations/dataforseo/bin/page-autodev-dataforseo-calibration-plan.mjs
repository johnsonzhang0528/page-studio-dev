import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildBalancedCalibrationApprovalPlan} from '../lib/balanced-calibration-plan.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const seeds=JSON.parse(fs.readFileSync(path.join(root,'fixtures/taiwan-zhtw-calibration-seeds.json'),'utf8'));
const registry=JSON.parse(fs.readFileSync(path.join(root,'fixtures/provider-registry.json'),'utf8'));
console.log(JSON.stringify(buildBalancedCalibrationApprovalPlan({seeds,registry}),null,2));
