// Read-only Redis audit. Connection string comes from env injected by `railway run`.
const Redis = require('ioredis');
const url = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
if (!url) { console.error('no REDIS_PUBLIC_URL / REDIS_URL in env'); process.exit(1); }
const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 15000 });
const anon = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/c[a-z0-9]{24}/g, '<cuid>');
(async () => {
  await r.connect();
  const info = await r.info();
  console.log('### INFO');
  console.log(info.split('\n').filter(l => /^(redis_version|used_memory_human|maxmemory_human|maxmemory_policy|db0|connected_clients|uptime_in_days|evicted_keys|expired_keys|total_commands_processed)/.test(l)).join('\n'));
  console.log('### DBSIZE', await r.dbsize());
  let cursor = '0'; const keys = [];
  do { const [c, ks] = await r.scan(cursor, 'COUNT', 500); cursor = c; keys.push(...ks); } while (cursor !== '0');
  const groups = {};
  for (const k of keys) { const p = anon(k).replace(/:\d{10,}(?=(:|$))/g, ':<num>'); groups[p] = (groups[p] || 0) + 1; }
  console.log('\n### key patterns'); console.table(Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([pattern, count]) => ({ pattern, count })));
  console.log('\n### non-bull keys (type, ttl, value preview)');
  for (const k of keys.filter(k => !k.startsWith('bull:'))) {
    const [t, ttl] = await Promise.all([r.type(k), r.ttl(k)]);
    let extra = '';
    if (t === 'string') { const v = await r.get(k); extra = (k.includes('access_token')) ? `len=${v.length}` : `val=${String(v).slice(0, 160)}`; }
    console.log(anon(k), t, 'ttl=' + ttl, extra);
  }
  for (const q of ['monitor-queue', 'maintenance-queue', 'notification-queue']) {
    console.log(`\n### queue ${q}`);
    const p = `bull:${q}:`;
    const [wait, active, delayed, failed, completed, prioritized, repeat, meta, paused] = await Promise.all([
      r.llen(p + 'wait'), r.llen(p + 'active'), r.zcard(p + 'delayed'), r.zcard(p + 'failed'), r.zcard(p + 'completed'), r.zcard(p + 'prioritized'), r.zcard(p + 'repeat'), r.hgetall(p + 'meta'), r.llen(p + 'paused')]);
    console.log({ wait, active, delayed, failed, completed, prioritized, schedulers: repeat, paused, meta });
    const scheds = await r.zrange(p + 'repeat', 0, -1, 'WITHSCORES');
    for (let i = 0; i < scheds.length; i += 2) {
      const id = scheds[i]; const h = await r.hgetall(p + 'repeat:' + id);
      console.log('scheduler', anon(id), 'next=' + new Date(Number(scheds[i + 1])).toISOString(), 'every=' + h.every, 'name=' + anon(h.name), 'data=' + anon(h.data), 'opts=' + (h.opts || '').slice(0, 200));
    }
    const del = await r.zrange(p + 'delayed', 0, -1, 'WITHSCORES');
    for (let i = 0; i < del.length; i += 2) console.log('delayed job', anon(del[i]), 'runAt~' + new Date(Math.floor(Number(del[i + 1]) / 0x1000)).toISOString());
    const failedIds = await r.zrange(p + 'failed', 0, 9);
    for (const id of failedIds) { const h = await r.hgetall(p + id); console.log('FAILED', anon(id), 'name=' + anon(h.name), 'attempts=' + h.attemptsMade, 'finished=' + (h.finishedOn ? new Date(Number(h.finishedOn)).toISOString() : ''), 'reason=' + String(h.failedReason).slice(0, 300)); }
    const evLen = await r.xlen(p + 'events').catch(() => 'n/a'); console.log('events stream len', evLen);
    const evInfo = await r.xinfo('STREAM', p + 'events').catch(() => null);
    if (evInfo) { const m = {}; for (let i = 0; i < evInfo.length; i += 2) m[evInfo[i]] = evInfo[i + 1]; console.log('events max-deleted/length/first-entry-ts', m['length'], m['first-entry'] ? new Date(Number(String(m['first-entry'][0]).split('-')[0])).toISOString() : ''); }
  }
  // memory usage of the largest keys
  console.log('\n### largest keys (MEMORY USAGE)');
  const sizes = [];
  for (const k of keys) { const s = await r.memory('USAGE', k).catch(() => null); if (s) sizes.push([anon(k), s]); }
  console.table(sizes.sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, bytes]) => ({ key, bytes })));
  await r.quit();
})().catch(e => { console.error('fatal', e.message); process.exit(1); });
