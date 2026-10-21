'use strict';
const { checkLogin, sessionCookie, clientIp } = require('../lib/auth');
const { tooManyAttempts, recordFailure } = require('../lib/db');
const { json, readBody, wrap } = require('../lib/http');

module.exports = wrap('POST', async (req, res) => {
  const ip = clientIp(req);
  if (await tooManyAttempts(ip)) return json(res, 429, { error: 'Thử quá nhiều lần. Vui lòng đợi 15 phút.' });
  const { username, password } = await readBody(req);
  if (!checkLogin(username, password)) {
    await recordFailure(ip);
    return json(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
  }
  const user = String(username).trim().toLowerCase();
  json(res, 200, { user }, { 'Set-Cookie': sessionCookie(req, user) });
});
