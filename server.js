'use strict';
// B71 × VLU seating planner — tiny backend: login (2 users), shared state, live updates.
// State lives in Postgres when DATABASE_URL is set (e.g. Neon free tier), else in a local JSON file.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const DATABASE_URL = process.env.DATABASE_URL;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const COOKIE = 'seat_session';

// ---- users (from env, max 2) ------------------------------------------------
const USERS = new Map();
for (const n of [1, 2]) {
  const name = (process.env[`USER${n}_NAME`] || '').trim().toLowerCase();
  const pass = process.env[`USER${n}_PASS`] || '';
  if (name && pass) USERS.set(name, sha(pass));
}
if (USERS.size === 0) {
  console.error('No users configured. Set USER1_NAME/USER1_PASS (and USER2_NAME/USER2_PASS).');
  process.exit(1);
}
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set: using a random one, logins reset on every restart.');
}

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function safeEq(a, b) { return crypto.timingSafeEqual(a, b); }

// ---- sessions: stateless signed cookie ------------------------------------
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, e: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readUser(req) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!raw) return null;
  const token = raw.slice(COOKIE.length + 1);
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = sign(payload);
  if (sig.length !== expect.length || !safeEq(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return e > Date.now() && USERS.has(u) ? u : null;
  } catch { return null; }
}
function cookieHeader(req, value, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

// ---- login rate limit ------------------------------------------------------
const attempts = new Map();
function clientIp(req) {
  if (TRUST_PROXY) return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  return req.socket.remoteAddress;
}
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt < now) return false;
  return a.count >= 10;
}
function recordFailure(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else a.count++;
}

// ---- shared state ----------------------------------------------------------
const SEAT_RE = /^[AB](0[1-9]|1[0-5])$/;
const GUEST_RE = /^g_[0-9a-f]{10}$/;
let state = { rev: 0, assignments: {}, updatedAt: null, updatedBy: null };

// storage backends: { load(): Promise<state|null>, save(state): Promise<void> }
function fileStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return {
    name: `file ${STATE_FILE}`,
    async load() {
      try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async save(s) {
      const tmp = STATE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(s));
      fs.renameSync(tmp, STATE_FILE);
    },
  };
}
function pgStore() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3, idleTimeoutMillis: 30000 });
  pool.on('error', e => console.error('Idle database client error:', e.message)); // don't crash when the host drops idle connections
  return {
    name: 'postgres',
    async load() {
      await pool.query('CREATE TABLE IF NOT EXISTS seat_state (id int PRIMARY KEY, data jsonb NOT NULL)');
      const r = await pool.query('SELECT data FROM seat_state WHERE id = 1');
      return r.rows[0] ? r.rows[0].data : null;
    },
    async save(s) {
      await pool.query(
        'INSERT INTO seat_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
        [JSON.stringify(s)]);
    },
  };
}
const store = DATABASE_URL ? pgStore() : fileStore();

// All writes go through one queue: save first, then publish, so clients never see unsaved data.
let queue = Promise.resolve();
function mutate(user, fn) {
  const run = queue.then(async () => {
    const assignments = fn({ ...state.assignments });
    const next = { rev: state.rev + 1, assignments, updatedAt: new Date().toISOString(), updatedBy: user };
    await store.save(next);
    state = next;
    broadcast('state', state);
    return state;
  });
  queue = run.catch(() => {});
  return run;
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

// ---- live updates (SSE) -------------------------------------------------
const clients = new Set(); // { res, user }
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const c of clients) send(c.res, event, data); }
function presence() { return [...new Set([...clients].map(c => c.user))]; }
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000).unref();

// ---- http helpers -------------------------------------------------------
const NO_CACHE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };
function json(res, code, body, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...NO_CACHE, ...extra });
  res.end(JSON.stringify(body));
}
function file(res, name) {
  fs.readFile(path.join(__dirname, 'app', name), (err, buf) => {
    if (err) return json(res, 500, { error: 'Missing file' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...NO_CACHE });
    res.end(buf);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('JSON required'), { code: 415 }));
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 100 * 1024) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { reject(Object.assign(new Error('Bad JSON'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

// ---- routes ------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const method = req.method;
  try {
    if (method === 'GET' && pathname === '/healthz') return json(res, 200, { ok: true });

    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return file(res, readUser(req) ? 'index.html' : 'login.html');
    }

    if (method === 'POST' && pathname === '/api/login') {
      const ip = clientIp(req);
      if (tooManyAttempts(ip)) return json(res, 429, { error: 'Thử quá nhiều lần. Vui lòng đợi 15 phút.' });
      const { username, password } = await readBody(req);
      const name = String(username || '').trim().toLowerCase();
      const expected = USERS.get(name);
      const ok = expected && safeEq(sha(password || ''), expected);
      if (!ok) { recordFailure(ip); return json(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' }); }
      return json(res, 200, { user: name }, { 'Set-Cookie': cookieHeader(req, makeToken(name), SESSION_TTL_MS / 1000) });
    }

    if (method === 'POST' && pathname === '/api/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }

    if (!pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

    // everything below needs a session
    const user = readUser(req);
    if (!user) return json(res, 401, { error: 'Chưa đăng nhập.' });

    if (method === 'GET' && pathname === '/api/me') return json(res, 200, { user });
    if (method === 'GET' && pathname === '/api/state') return json(res, 200, { state, online: presence() });

    if (method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', ...NO_CACHE });
      const client = { res, user };
      clients.add(client);
      send(res, 'state', state);
      broadcast('presence', presence());
      req.on('close', () => { clients.delete(client); broadcast('presence', presence()); });
      return;
    }

    if (method === 'POST' && pathname === '/api/assign') {
      const { seat, guestId } = await readBody(req);
      if (!SEAT_RE.test(seat) || !GUEST_RE.test(guestId || '')) return json(res, 400, { error: 'Dữ liệu không hợp lệ.' });
      const next = await mutate(user, a => {
        for (const [s, g] of Object.entries(a)) if (g === guestId) delete a[s];
        a[seat] = guestId;
        return a;
      });
      return json(res, 200, { state: next });
    }

    if (method === 'POST' && pathname === '/api/unassign') {
      const { seat } = await readBody(req);
      if (!SEAT_RE.test(seat)) return json(res, 400, { error: 'Dữ liệu không hợp lệ.' });
      const next = await mutate(user, a => { delete a[seat]; return a; });
      return json(res, 200, { state: next });
    }

    if (method === 'POST' && pathname === '/api/replace') {
      const { assignments } = await readBody(req);
      const clean = validAssignments(assignments);
      if (!clean) return json(res, 400, { error: 'Dữ liệu không hợp lệ.' });
      return json(res, 200, { state: await mutate(user, () => clean) });
    }

    if (method === 'POST' && pathname === '/api/reset') {
      return json(res, 200, { state: await mutate(user, () => ({})) });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e.code === 400 || e.code === 413 || e.code === 415) return json(res, e.code, { error: e.message });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Không lưu được, vui lòng thử lại.' });
  }
});

(async () => {
  try {
    const saved = await store.load();
    if (saved && typeof saved.assignments === 'object') state = { ...state, ...saved };
  } catch (e) {
    console.error('Cannot load state from storage, refusing to start:', e.message);
    process.exit(1);
  }
  server.listen(PORT, () => console.log(`Seating planner on :${PORT} (users: ${[...USERS.keys()].join(', ')}, storage: ${store.name})`));
})();
