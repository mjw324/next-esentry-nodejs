// Read-only: measure Redis round-trip cost patterns the app uses, and DB query timings.
const Redis = require('ioredis');
const url = process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL;
const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 15000 });
(async () => {
  await r.connect();
  const t = async (label, fn, n = 20) => { const s = Date.now(); for (let i = 0; i < n; i++) await fn(); const ms = (Date.now() - s) / n; console.log(label.padEnd(52), ms.toFixed(1) + ' ms/op'); return ms; };
  const seq = await t('4 sequential GETs (ratelimit-style)', async () => { await r.get('ebay:token_expiry'); await r.get('ebay:current_environment'); await r.ttl('ebay:token_expiry'); await r.get('ebay:api:calls:daily'); });
  const pipe = await t('same 4 in one pipeline', async () => { await r.pipeline().get('ebay:token_expiry').get('ebay:current_environment').ttl('ebay:token_expiry').get('ebay:api:calls:daily').exec(); });
  console.log('  -> pipelining saves', (seq - pipe).toFixed(1), 'ms per rate-limit check\n');
  // getJobs cost: how many keys would removePendingJobsWithRetry touch
  const p = 'bull:monitor-queue:';
  const [w, a, d] = await Promise.all([r.llen(p + 'wait'), r.llen(p + 'active'), r.zcard(p + 'delayed')]);
  console.log('getJobs([waiting,active,delayed]) would fetch', w + a + d, 'full job hashes per toggle');
  const failed = await r.zcard(p + 'failed');
  console.log('failed zset size', failed, '(each job.remove() is a multi-key DEL)');
  await r.quit();
})().catch(e => { console.error('fatal', e.message); process.exit(1); });
