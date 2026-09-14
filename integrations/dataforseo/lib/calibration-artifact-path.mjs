import path from 'node:path';

const root='/var/lib/page-autodev/dataforseo';
const allowed=new Set(['calibration-60.json','calibration-60-v2.json']);

export function resolveCalibrationArtifactPath(input='calibration-60-v2.json'){
  const candidate=path.isAbsolute(input)?input:path.join(root,input);
  const normalized=path.normalize(candidate);
  if(path.dirname(normalized)!==root||!allowed.has(path.basename(normalized)))throw new Error('CALIBRATION_ARTIFACT_NOT_ALLOWED');
  return normalized;
}
