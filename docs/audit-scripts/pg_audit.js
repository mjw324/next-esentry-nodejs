// Read-only Postgres audit. Connection string comes from env injected by `railway run`.
const { Client } = require('pg');
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!url) { console.error('no DATABASE_PUBLIC_URL / DATABASE_URL in env'); process.exit(1); }
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const Q = {
  pg_version: `SELECT version()`,
  users: `SELECT count(*)::int AS total, count(*) FILTER (WHERE "emailVerified")::int AS verified, count(*) FILTER (WHERE "lastLoggedIn" IS NULL)::int AS never_logged_in, count(*) FILTER (WHERE "lastLoggedIn" < now() - interval '3 days')::int AS inactive_3d, count(*) FILTER (WHERE password IS NOT NULL)::int AS with_password FROM "User"`,
  monitors_by_status: `SELECT status, count(*)::int FROM "Monitor" GROUP BY status`,
  monitors: `SELECT left(id,8) AS id, left("userId",8) AS uid, status, interval, keywords, "excludedKeywords", conditions, sellers, "minPrice", "maxPrice", "nextCheckAt", "lastCheckTime", "lastResultCount", "apiCallCount", "notificationCount", "createdAt", "updatedAt" FROM "Monitor" ORDER BY "updatedAt" DESC LIMIT 40`,
  conditions: `SELECT c AS cond, count(*)::int FROM "Monitor", unnest(conditions) c GROUP BY c`,
  intervals: `SELECT interval, count(*)::int FROM "Monitor" GROUP BY interval ORDER BY interval`,
  keywords_with_commas: `SELECT left(id,8) id, status, keywords FROM "Monitor" WHERE EXISTS (SELECT 1 FROM unnest(keywords) k WHERE k LIKE '%,%' OR k <> btrim(k) OR k = '')`,
  alert_by_status: `SELECT status, count(*)::int FROM "AlertEmail" GROUP BY status`,
  alert_anomalies: `SELECT left("userId",8) AS uid, count(*) FILTER (WHERE status='active')::int AS active_count, count(*)::int AS total FROM "AlertEmail" GROUP BY "userId" HAVING count(*) FILTER (WHERE status='active') <> 1`,
  alert_stale_pending: `SELECT count(*)::int AS pending_expired FROM "AlertEmail" WHERE status='pending verification' AND "verificationExpires" < now()`,
  alert_same_email_multiple_users: `SELECT email, count(DISTINCT "userId")::int users FROM "AlertEmail" GROUP BY email HAVING count(DISTINCT "userId") > 1`,
  users_without_own_email_alert: `SELECT count(*)::int AS n FROM "User" u WHERE u."emailVerified" AND NOT EXISTS (SELECT 1 FROM "AlertEmail" a WHERE a."userId"=u.id AND a.email=u.email)`,
  verification: `SELECT count(*)::int AS total, count(*) FILTER (WHERE "expiresAt" < now())::int AS expired FROM "Verification"`,
  sessions: `SELECT count(*)::int AS total, count(*) FILTER (WHERE "expiresAt" < now())::int AS expired FROM "Session"`,
  accounts: `SELECT "providerId", count(*)::int FROM "Account" GROUP BY "providerId"`,
  limits: `SELECT "maxActiveMonitors","maxApiCallsPerHour","maxNotificationsPerDay", count(*)::int FROM "User" GROUP BY 1,2,3`,
  active_vs_login: `SELECT left(m.id,8) id, m.status, m.interval, m."lastCheckTime", m."apiCallCount", m."notificationCount", u."lastLoggedIn", u."emailVerified" FROM "Monitor" m JOIN "User" u ON u.id=m."userId" WHERE m.status='active' ORDER BY m."lastCheckTime" NULLS FIRST`,
  users_over_limit: `SELECT left(u.id,8) uid, u."maxActiveMonitors", count(m.*)::int active FROM "User" u JOIN "Monitor" m ON m."userId"=u.id AND m.status='active' GROUP BY u.id HAVING count(m.*) > u."maxActiveMonitors"`,
  tables: `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`,
  migrations: `SELECT migration_name, finished_at, applied_steps_count, rolled_back_at FROM _prisma_migrations ORDER BY finished_at`,
  table_sizes: `SELECT relname, n_live_tup, n_dead_tup, pg_size_pretty(pg_total_relation_size(relid)) size FROM pg_stat_user_tables ORDER BY n_live_tup DESC`,
  indexes: `SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2`,
  connections: `SELECT count(*)::int AS conns, count(*) FILTER (WHERE state='idle')::int idle, max(now()-backend_start) oldest FROM pg_stat_activity WHERE datname = current_database()`,
  db_size: `SELECT pg_size_pretty(pg_database_size(current_database())) size`,
};
(async () => {
  await c.connect();
  for (const [k, q] of Object.entries(Q)) {
    try { const r = await c.query(q); console.log(`\n### ${k} (${r.rowCount} rows)`); console.table(r.rows); }
    catch (e) { console.log(`\n### ${k} ERROR: ${e.message}`); }
  }
  await c.end();
})().catch(e => { console.error('fatal', e.message); process.exit(1); });
