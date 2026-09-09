import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONTROLLER_FILES, buildMigrationInventory } from './migration-inventory.mjs';
import { writeDurableJson } from './transactions.mjs';

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const migrationsRoot=project=>path.join(project,'.ai','archive','workflow-migrations');
const safeId=value=>{ const id=String(value??''); if(!/^[0-9TZ.-]+$/.test(id)||id.includes('..')) throw new Error('MIGRATION_ID_INVALID'); return id; };
function durableCopy(source,destination){
  fs.mkdirSync(path.dirname(destination),{recursive:true}); const raw=fs.readFileSync(source),fd=fs.openSync(destination,'w',0o600);
  try{ fs.writeFileSync(fd,raw); fs.fsyncSync(fd); }finally{ fs.closeSync(fd); }
  return {sha256:sha256(raw),bytes:raw.length};
}
function assertQuiescent(inventory){
  const pending=Object.entries(inventory.transactions.states).filter(([state,count])=>!['COMMITTED','ABORTED'].includes(state)&&count>0);
  if(inventory.leases.count||pending.length) throw new Error(`MIGRATION_NOT_QUIESCENT：leases=${inventory.leases.count} pending=${pending.map(([state,count])=>`${state}:${count}`).join(',')||0}`);
}
export function buildMigrationPlan(project){
  const inventory=buildMigrationInventory(project),actions=[{action:'backup_controller_state',required:true},{action:'reconcile_workflow_graph',required:true},{action:'invalidate_legacy_gate_cache',required:true},{action:'validate_approval_and_transaction_chain',required:true}];
  for(const artifact of inventory.controller_artifacts.filter(item=>item.status!=='valid')) actions.push({action:artifact.status==='corrupt'?'quarantine_corrupt_artifact':'initialize_missing_artifact',path:artifact.path,required:true});
  return {schema_version:1,mode:'dry-run',project_id:inventory.project_id,inventory_sha256:inventory.inventory_sha256,blocked:inventory.leases.count>0||Object.entries(inventory.transactions.states).some(([state,count])=>!['COMMITTED','ABORTED'].includes(state)&&count>0),actions};
}
export function createMigrationBackup(project,{id=new Date().toISOString().replace(/:/g,'-')}={}){
  id=safeId(id); const before=buildMigrationInventory(project); assertQuiescent(before);
  const root=path.join(migrationsRoot(project),id); if(fs.existsSync(root)) throw new Error(`MIGRATION_BACKUP_EXISTS：${id}`);
  const files={};
  for(const relative of CONTROLLER_FILES){ const source=path.join(project,relative); if(!fs.existsSync(source)){ files[relative]={existed:false}; continue; } files[relative]={existed:true,...durableCopy(source,path.join(root,'files',relative))}; }
  const manifest={schema_version:1,migration_id:id,project_id:path.basename(project),head_before:before.head,inventory_before_sha256:before.inventory_sha256,files,status:'BACKED_UP'};
  writeDurableJson(path.join(root,'manifest.json'),manifest); return manifest;
}
export function finalizeMigrationBackup(project,id){
  id=safeId(id); const file=path.join(migrationsRoot(project),id,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8')),after=buildMigrationInventory(project);
  manifest.status='APPLIED'; manifest.head_after=after.head; manifest.inventory_after_sha256=after.inventory_sha256; writeDurableJson(file,manifest); return manifest;
}
export function rollbackMigration(project,id){
  id=safeId(id); const beforeRollback=buildMigrationInventory(project); assertQuiescent(beforeRollback);
  const root=path.join(migrationsRoot(project),id),file=path.join(root,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  if(manifest.project_id!==path.basename(project)||!['BACKED_UP','APPLIED'].includes(manifest.status)) throw new Error('MIGRATION_MANIFEST_INVALID');
  for(const [relative,record] of Object.entries(manifest.files)){
    const destination=path.join(project,relative),source=path.join(root,'files',relative);
    if(record.existed){ const raw=fs.readFileSync(source); if(sha256(raw)!==record.sha256) throw new Error(`MIGRATION_BACKUP_CORRUPT：${relative}`); durableCopy(source,destination); }
    else if(fs.existsSync(destination)) fs.rmSync(destination,{force:true});
  }
  manifest.status='ROLLED_BACK'; manifest.rollback_inventory_sha256=buildMigrationInventory(project).inventory_sha256; writeDurableJson(file,manifest); return manifest;
}
