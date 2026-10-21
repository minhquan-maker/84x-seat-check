'use strict';
// Small helpers shared by the API functions (plain Node req/res, works on Vercel and in dev.js).
const SECURITY = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

function json(res, code, body, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY, ...extra });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('JSON required'), { status: 415 });
  }
  if (req.body !== undefined) {           // Vercel pre-parses JSON bodies
    if (req.body && typeof req.body === 'object') return req.body;
    try { return JSON.parse(req.body || '{}'); } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
  }
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 100 * 1024) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
}

// wrap(method, fn): method check + uniform error handling
function wrap(method, fn) {
  return async (req, res) => {
    try {
      if (req.method !== method) return json(res, 405, { error: 'Method not allowed' }, { Allow: method });
      await fn(req, res);
    } catch (e) {
      if (e.status) return json(res, e.status, { error: e.message });
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Lỗi máy chủ, vui lòng thử lại.' });
    }
  };
}

module.exports = { json, readBody, wrap };
