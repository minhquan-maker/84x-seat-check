'use strict';
// Postgres access (Supabase). One row holds the whole seat plan; writes are serialized with a row lock.
const { Pool } = require('pg');

const SEAT_RE = /^[AB](0[1-9]|1[0-5])$/;
const GUEST_RE = /^g_[0-9a-f]{10}$/;
const EMPTY = { rev: 0, assignments: {}, updatedAt: null, updatedBy: null };

// Supabase's pooler uses a CA that Node doesn't trust by default ("self-signed certificate in
// certificate chain"). Traffic is still TLS-encrypted without verification.
function pgConfig(url) {
  const u = new URL(url);
  if (/supabase\.(com|co)$/.test(u.hostname)) {
    u.searchParams.delete('sslmode');
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
  }
  return { connectionString: url };
}

// Reused across invocations of a warm serverless instance.
const g = globalThis;
function pool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!g.__seatPool) {
    g.__seatPool = new Pool({ ...pgConfig(process.env.DATABASE_URL), max: 1, idleTimeoutMillis: 10000 });
    g.__seatPool.on('error', e => console.error('Idle database client error:', e.message));
  }
  return g.__seatPool;
}
async function ready() {
  if (!g.__seatReady) {
    g.__seatReady = pool().query(`
      CREATE TABLE IF NOT EXISTS seat_state (id int PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS seat_presence (username text PRIMARY KEY, seen_at timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS login_attempts (ip text PRIMARY KEY, count int NOT NULL, reset_at timestamptz NOT NULL);
    `).catch(e => { g.__seatReady = null; throw e; });
  }
  return g.__seatReady;
}

async function getState() {
  await ready();
  const r = await pool().query('SELECT data FROM seat_state WHERE id = 1');
  return r.rows[0] ? r.rows[0].data : EMPTY;
}

// Apply fn(assignments) -> new assignments atomically; returns the new state.
async function mutate(user, fn) {
  await ready();
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO seat_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(EMPTY)]);
    const cur = (await c.query('SELECT data FROM seat_state WHERE id = 1 FOR UPDATE')).rows[0].data;
    const next = {
      rev: cur.rev + 1,
      assignments: fn({ ...cur.assignments }),
      updatedAt: new Date().toISOString(),
      updatedBy: user,
    };
    await c.query('UPDATE seat_state SET data = $1 WHERE id = 1', [JSON.stringify(next)]);
    await c.query('COMMIT');
    return next;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Who has polled in the last 10 seconds (includes the caller).
async function touchPresence(user) {
  await ready();
  await pool().query(
    `INSERT INTO seat_presence (username, seen_at) VALUES ($1, now())
     ON CONFLICT (username) DO UPDATE SET seen_at = now()`, [user]);
  const r = await pool().query("SELECT username FROM seat_presence WHERE seen_at > now() - interval '10 seconds' ORDER BY username");
  return r.rows.map(x => x.username);
}

async function tooManyAttempts(ip) {
  await ready();
  const r = await pool().query('SELECT count FROM login_attempts WHERE ip = $1 AND reset_at > now()', [ip]);
  return !!r.rows[0] && r.rows[0].count >= 10;
}
async function recordFailure(ip) {
  await ready();
  await pool().query(
    `INSERT INTO login_attempts (ip, count, reset_at) VALUES ($1, 1, now() + interval '15 minutes')
     ON CONFLICT (ip) DO UPDATE SET
       count = CASE WHEN login_attempts.reset_at < now() THEN 1 ELSE login_attempts.count + 1 END,
       reset_at = CASE WHEN login_attempts.reset_at < now() THEN now() + interval '15 minutes' ELSE login_attempts.reset_at END`,
    [ip]);
}

function validAssignments(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const clean = {}, used = new Set();
  for (const [seat, gid] of Object.entries(obj)) {
    if (!SEAT_RE.test(seat) || typeof gid !== 'string' || !GUEST_RE.test(gid) || used.has(gid)) return null;
    clean[seat] = gid;
    used.add(gid);
  }
  return clean;
}

module.exports = { SEAT_RE, GUEST_RE, getState, mutate, touchPresence, tooManyAttempts, recordFailure, validAssignments, pgConfig };
