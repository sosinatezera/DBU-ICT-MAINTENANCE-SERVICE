/**
 * frontend/server.js
 * Static HTTP server — Smart Computer Maintenance Service Request and Tracking System
 *
 * New folder structure:
 *   views/          → HTML pages  (was pages/)
 *   assets/css/     → Stylesheets (was css/)
 *   assets/js/      → Scripts     (was js/)
 *   assets/images/  → Images
 *
 * Run:  node server.js
 * Open: http://localhost:3000
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.csv':  'text/csv',
  '.pdf':  'application/pdf',
};

/* ── URL path aliases (legacy → new) ─────────────────────── */
const REDIRECTS = {
  '/pages/':      '/views/',
  '/css/':        '/assets/css/',
  '/js/':         '/assets/js/',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url === '/' ? '/views/index.html' : req.url;

  // Strip query strings
  urlPath = urlPath.split('?')[0];

  // Apply legacy path redirects (backwards compatibility)
  for (const [from, to] of Object.entries(REDIRECTS)) {
    if (urlPath.startsWith(from)) {
      urlPath = to + urlPath.slice(from.length);
      break;
    }
  }

  const filePath = path.join(ROOT, urlPath);
  const ext      = path.extname(filePath).toLowerCase();
  const mime     = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try appending .html
      const withHtml = filePath + '.html';
      fs.readFile(withHtml, (err2, data2) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(`
            <html><body style="font-family:sans-serif;padding:2rem;background:#f8f9fa;">
              <div style="max-width:500px;margin:4rem auto;text-align:center;">
                <h2 style="color:#dc3545;">404 — Not Found</h2>
                <code style="background:#f1f3f5;padding:4px 12px;border-radius:4px;">${urlPath.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}</code>
                <br/><br/>
                <a href="/views/login.html" style="color:#2563eb;">← Back to Login</a>
              </div>
            </body></html>
          `);
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            // Root cause of "my new JS never appears in the browser": this server
            // previously sent NO Cache-Control, so browsers heuristically cached a
            // stale assets/js/*.js and never ran the updated code. Force revalidation.
            'Cache-Control': 'no-cache, must-revalidate',
          });
          res.end(data2);
        }
      });
    } else {
      const headers = { 'Content-Type': mime };
      // no-store: never let a browser reuse a stale copy of our scripts/styles/images.
      // A cached old requests.js (without the /feedback loader) leaves admin
      // pages frozen on their static "Loading requests..." placeholder; a cached
      // old home.jpg can keep showing the previous (motherboard) hero background.
      if (ext === '.js' || ext === '.css' || ext === '.html' || ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.gif' || ext === '.svg') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
      }
      res.writeHead(200, headers);
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║   Smart Computer Maintenance Service                  ║');
  console.log('  ║   Frontend Server Running                            ║');
  console.log('  ╠══════════════════════════════════════════════════════╣');
  console.log(`  ║   Local:  http://localhost:${PORT}                       ║`);
  console.log('  ╠══════════════════════════════════════════════════════╣');
  console.log('  ║   Structure:                                         ║');
  console.log('  ║   views/           → HTML pages                      ║');
  console.log('  ║   assets/css/      → Stylesheets                     ║');
  console.log('  ║   assets/js/       → Scripts                         ║');
  console.log('  ║   assets/images/   → Images                          ║');
  console.log('  ╠══════════════════════════════════════════════════════╣');
  console.log(`  ║   Login    → http://localhost:${PORT}/views/login.html   ║`);
  console.log(`  ║   Register → http://localhost:${PORT}/views/register.html║`);
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');
});
