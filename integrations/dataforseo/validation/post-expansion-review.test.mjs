import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('post-expansion review is offline, source-bound and cannot promote raw quota to ENTER',()=>{
  const source=fs.readFileSync(new URL('../bin/page-autodev-dataforseo-post-expansion-review.mjs',import.meta.url),'utf8');
  assert.match(source,/validateLiveExpansionPlan/);
  assert.match(source,/REVIEW_LEDGER_NOT_SETTLED/);
  assert.match(source,/balanceDiscoveryRows\(allRows/);
  assert.match(source,/quality\.errors/);
  assert.match(source,/selected_language_flags:selectedLanguageFlags/);
  assert.match(source,/duplicate_groups:duplicateGroups/);
  assert.match(source,/network_dispatch:false/);
  assert.match(source,/auto_enter_allowed:false/);
  assert.match(source,/atomicExpansionArtifact\(target,report\)/);
});
