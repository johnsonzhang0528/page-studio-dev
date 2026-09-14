import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCalibrationArtifactPath} from '../lib/calibration-artifact-path.mjs';

test('reassessment defaults to the current v2 calibration artifact',()=>{
  assert.equal(resolveCalibrationArtifactPath(),'/var/lib/page-autodev/dataforseo/calibration-60-v2.json');
  assert.equal(resolveCalibrationArtifactPath('calibration-60.json'),'/var/lib/page-autodev/dataforseo/calibration-60.json');
  assert.equal(resolveCalibrationArtifactPath('/var/lib/page-autodev/dataforseo/calibration-60-v2.json'),'/var/lib/page-autodev/dataforseo/calibration-60-v2.json');
});

test('reassessment cannot overwrite arbitrary root-owned files',()=>{
  for(const candidate of ['/etc/passwd','../spend-ledger.json','spend-ledger.json','calibration-60-v3.json'])assert.throws(()=>resolveCalibrationArtifactPath(candidate),/NOT_ALLOWED/);
});
