// Read-only: classify the failed-job backlog in bull:monitor-queue and count orphan job hashes.
const Redis = require('ioredis');
const url = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 15000 });
const anon = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>');
(async () => {
  await r.connect();
  const p = 'bull:monitor-queue:';
  const failedIds = await r.zrange(p + 'failed', 0, -1);
  console.log('failed count', failedIds.length);
  const byReason = {}; const byMonth = {}; const byMonitor = {}; let noAttempts = 0; let totalBytes = 0;
  const pipeline = r.pipeline();
  for (const id of failedIds) pipeline.hmget(p + id, 'failedReason', 'finishedOn', 'attemptsMade', 'data', 'stacktrace');
  const res = await pipeline.exec();
  res.forEach(([err, [reason, finishedOn, attemptsMade, data, stacktrace]], i) => {
    const key = String(reason || '<empty>').split('\n').filter(Boolean).join(' ').slice(0, 90);
    byReason[key] = (byReason[key] || 0) + 1;
    const m = finishedOn ? new Date(Number(finishedOn)).toISOString().slice(0, 7) : '<none>';
    byMonth[m] = (byMonth[m] || 0) + 1;
    try { const mid = JSON.parse(data).monitorId; byMonitor[mid] = (byMonitor[mid] || 0) + 1; } catch {}
    if (!attemptsMade) noAttempts++;
    totalBytes += (stacktrace || '').length + (reason || '').length;
  });
  console.log('\n### by reason'); console.table(Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })));
  console.log('\n### by month'); console.table(Object.entries(byMonth).sort().map(([month, count]) => ({ month, count })));
  console.log('\n### by monitor'); console.table(Object.entries(byMonitor).sort((a, b) => b[1] - a[1]).map(([monitor, count]) => ({ monitor: anon(monitor), count })));
  console.log('jobs with attemptsMade unset:', noAttempts, 'approx stacktrace+reason bytes:', totalBytes);
  // Orphan job hashes: repeat:monitor:<uuid>:<millis> keys not present in failed/delayed/wait/active/completed
  let cursor = '0'; const jobKeys = [];
  do { const [c, ks] = await r.scan(cursor, 'MATCH', p + 'repeat:monitor:*:*', 'COUNT', 1000); cursor = c; jobKeys.push(...ks); } while (cursor !== '0');
  const tracked = new Set([...failedIds, ...(await r.zrange(p + 'delayed', 0, -1)), ...(await r.lrange(p + 'wait', 0, -1)), ...(await r.lrange(p + 'active', 0, -1)), ...(await r.zrange(p + 'completed', 0, -1))]);
  const orphans = jobKeys.filter(k => !tracked.has(k.slice(p.length)));
  console.log('\njob hash keys:', jobKeys.length, 'tracked in a state set:', jobKeys.length - orphans.length, 'orphan hashes:', orphans.length);
  // Check: do any failed jobs belong to monitors that are the 2 currently scheduled?
  const scheds = await r.zrange(p + 'repeat', 0, -1);
  console.log('current schedulers:', scheds.map(anon));
  const currentMonitorIds = scheds.map(s => s.replace('monitor:', ''));
  console.log('failed jobs for currently-scheduled monitors:', currentMonitorIds.map(id => `${anon(id)}=${byMonitor[id] || 0}`));
  await r.quit();
})().catch(e => { console.error('fatal', e.message); process.exit(1); });
