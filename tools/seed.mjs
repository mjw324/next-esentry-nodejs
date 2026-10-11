// Insert a verified test user (and optionally an active alert email) straight
// into Postgres, for API-level testing with the `user-id` header. For the
// browser flow, sign up through the frontend instead; the verification email
// lands in the fakes inbox.
//
//   node tools/seed.mjs [--db esentry] [--email tester@harness.test] [--no-alert-email]
import { randomBytes } from 'node:crypto';
import { args, pgClient } from './lib.mjs';

const a = args();
const email = a.email ?? `tester+${Date.now()}@harness.test`;
const id = 'c' + randomBytes(12).toString('hex').slice(0, 24); // cuid-shaped
const c = await pgClient(a.db ?? 'esentry');
const existing = await c.query(`SELECT id FROM "User" WHERE email = $1`, [email]);
const userId = existing.rows[0]?.id ?? id;
if (!existing.rows.length) {
  await c.query(
    `INSERT INTO "User" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())`,
    [userId, 'Harness Tester', email]
  );
}
if (!a['no-alert-email']) {
  await c.query(
    `INSERT INTO "AlertEmail" (id, email, status, "userId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'active', $2, now(), now())
     ON CONFLICT ("userId", email) DO UPDATE SET status = 'active'`,
    [email, userId]
  );
}
await c.end();
console.log(JSON.stringify({ userId, email }));
