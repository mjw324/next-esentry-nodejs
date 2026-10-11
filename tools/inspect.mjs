// One-shot snapshot of everything the backend keeps in Redis and Postgres.
//
//   node tools/inspect.mjs [--redis-db 0] [--db esentry] [--json] [--only redis|pg|queue]
import { Queue } from 'bullmq';
import { args, redis, pgClient, REDIS_PORT } from './lib.mjs';

const a = args();
const rdb = Number(a['redis-db'] ?? 0);
const db = a.db ?? 'esentry';
const only = a.only;
const out = {};

const r = redis(rdb);

if (!only || only === 'redis') {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await r.scan(cursor, 'COUNT', 1000);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  const byPrefix = {};
  for (const k of keys) {
    const prefix = k.startsWith('bull:') ? k.split(':').slice(0, 3).join(':').replace(/:[0-9a-f-]{8,}.*$/, ':<id>') : k.split(':').slice(0, 2).join(':');
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
  }
  const info = await r.info('memory');
  out.redis = {
    db: rdb,
    keys: keys.length,
    usedMemory: info.match(/used_memory_human:(\S+)/)?.[1],
    byPrefix: Object.fromEntries(Object.entries(byPrefix).sort((x, y) => y[1] - x[1])),
    quotaToday: await r.get('ebay:api:calls:daily'),
    ebayToken: (await r.exists('ebay:access_token')) ? `present, ttl ${await r.ttl('ebay:access_token')}s` : 'absent',
    backoff: {},
    searchCache: [],
    rateLimits: {},
  };
  for (const k of keys.filter((k) => k.startsWith('monitor:backoff:'))) out.redis.backoff[k.slice(16)] = await r.hgetall(k);
  for (const k of keys.filter((k) => k.startsWith('ebay:search:'))) out.redis.searchCache.push({ key: k, ttl: await r.ttl(k) });
  for (const k of keys.filter((k) => /rate|limit/i.test(k) && !k.startsWith('bull:'))) out.redis.rateLimits[k] = { value: await r.get(k).catch(() => '(non-string)'), ttl: await r.ttl(k) };
}

if (!only || only === 'queue') {
  const q = new Queue('monitor-queue', { connection: { host: '127.0.0.1', port: REDIS_PORT, db: rdb } });
  const schedulers = await q.getJobSchedulers(0, -1, true);
  const delayed = await q.getDelayed(0, 50);
  out.queue = {
    counts: await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused', 'prioritized'),
    schedulers: schedulers.map((s) => ({ id: s.key ?? s.id, every: s.every, offset: s.offset, next: s.next ? new Date(s.next).toISOString() : null })),
    delayed: delayed.map((j) => ({ id: j.id, monitorId: j.data?.monitorId, runsAt: new Date(j.timestamp + (j.opts.delay ?? 0)).toISOString() })),
    recentFailed: (await q.getFailed(0, 4)).map((j) => ({ id: j.id, monitorId: j.data?.monitorId, reason: j.failedReason, attempts: j.attemptsMade })),
  };
  await q.close();
}

if (!only || only === 'pg') {
  const c = await pgClient(db);
  const q = async (sql) => (await c.query(sql)).rows;
  out.pg = {
    db,
    users: await q(`SELECT id, email, "emailVerified", "maxActiveMonitors", "maxApiCallsPerHour", "maxNotificationsPerDay" FROM "User" ORDER BY "createdAt"`),
    monitors: await q(`SELECT id, "userId", status, interval, keywords, "excludedKeywords", "minPrice", "maxPrice", conditions, "lastCheckTime", "lastResultCount", "apiCallCount", "notificationCount" FROM "Monitor" ORDER BY "createdAt"`),
    alertEmails: await q(`SELECT id, "userId", email, status, "verificationAttempts" FROM "AlertEmail" ORDER BY "createdAt"`),
    sessions: (await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE "expiresAt" < now())::int AS expired FROM "Session"`))[0],
    migrations: (await q(`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at`)).map((m) => m.migration_name),
  };
  await c.end();
}

r.disconnect();

if (a.json) console.log(JSON.stringify(out, null, 2));
else console.dir(out, { depth: 6, colors: process.stdout.isTTY });
