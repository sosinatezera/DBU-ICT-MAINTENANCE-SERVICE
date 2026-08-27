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

const PORT = 3000;
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
                <a href="/views/login.html" style="color:#0d6efd;">← Back to Login</a>
              </div>
            </body></html>
          `);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data2);
        }
      });
    } else {
      res.writeHead(200, { 'Content-Type': mime });
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
