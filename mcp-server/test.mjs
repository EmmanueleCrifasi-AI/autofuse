// MCP server tests — exercises the server over stdio, the same way a client
// (or a registry like Glama) does: initialize + tools/list, then asserts the
// tool catalog and its behavior annotations. No host/engine dependency.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

function introspect(messages, ms = 2500) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', ['dist/index.js']);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    const timer = setTimeout(() => {
      p.kill();
      resolve(out);
    }, ms);
    p.on('exit', () => {
      clearTimeout(timer);
      resolve(out);
    });
    for (const m of messages) p.stdin.write(JSON.stringify(m) + '\n');
  });
}

const out = await introspect([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
]);

const msgs = out
  .split('\n')
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

const init = msgs.find((m) => m.id === 1);
const list = msgs.find((m) => m.id === 2);

assert.ok(init?.result, 'initialize returns a result');

const tools = list?.result?.tools ?? [];
assert.ok(tools.length >= 30, `tools/list returns the catalog (got ${tools.length})`);

const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

// Every tool must carry behavior annotations (clients gate prompts on these).
assert.ok(tools.every((t) => t.annotations && typeof t.annotations === 'object'), 'every tool has annotations');

// Read-only tools must be marked read-only.
for (const n of ['get_config', 'get_all_mount_status', 'list_workstations', 'diagnose']) {
  assert.equal(byName[n]?.annotations.readOnlyHint, true, `${n} is readOnlyHint`);
}

// Destructive tools must be marked destructive and NOT read-only.
for (const n of ['unmount_disk', 'run_local_shell', 'run_remote_shell', 'panic_unmount_all']) {
  assert.equal(byName[n]?.annotations.destructiveHint, true, `${n} is destructiveHint`);
  assert.notEqual(byName[n]?.annotations.readOnlyHint, true, `${n} is not read-only`);
}

// Local-only reads don't reach beyond this machine.
assert.equal(byName['list_workstations']?.annotations.openWorldHint, false, 'list_workstations is local-only');

// Core tools are present.
for (const n of ['quick_connect', 'mount_disk', 'wake_and_wait', 'heal_stale_mount']) {
  assert.ok(byName[n], `${n} is exposed`);
}

console.log(`✓ MCP server tests passed — ${tools.length} tools, annotations verified`);
