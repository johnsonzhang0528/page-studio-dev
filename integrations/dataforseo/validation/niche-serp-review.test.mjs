import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../bin/build-taiwan-niche-serp-review.mjs',import.meta.url),'utf8');
test('SERP review is evidence-bound and cannot promote or create a project',()=>{assert.match(source,/receipts\?\.length!==8/);assert.match(source,/automatic_enter:false/);assert.match(source,/project_created:false/);assert.match(source,/url_approval:false/);assert.doesNotMatch(source,/decision:'ENTER'/);});
test('every calibrated topic has an explicit bounded judgment',()=>{for(const topic of ['寵物友善住宿','Excel工作技巧','桌遊推薦','氣炸鍋食譜'])assert.match(source,new RegExp(`'${topic}'`));assert.match(source,/PILOT_CANDIDATE:2/);assert.match(source,/HOLD_LONGTAIL_REFRAME:2/);});
