/**
 * frontend/server.js
 * Static HTTP server — Smart ICT Maintenance Management System
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

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
};

/* ── URL path aliases (legacy → new) ─────────────────────── */
const REDIRECTS = {
  "/pages/": "/views/",
  "/css/": "/assets/css/",
  "/js/": "/assets/js/",
};

const server = http.createServer((req, res) => {
  let urlPath = req.url === "/" ? "/views/index.html" : req.url;

  // Strip query strings
  urlPath = urlPath.split("?")[0];
  let invalidPath = false;
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch {
    invalidPath = true;
  }

  // Apply legacy path redirects (backwards compatibility)
  for (const [from, to] of Object.entries(REDIRECTS)) {
    if (urlPath.startsWith(from)) {
      urlPath = to + urlPath.slice(from.length);
      break;
    }
  }

  const filePath = path.resolve(ROOT, `.${urlPath}`);
  const outsideRoot =
    filePath !== ROOT && !filePath.startsWith(ROOT + path.sep);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  const send404 = () => {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(`
      <html><body style="font-family:sans-serif;padding:2rem;background:#f8f9fa;">
        <div style="max-width:500px;margin:4rem auto;text-align:center;">
          <h2 style="color:#dc3545;">404 — Not Found</h2>
          <code style="background:#f1f3f5;padding:4px 12px;border-radius:4px;">${urlPath.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</code>
          <br/><br/>
          <a href="/views/login.html" style="color:#2563eb;">← Back to Login</a>
        </div>
      </body></html>
    `);
  };

  if (invalidPath || outsideRoot) return send404();

  const sendFile = (servePath, stat) => {
    const contentType = MIME[path.extname(servePath).toLowerCase()] || mime;
    const compressible =
      /^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/.test(
        contentType,
      );
    const acceptsGzip = (req.headers["accept-encoding"] || "")
      .split(",")
      .some((encoding) => {
        const [name, ...params] = encoding.trim().toLowerCase().split(";");
        const quality = params.find((param) => param.trim().startsWith("q="));
        return (
          name === "gzip" && (!quality || Number(quality.trim().slice(2)) > 0)
        );
      });
    const headers = {
      "Content-Type": contentType,
      // "no-cache, must-revalidate": the browser must ALWAYS ask the server,
      // so an updated JS/CSS/image/html is still picked up on every load —
      // the same anti-stale guarantee as the old "no-store" policy — but
      // unchanged files now return HTTP 304 (an empty body) instead of
      // re-downloading the full bytes on every page view.
      "Cache-Control": "no-cache, must-revalidate",
    };
    if (compressible) headers.Vary = "Accept-Encoding";
    if (compressible && acceptsGzip) headers["Content-Encoding"] = "gzip";

    // Conditional request: only send the body when the file actually changed.
    if (stat) {
      headers["Last-Modified"] = stat.mtime.toUTCString();
      const since = Date.parse(req.headers["if-modified-since"] || "");
      if (
        !Number.isNaN(since) &&
        Math.floor(stat.mtimeMs / 1000) <= Math.floor(since / 1000)
      ) {
        res.writeHead(304, headers);
        return res.end();
      }
    }

    res.writeHead(200, headers);
    const source = fs.createReadStream(servePath);
    source.on("error", (err) => res.destroy(err));
    if (headers["Content-Encoding"] === "gzip") {
      source
        .pipe(zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }))
        .pipe(res);
    } else {
      source.pipe(res);
    }
  };

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat || stat.isDirectory()) {
      // Try appending .html
      const withHtml = filePath + ".html";
      fs.stat(withHtml, (statErr2, stat2) => {
        if (statErr2 || !stat2 || stat2.isDirectory()) return send404();
        sendFile(withHtml, stat2);
      });
      return;
    }
    sendFile(filePath, stat);
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║   Smart ICT Maintenance Management System            ║");
  console.log("  ║   Frontend Server Running                            ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log(`  ║   Local:  http://localhost:${PORT}                       ║`);
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log("  ║   Structure:                                         ║");
  console.log("  ║   views/           → HTML pages                      ║");
  console.log("  ║   assets/css/      → Stylesheets                     ║");
  console.log("  ║   assets/js/       → Scripts                         ║");
  console.log("  ║   assets/images/   → Images                          ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log(`  ║   Login    → http://localhost:${PORT}/views/login.html   ║`);
  console.log(`  ║   Register → http://localhost:${PORT}/views/register.html║`);
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log("");
});
