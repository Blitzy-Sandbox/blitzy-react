/**
 * Global Server for the flight-bun fixture.
 *
 * This is the public-facing server that handles:
 * 1. HTML shell serving — serves the index.html and bootstrap scripts.
 * 2. Static asset serving — serves build artifacts and public files.
 * 3. Flight stream proxying — forwards RSC requests to the region server.
 * 4. Server Action proxying — forwards POST requests to the region server.
 *
 * This server runs WITHOUT --conditions=react-server so that it can serve
 * static files and proxy requests. The actual RSC rendering is handled by
 * the separate region.js server.
 *
 * The client-side JavaScript (src/index.js) calls createFromFetch() to
 * consume the Flight stream from the region server and renders the React
 * tree on the client. This demonstrates the complete Flight protocol
 * round-trip: server rendering → Flight stream → client consumption.
 *
 * Port: 3001 (public, configurable via PORT env var)
 * Depends on: region.js running on RSC_PORT (default 3002)
 * Runtime: Bun >= 1.1
 *
 * @see fixtures/flight/server/global.js (webpack reference)
 * @see fixtures/flight-esm/server/global.js (ESM reference)
 */

// Path utilities — resolve file paths for static serving.
import {join, resolve, extname} from 'node:path';

// ---------------------------------------------------------------------------
// Constants and Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3001', 10);
const RSC_PORT = parseInt(process.env.RSC_PORT || '3002', 10);
const RSC_URL = `http://localhost:${RSC_PORT}`;

// __dirname equivalent for ESM in Bun.
const __dirname = new URL('.', import.meta.url).pathname;

// Root directory of the fixture (fixtures/flight-bun/).
const rootDir = resolve(__dirname, '..');

// Public assets directory (fixtures/flight-bun/public/).
const publicDir = resolve(rootDir, 'public');

// Build artifacts directory (fixtures/flight-bun/build/).
const buildDir = resolve(rootDir, 'build');

// Source directory (fixtures/flight-bun/src/).
const srcDir = resolve(rootDir, 'src');

// MIME type map for static file serving.
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Static File Serving
// ---------------------------------------------------------------------------

/**
 * Serves a static file using Bun's native Bun.file() API.
 *
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<Response|null>} Response with file content, or null if not found.
 */
async function serveStaticFile(filePath) {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      return null;
    }
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return new Response(file, {
      headers: {'Content-Type': contentType},
    });
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Region Server Communication
// ---------------------------------------------------------------------------

/**
 * Fetches a Flight stream from the region server (RSC rendering).
 *
 * @returns {Promise<Response>} The region server's Response containing
 *   the Flight stream.
 */
async function fetchFlightStream() {
  const response = await fetch(RSC_URL + '/', {
    headers: {
      Accept: 'text/x-component',
    },
  });
  if (!response.ok) {
    throw new Error(
      `Region server returned ${response.status}: ${await response.text()}`
    );
  }
  return response;
}

/**
 * Forwards a Server Action POST request to the region server.
 *
 * @param {Request} req - The original POST request from the client.
 * @returns {Promise<Response>} The region server's Response containing
 *   the re-rendered Flight stream.
 */
async function forwardServerAction(req) {
  // Build headers to forward to region server.
  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }
  const rscAction = req.headers.get('rsc-action');
  if (rscAction) {
    headers.set('rsc-action', rscAction);
  }

  const response = await fetch(RSC_URL + '/', {
    method: 'POST',
    headers,
    body: req.body,
    // Ensure request body is streamed, not buffered.
    duplex: 'half',
  });

  if (!response.ok) {
    throw new Error(
      `Region server returned ${response.status}: ${await response.text()}`
    );
  }
  return response;
}

// ---------------------------------------------------------------------------
// Client Module Serving (Dev Mode)
// ---------------------------------------------------------------------------

/**
 * Serves source modules from the fixture's src/ directory for client-side
 * import resolution. In development mode, client components are imported
 * by their absolute file paths (serialized in the Flight stream), so the
 * browser needs to be able to fetch them.
 *
 * @param {string} absolutePath - The absolute file path of the module.
 * @returns {Promise<Response|null>} Response with the module source, or null.
 */
