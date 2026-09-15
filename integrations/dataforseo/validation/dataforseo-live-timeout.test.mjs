import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Live transport timeout exceeds observed 29-second provider task and IPC waits longer', () => {
  const tls = fs.readFileSync(new URL('../lib/dataforseo-tls-transport.mjs', import.meta.url), 'utf8');
  const ipc = fs.readFileSync(new URL('../lib/dataforseo-unix-ipc.mjs', import.meta.url), 'utf8');
  assert.match(tls, /timeout_ms=90000/);
  assert.match(ipc, /timeout_ms=100000/);
  assert.match(tls, /'Connection: close'/);
  assert.match(ipc, /socket\.destroy\(\)/);
  assert.doesNotMatch(tls, /retries: ?[1-9]/);
});
