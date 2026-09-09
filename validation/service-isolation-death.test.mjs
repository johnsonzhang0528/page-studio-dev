import assert from 'node:assert/strict';
import fs from 'node:fs';

const service=fs.readFileSync(new URL('../systemd/page-autodev@.service',import.meta.url),'utf8');
const lines=Object.fromEntries(service.split(/\r?\n/).filter(line=>line.includes('=')).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
const attacks=[
  ['write_user_config',()=>assert.ok(!lines.ReadWritePaths.split(/\s+/).includes('%h/.config'))],
  ['read_ssh_key',()=>assert.match(lines.InaccessiblePaths,/%h\/\.ssh(?:\s|$)/)],
  ['read_cloud_key',()=>assert.match(lines.InaccessiblePaths,/%h\/\.aws(?:\s|$)/)],
  ['read_container_auth',()=>assert.match(lines.InaccessiblePaths,/%h\/\.docker(?:\s|$)/)],
  ['read_kube_auth',()=>assert.match(lines.InaccessiblePaths,/%h\/\.kube(?:\s|$)/)],
  ['inspect_host_processes',()=>{assert.equal(lines.ProtectProc,'invisible');assert.equal(lines.ProcSubset,'pid');}],
  ['gain_privilege',()=>{assert.equal(lines.NoNewPrivileges,'true');assert.equal(lines.CapabilityBoundingSet,'');}],
  ['mount_or_namespace_escape',()=>assert.equal(lines.RestrictNamespaces,'true')]
];
for(const [,deathCheck] of attacks)deathCheck();
console.log(`SERVICE_ISOLATION_DEATH_TESTS_OK cases=${attacks.length}`);
