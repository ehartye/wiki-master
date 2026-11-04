import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reapProbeDescendants } from '../scripts/lib/posix-probe-cleanup.mjs';

const row = (pid, ppid, start = 'birth') => ({ pid, ppid, start });
function world(rows) {
  const w = { rows, time: 0, open: true, signals: [], waits: 0 };
  w.options = { deadline: 100, now: () => w.time, isRootOpen: () => w.open,
    snapshot: () => structuredClone(w.rows), signal: pid => w.signals.push(pid),
    pause: async ms => { w.time += ms; w.waits++; } };
  return w;
}
test('waits for leaf reaping before its parent; unrelated sentinel is never signalled', async () => {
  const w = world([row(1,0),row(2,1),row(3,2),row(9,0)]);
  w.options.pause = async ms => {
    w.time += ms; w.waits++;
    // A killed zombie remains visible for two polls before its parent reaps it.
    if (w.waits % 2 === 0) w.rows = w.rows.filter(r => r.pid !== w.signals.at(-1));
  };
  const result = await reapProbeDescendants(1,w.options);
  assert.equal(result.outcome,'passed'); assert.deepEqual(w.signals,[3,2]); assert.equal(w.waits,4);
});
test('unreaped zombies fail within the budget instead of being called terminated', async () => {
  const w=world([row(1,0),row(2,1)]), result=await reapProbeDescendants(1,w.options);
  assert.equal(result.outcome,'unusable'); assert.match(result.reason,/disappearance/);
  assert.deepEqual(w.signals,[2]); assert.equal(w.time,100);
});
test('root closure during reaping stops delayed signals and does not claim success', async () => {
  const w=world([row(1,0),row(2,1),row(3,2)]);
  w.options.pause=async()=>{w.time++;w.open=false;};
  const result=await reapProbeDescendants(1,w.options);
  assert.equal(result.outcome,'unusable'); assert.match(result.reason,/root closed/); assert.deepEqual(w.signals,[3]);
});
test('new descendants are discovered before the ancestor is signalled', async () => {
  const w=world([row(1,0),row(2,1),row(3,2)]);
  w.options.pause=async ms=>{w.time+=ms; w.rows=w.rows.filter(r=>r.pid!==w.signals.at(-1)); if(w.signals.length===1)w.rows.push(row(4,2));};
  assert.equal((await reapProbeDescendants(1,w.options)).outcome,'passed'); assert.deepEqual(w.signals,[3,4,2]);
});
test('reused PID outside the owned ancestry is not signalled', async () => {
  const w=world([row(1,0),row(2,1)]);
  w.options.pause=async ms=>{w.time+=ms;w.rows=[row(1,0),row(2,99,'new birth')];};
  assert.equal((await reapProbeDescendants(1,w.options)).outcome,'passed'); assert.deepEqual(w.signals,[2]);
});
test('reparenting a signalled zombie is not mistaken for its disappearance', async () => {
  const w=world([row(1,0),row(2,1)]);
  w.options.pause=async ms=>{w.time+=ms;w.rows[1].ppid=99;};
  assert.equal((await reapProbeDescendants(1,w.options)).outcome,'unusable');assert.deepEqual(w.signals,[2]);
});
test('snapshot and signal errors are explicit failures', async () => {
  for(const kind of ['snapshot','signal']) {
    const w=world([row(1,0),row(2,1)]);w.options[kind]=()=>{throw Object.assign(Error(kind+' denied'),{code:'EPERM'});};
    const result=await reapProbeDescendants(1,w.options);assert.equal(result.outcome,'unusable');assert.match(result.reason,/denied/);
  }
});
test('root identity change and deadline during snapshot prevent signals', async () => {
  const w=world([row(1,0),row(2,1)]);
  w.options.pause=async ms=>{w.time+=ms;w.rows[0].start='replacement';};
  assert.equal((await reapProbeDescendants(1,w.options)).outcome,'unusable');assert.deepEqual(w.signals,[2]);
  const x=world([row(1,0),row(2,1)]);x.options.snapshot=()=>{x.time=100;return x.rows;};
  assert.equal((await reapProbeDescendants(1,x.options)).outcome,'unusable');assert.deepEqual(x.signals,[]);
});
test('snapshot rounds are bounded even when the clock does not advance', async () => {
  const w=world([row(1,0),row(2,1)]);w.options.pause=async()=>{};
  assert.equal((await reapProbeDescendants(1,w.options)).outcome,'unusable');assert.deepEqual(w.signals,[2]);
});
