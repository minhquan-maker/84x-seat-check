'use strict';
// All seat edits: { action: "assign" | "unassign" | "replace" | "reset", ... }
const { readUser } = require('../lib/auth');
const { SEAT_RE, GUEST_RE, mutate, validAssignments } = require('../lib/db');
const { json, readBody, wrap } = require('../lib/http');

const BAD = { error: 'Dữ liệu không hợp lệ.' };

module.exports = wrap('POST', async (req, res) => {
  const user = readUser(req);
  if (!user) return json(res, 401, { error: 'Chưa đăng nhập.' });
  const body = await readBody(req);

  switch (body.action) {
    case 'assign': {
      const { seat, guestId } = body;
      if (!SEAT_RE.test(seat) || !GUEST_RE.test(guestId || '')) return json(res, 400, BAD);
      const state = await mutate(user, a => {
        for (const [s, g] of Object.entries(a)) if (g === guestId) delete a[s];
        a[seat] = guestId;
        return a;
      });
      return json(res, 200, { state });
    }
    case 'unassign': {
      if (!SEAT_RE.test(body.seat)) return json(res, 400, BAD);
      return json(res, 200, { state: await mutate(user, a => { delete a[body.seat]; return a; }) });
    }
    case 'replace': {
      const clean = validAssignments(body.assignments);
      if (!clean) return json(res, 400, BAD);
      return json(res, 200, { state: await mutate(user, () => clean) });
    }
    case 'reset':
      return json(res, 200, { state: await mutate(user, () => ({})) });
    default:
      return json(res, 400, BAD);
  }
});
