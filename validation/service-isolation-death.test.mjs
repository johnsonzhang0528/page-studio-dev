import assert from 'node:assert/strict';
import fs from 'node:fs';

const service=fs.readFileSync(new URL('../systemd/page-autodev@.service',import.meta.url),'utf8');
const lines=Object.fromEntries(service.split(/\r?\n/).filter(line=>line.includes('=')).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
const attacks=[
  ['DT-054','write_user_config',()=>assert.ok(!lines.ReadWritePaths.split(/\s+/).includes('%h/.config'))],
  ['DT-055','read_ssh_key',()=>assert.match(lines.InaccessiblePaths,/%h\/\.ssh(?:\s|$)/)],
  ['DT-056','read_cloud_key',()=>assert.match(lines.InaccessiblePaths,/%h\/\.aws(?:\s|$)/)],
  ['DT-057','read_container_auth',()=>assert.match(lines.InaccessiblePaths,/%h\/\.docker(?:\s|$)/)],
  ['DT-058','read_kube_auth',()=>assert.match(lines.InaccessiblePaths,/%h\/\.kube(?:\s|$)/)],
  ['DT-059','inspect_host_processes',()=>{assert.equal(lines.ProtectProc,'invisible');assert.equal(lines.ProcSubset,'pid');}],
  ['DT-060','gain_privilege',()=>{assert.equal(lines.NoNewPrivileges,'true');assert.equal(lines.RestrictSUIDSGID,'true');}],
  ['DT-061','mount_or_namespace_escape',()=>assert.equal(lines.RestrictNamespaces,'true')]
];
for(const [id,name,deathCheck] of attacks){deathCheck();console.log(`DEATH_EVIDENCE ${id} ${name}`);}
console.log(`SERVICE_ISOLATION_DEATH_TESTS_OK cases=${attacks.length}`);
