'use strict';
const fs = require('fs');
const path = require('path');
const { readUser } = require('../lib/auth');
const { wrap } = require('../lib/http');

// "/" -> planner when logged in, login page otherwise (the guest list is never sent before login).
module.exports = wrap('GET', async (req, res) => {
  const name = readUser(req) ? 'index.html' : 'login.html';
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', name));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  });
  res.end(html);
});
