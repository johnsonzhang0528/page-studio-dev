import { spawnSync } from 'node:child_process';
import { checkpointEligiblePath } from './checkpoint-policy.mjs';

export function createGitCheckpoint(project,config={},label='checkpoint'){
  if(config.auto_checkpoint_commits===false) return null;
  const identity=config.git_checkpoint_identity??{name:'Page Studio Autodev',email:'autodev@page-studio.local'},call=args=>spawnSync('git',args,{cwd:project,encoding:'utf8'});
  if(call(['config','--get','user.name']).status!==0) call(['config','user.name',identity.name]);
  if(call(['config','--get','user.email']).status!==0) call(['config','user.email',identity.email]);
  const status=String(call(['status','--porcelain=v1','--untracked-files=all','-z']).stdout??'').split('\0').filter(Boolean).map(entry=>entry.slice(3).split(' -> ').pop().replaceAll('\\','/')),meaningful=status.filter(checkpointEligiblePath);
  if(!meaningful.length){ console.log(`【Git checkpoint 略過】${label} 只有執行狀態變更；狀態已原子保存，不建立無內容 commit。`); return call(['rev-parse','--verify','HEAD']).stdout?.trim()||null; }
  const add=call(['add','-A','--',...meaningful]); if(add.status!==0) throw new Error(`Git checkpoint 無法加入變更：${add.stderr||add.stdout}`);
  const whitespace=call(['diff','--cached','--check']); if(whitespace.status!==0) throw new Error(`Git checkpoint 發現 whitespace 品質問題，拒絕提交：${whitespace.stdout||whitespace.stderr}`);
  if(call(['diff','--cached','--quiet']).status===0){ console.log('【Git checkpoint】目前沒有需要提交的變更。'); return call(['rev-parse','--verify','HEAD']).stdout?.trim()||null; }
  const commit=call(['commit','-m',`chore(autodev): ${label}`]); if(commit.status!==0) throw new Error(`Git checkpoint 建立失敗：${commit.stderr||commit.stdout}`);
  const hash=call(['rev-parse','--short','HEAD']).stdout.trim(); console.log(`【Git checkpoint】已建立 ${hash}｜${label}`); console.log(`【復原參考】如需檢查此版本：git show ${hash}`); return hash;
}
