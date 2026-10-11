// Make scheduled monitor jobs run NOW instead of waiting out their interval
// (production intervals are minutes to hours). Promotes the delayed job that
// each BullMQ job scheduler has queued; the scheduler then queues the next one
// on its normal cadence, exactly as in production.
//
//   node tools/tick.mjs [--redis-db 0] [--monitor <monitorId>]
import { Queue } from 'bullmq';
import { args, REDIS_PORT } from './lib.mjs';

const a = args();
const q = new Queue('monitor-queue', { connection: { host: '127.0.0.1', port: REDIS_PORT, db: Number(a['redis-db'] ?? 0) } });
const delayed = await q.getDelayed(0, -1);
let promoted = 0;
for (const job of delayed) {
  if (a.monitor && job.data?.monitorId !== a.monitor) continue;
  try {
    await job.promote();
    promoted++;
    console.log(`promoted ${job.id} (monitor ${job.data?.monitorId})`);
  } catch (err) {
    console.log(`skip ${job.id}: ${err.message}`);
  }
}
console.log(`${promoted} job(s) promoted of ${delayed.length} delayed`);
await q.close();