async function serveSourceModule(absolutePath) {
  // Security check: only serve files under the fixture's src/ directory.
  if (!absolutePath.startsWith(srcDir)) {
    return null;
  }
  return serveStaticFile(absolutePath);
}

// ---------------------------------------------------------------------------
// Main Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,

  /**
   * Global server request handler.
   *
   * Routes:
   * - POST /          → Forward Server Actions to region server
   * - GET  /rsc       → Flight stream (proxied from region server)
   * - GET  /todos     → Mock JSON data endpoint
   * - GET  /public/*  → Static assets from public/ directory
   * - GET  /static/*  → Client build artifacts from build/ directory
   * - GET  /src/*     → Source modules for dev-mode client imports
   * - GET  /          → HTML shell from public/index.html
   * - *               → 404 Not Found
   */
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // -----------------------------------------------------------------------
    // POST / — Server Actions (forward to region server)
    // -----------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/') {
      try {
        const regionResponse = await forwardServerAction(req);
        return new Response(regionResponse.body, {
          headers: {'Content-Type': 'text/x-component'},
        });
      } catch (e) {
        console.error('Server Action error:', e);
        return new Response('Internal Server Error', {status: 500});
      }
    }

    // -----------------------------------------------------------------------
    // GET /rsc — Flight stream for client-side RSC consumption
    // -----------------------------------------------------------------------
    if (pathname === '/rsc') {
      try {
        const regionResponse = await fetchFlightStream();
        return new Response(regionResponse.body, {
          headers: {
            'Content-Type': 'text/x-component',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (e) {
        console.error('RSC fetch error:', e);
        return new Response('Internal Server Error', {status: 500});
      }
    }

    // -----------------------------------------------------------------------
    // GET /todos — Mock data endpoint
    // -----------------------------------------------------------------------
    if (pathname === '/todos') {
      return Response.json([
        {id: 1, text: 'Shave yaks'},
        {id: 2, text: 'Eat kale'},
      ]);
    }

    // -----------------------------------------------------------------------
    // Static assets from public/ directory
    // -----------------------------------------------------------------------
    if (pathname.startsWith('/public/') || pathname === '/favicon.ico') {
      const filePath =
        pathname === '/favicon.ico'
          ? join(publicDir, 'favicon.ico')
          : join(publicDir, pathname.slice('/public/'.length));
      const response = await serveStaticFile(filePath);
      if (response) {
        return response;
      }
    }

    // -----------------------------------------------------------------------
    // Client build artifacts from build/ directory
    // -----------------------------------------------------------------------
    if (pathname.startsWith('/static/')) {
      const filePath = join(buildDir, pathname.slice('/static/'.length));
      const response = await serveStaticFile(filePath);
      if (response) {
        return response;
      }
    }

    // -----------------------------------------------------------------------
    // Source module serving for dev-mode client imports
    // Client components in the Flight stream are referenced by absolute paths.
    // The client bootstrap (src/index.js) resolves them via /src/ URL prefix.
    // -----------------------------------------------------------------------
    if (pathname.startsWith('/src/')) {
      const filePath = join(srcDir, pathname.slice('/src/'.length));
      const response = await serveStaticFile(filePath);
      if (response) {
        return response;
      }
    }

    // -----------------------------------------------------------------------
    // Main page — serve the HTML shell
    // -----------------------------------------------------------------------
    if (pathname === '/' || pathname === '/index.html') {
      const htmlPath = join(publicDir, 'index.html');
      const response = await serveStaticFile(htmlPath);
      if (response) {
        return response;
      }
      // Fallback: generate a minimal HTML shell if index.html doesn't exist.
      return new Response(
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flight on Bun</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/static/client.js"></script>
</body>
</html>`,
        {headers: {'Content-Type': 'text/html'}}
      );
    }

    // -----------------------------------------------------------------------
    // 404 — Not Found
    // -----------------------------------------------------------------------
    return new Response('Not Found', {status: 404});
  },
});

console.log(
  `Flight Bun Global Server listening on http://localhost:${server.port}...`
);
