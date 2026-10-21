'use strict';
const { clearCookie } = require('../lib/auth');
const { json, wrap } = require('../lib/http');

module.exports = wrap('POST', async (req, res) => {
  json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
});
