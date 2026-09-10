import assert from 'node:assert/strict';
import { safeSubprocessEnv, redactSecrets } from '../lib/subprocess-policy.mjs';

const env=safeSubprocessEnv({PATH:'/bin',HOME:'/tmp/home',LANG:'C',ANTHROPIC_API_KEY:'anthropic-secret',TELEGRAM_BOT_TOKEN:'telegram-secret',DATABASE_URL:'postgresql://admin:pw@db/app'},{CI:'1'});
assert.deepEqual(env,{HOME:'/tmp/home',PATH:'/bin',LANG:'C',CI:'1'});
console.log('DEATH_EVIDENCE DT-013 subprocess_environment_allowlist');
assert.equal(Object.values(env).some(value=>/anthropic-secret|telegram-secret|admin:pw/.test(value)),false);
console.log('DEATH_EVIDENCE DT-014 inherited_credentials_removed');

const output=redactSecrets('Authorization=Bearer abc.def token=plain-secret password=hunter2 {"token":"json-secret","api_key":"json-key"} postgresql://admin:s3cr3t@db/app\n-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----');
for(const secret of ['abc.def','plain-secret','hunter2','json-secret','json-key','s3cr3t','private material']) assert.equal(output.includes(secret),false,`${secret} must be redacted`);
console.log('DEATH_EVIDENCE DT-015 structured_secret_redaction');
assert.match(output,/\[REDACTED/);
console.log('DEATH_EVIDENCE DT-016 redaction_receipt_present');
console.log('SUBPROCESS_POLICY_TESTS_OK');
