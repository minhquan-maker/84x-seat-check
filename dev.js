'use strict';
// Local runner: serves the same handlers as Vercel. Usage: DATABASE_URL=... node dev.js
const http = require('http');
const routes = {
  '/': require('./api/page'),
  '/index.html': require('./api/page'),
  '/api/login': require('./api/login'),
  '/api/logout': require('./api/logout'),
  '/api/state': require('./api/state'),
  '/api/seats': require('./api/seats'),
};
const port = Number(process.env.PORT) || 3000;
http.createServer((req, res) => {
  const handler = routes[new URL(req.url, 'http://x').pathname];
  if (!handler) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"Not found"}'); }
  handler(req, res);
}).listen(port, () => console.log(`http://localhost:${port}`));
