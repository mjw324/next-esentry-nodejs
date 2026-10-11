// End-to-end smoke scenario against a running backend + fakes:
//   health -> seed user -> create + activate monitor -> first run (snapshot)
//   -> new listing appears on "eBay" -> second run -> notification email
//   -> delete monitor -> scheduler gone.
//
//   node tools/smoke.mjs [--api http://localhost:3000] [--redis-db 0] [--db esentry]
import { Queue } from 'bullmq';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { args, fakes, redis, pgClient, waitFor, REDIS_PORT } from './lib.mjs';

const a = args();
const API = a.api ?? 'http://localhost:3000';
const rdb = Number(a['redis-db'] ?? 0);
const db = a.db ?? 'esentry';
const here = (f) => fileURLToPath(new URL(f, import.meta.url));

let failures = 0;
async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS  ${name}  (${Date.now() - t}ms)${detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    return detail;
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}  (${Date.now() - t}ms)  ${err.message}`);
    if (a.bail !== 'false') { await done(); }
  }
}

const r = redis(rdb);
const q = new Queue('monitor-queue', { connection: { host: '127.0.0.1', port: REDIS_PORT, db: rdb } });
async function done() {
  r.disconnect();
  await q.close();
  console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed');
  process.exit(failures ? 1 : 0);
}

async function api(method, path, userId, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(userId ? { 'user-id': userId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const tick = (monitorId) => execFileSync(process.execPath, [here('./tick.mjs'), '--redis-db', String(rdb), '--monitor', monitorId], { encoding: 'utf8' });
const searchCalls = async (since, needle) => (await fakes(`/ebay/calls?since=${since}`)).filter((c) => c.kind === 'browse.search' && (c.query.q ?? '').toLowerCase().includes(needle));

await step('backend /health', async () => {
  const res = await api('GET', '/health');
  if (res.status !== 200) throw new Error(`status ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
});

await step('fakes reset', async () => (await fakes('/reset', { method: 'POST' })).ok || Promise.reject(new Error('fakes not reachable')));

const user = await step('seed verified user + active alert email', async () =>
  JSON.parse(execFileSync(process.execPath, [here('./seed.mjs'), '--db', db], { encoding: 'utf8' }).trim().split('\n').at(-1)));

await step('unauthenticated request rejected', async () => {
  const res = await api('GET', '/api/monitors');
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
});

const KEYWORDS = ['nintendo', 'switch', 'oled'];
let monitor = await step('create monitor', async () => {
  const res = await api('POST', '/api/monitors', user.userId, { keywords: KEYWORDS, interval: 300000 });
  if (res.status >= 300) throw new Error(`status ${res.status}: ${JSON.stringify(res.body)}`);
  const m = res.body.monitor ?? res.body;
  if (!m.id) throw new Error(`no id in ${JSON.stringify(res.body)}`);
  return m;
});

if (monitor.status !== 'active') {
  monitor = await step('activate monitor', async () => {
    const res = await api('PATCH', `/api/monitors/${monitor.id}/toggle`, user.userId, { active: true });
    if (res.status >= 300) throw new Error(`status ${res.status}: ${JSON.stringify(res.body)}`);
    return { ...monitor, ...(res.body.monitor ?? res.body) };
  });
}

await step('job scheduler registered', async () =>
  waitFor(async () => {
    const s = await q.getJobSchedulers(0, -1, true);
    return s.find((x) => JSON.stringify(x).includes(monitor.id)) && `${s.length} scheduler(s)`;
  }, { timeoutMs: 10000, label: 'scheduler' }));

let t0 = Date.now();
await step('first run hits fake eBay (tick)', async () => {
  tick(monitor.id);
  const calls = await waitFor(() => searchCalls(t0, 'nintendo').then((c) => c.length && c), { timeoutMs: 20000, label: 'browse call' });
  return { q: calls[0].query.q, filter: calls[0].query.filter, returned: calls[0].returned };
});

await step('snapshot cached for monitor', async () =>
  waitFor(async () => {
    const keys = await r.keys(`*${monitor.id}*`);
    return keys.length && keys.join(',');
  }, { timeoutMs: 10000, label: 'snapshot key' }));

const title = `Nintendo Switch OLED Console HARNESS-${Date.now()}`;
await step('new listing appears on fake eBay', async () => {
  const [item] = await fakes('/ebay/items', { method: 'POST', body: { title, price: '249.00', conditionId: '1000' } });
  return item.itemId;
});

await step('second run (search cache cleared to simulate time passing)', async () => {
  const cached = await r.keys('ebay:search:*');
  if (cached.length) await r.del(...cached);
  t0 = Date.now();
  // The worker may still be finishing the previous job; retry the promote.
  await waitFor(async () => {
    tick(monitor.id);
    return (await searchCalls(t0, 'nintendo')).length > 0;
  }, { timeoutMs: 30000, everyMs: 2000, label: 'second browse call' });
  return `cleared ${cached.length} search cache key(s)`;
});

await step('notification email delivered to fake SES', async () => {
  const email = await waitFor(async () => {
    const list = await fakes(`/emails?to=${encodeURIComponent(user.email)}&since=${t0}`);
    return list.find((e) => (e.html ?? e.text ?? '').includes('HARNESS-'));
  }, { timeoutMs: 20000, label: 'notification email' });
  return { subject: email.subject, to: email.to };
});

await step('monitor counters updated in Postgres', async () => {
  const c = await pgClient(db);
  const { rows } = await c.query(`SELECT "apiCallCount", "notificationCount", "lastCheckTime", "lastResultCount" FROM "Monitor" WHERE id = $1`, [monitor.id]);
  await c.end();
  return rows[0];
});

await step('delete monitor removes scheduler', async () => {
  const res = await api('DELETE', `/api/monitors/${monitor.id}`, user.userId);
  if (res.status >= 300) throw new Error(`status ${res.status}: ${JSON.stringify(res.body)}`);
  await waitFor(async () => !(await q.getJobSchedulers(0, -1, true)).some((x) => JSON.stringify(x).includes(monitor.id)), { timeoutMs: 10000, label: 'scheduler removal' });
});

await step('no blocked egress during run', async () => {
  const blocked = await fakes('/egress');
  if (blocked.length) throw new Error(JSON.stringify(blocked));
});

await done();
