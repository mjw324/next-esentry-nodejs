// Shared config for harness tools. Everything points at local services only.
import { Redis } from 'ioredis';
import pg from 'pg';

// Prisma stores DateTime as `timestamp(3)` (no zone) holding UTC. node-pg would
// otherwise parse it as local time and shift every value by the UTC offset.
pg.types.setTypeParser(1114, (v) => new Date(v.replace(' ', 'T') + 'Z'));

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export const FAKES = process.env.HARNESS_FAKES_URL ?? 'http://127.0.0.1:4010';
export const PG_HOST = '127.0.0.1';
export const PG_PORT = 55432;
export const REDIS_PORT = 56379;

export function redisUrl(db = 0) {
  return `redis://127.0.0.1:${REDIS_PORT}/${db}`;
}
export function databaseUrl(db = 'esentry') {
  return `postgresql://harness:harness@${PG_HOST}:${PG_PORT}/${db}`;
}

export function redis(db = 0) {
  return new Redis({ host: '127.0.0.1', port: REDIS_PORT, db: Number(db), maxRetriesPerRequest: 2, lazyConnect: false });
}

export async function pgClient(db = 'esentry') {
  const c = new pg.Client({ connectionString: databaseUrl(db) });
  await c.connect();
  return c;
}

export async function fakes(path, init = {}) {
  const res = await fetch(`${FAKES}/__control${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.body && typeof init.body !== 'string' ? JSON.stringify(init.body) : init.body,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll fn until it returns truthy or the timeout elapses. */
export async function waitFor(fn, { timeoutMs = 30000, everyMs = 500, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await sleep(everyMs);
  }
}
