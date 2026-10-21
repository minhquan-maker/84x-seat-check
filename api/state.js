'use strict';
// Polled by the browser every few seconds: ?since=<rev> returns the state only when it changed.
const { readUser } = require('../lib/auth');
const { getState, touchPresence } = require('../lib/db');
const { json, wrap } = require('../lib/http');

module.exports = wrap('GET', async (req, res) => {
  const user = readUser(req);
  if (!user) return json(res, 401, { error: 'Chưa đăng nhập.' });
  const since = Number(new URL(req.url, 'http://x').searchParams.get('since'));
  const [state, online] = await Promise.all([getState(), touchPresence(user)]);
  json(res, 200, { user, online, ...(state.rev === since ? { unchanged: true } : { state }) });
});
