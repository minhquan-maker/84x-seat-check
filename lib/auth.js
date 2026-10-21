'use strict';
// Two env-configured accounts + a stateless signed session cookie.
const crypto = require('crypto');

const COOKIE = 'seat_session';
const TTL_MS = 30 * 24 * 3600 * 1000;

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(a, b);

function users() {
  const map = new Map();
  for (const n of [1, 2]) {
    const name = (process.env[`USER${n}_NAME`] || '').trim().toLowerCase();
    const pass = process.env[`USER${n}_PASS`] || '';
    if (name && pass) map.set(name, sha(pass));
  }
  if (!map.size) throw new Error('No users configured (USER1_NAME/USER1_PASS ...)');
  return map;
}
function secret() {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
  return process.env.SESSION_SECRET;
}
const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function checkLogin(name, password) {
  const expected = users().get(String(name || '').trim().toLowerCase());
  return !!expected && safeEq(sha(password || ''), expected);
}
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, e: Date.now() + TTL_MS })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readUser(req) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const expect = sign(payload);
  if (sig.length !== expect.length || !safeEq(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return e > Date.now() && users().has(u) ? u : null;
  } catch { return null; }
}
function cookie(req, value, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
const sessionCookie = (req, user) => cookie(req, makeToken(user), TTL_MS / 1000);
const clearCookie = req => cookie(req, '', 0);

function clientIp(req) {
  return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0].trim();
}

module.exports = { checkLogin, readUser, sessionCookie, clearCookie, clientIp };
