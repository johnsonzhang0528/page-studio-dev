import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {parseClaudeInvocation,appendInvocationReceipt,usageLedgerPath} from '../lib/usage-ledger.mjs';

const raw=JSON.stringify({message_id:'msg-1',session_id:'session-1',usage:{input_tokens:11,cache_creation_input_tokens:22,cache_read_input_tokens:33,output_tokens:44,thinking_tokens:5}});
assert.deepEqual(parseClaudeInvocation(raw).tokens,{input_tokens:11,cache_creation_input_tokens:22,cache_read_input_tokens:33,output_tokens:44,thinking_tokens:5});
const camel=JSON.stringify({uuid:'msg-2',modelUsage:{opus:{inputTokens:1,cacheCreationInputTokens:2,cacheReadInputTokens:3,outputTokens:4},sonnet:{inputTokens:5,outputTokens:6}}});
assert.deepEqual(parseClaudeInvocation(camel).tokens,{input_tokens:6,cache_creation_input_tokens:2,cache_read_input_tokens:3,output_tokens:10,thinking_tokens:0});
const project=fs.mkdtempSync(path.join(os.tmpdir(),'usage-ledger-')); fs.mkdirSync(path.join(project,'.ai'));
const details={raw,run_id:'run-1',phase:'requirements',unit_id:'REQ-1',attempt:1,model:'opus',effort:'high',exit_code:0,wall_duration_ms:1200};
assert.equal(appendInvocationReceipt(project,details).written,true); assert.equal(appendInvocationReceipt(project,details).deduplicated,true,'同 message/raw 不得重複計數');
const rows=fs.readFileSync(usageLedgerPath(project),'utf8').trim().split('\n').map(JSON.parse); assert.equal(rows.length,1); assert.equal(rows[0].cache_read_input_tokens,33); assert.equal(rows[0].wall_duration_ms,1200);
assert.equal(appendInvocationReceipt(project,{...details,raw:JSON.stringify({...JSON.parse(raw),message_id:'msg-3'})}).written,true); assert.equal(fs.readFileSync(usageLedgerPath(project),'utf8').trim().split('\n').length,2);
fs.rmSync(project,{recursive:true,force:true}); console.log('USAGE_LEDGER_TESTS_OK');
