/**
 * RSC Region Server for the flight-bun fixture.
 *
 * This is the React Server Components rendering server, responsible for
 * producing Flight protocol streams from the Server Component tree.
 * It runs with --conditions=react-server so that React resolves to the
 * server internals build (exports __SERVER_INTERNALS...).
 *
 * The region server is an internal service — the public-facing global.js
 * server fetches Flight streams from this server and SSR renders them into
 * full HTML responses. This mirrors the two-server pattern used by all
 * other flight fixtures (fixtures/flight/server/region.js, etc.).
 *
 * Port: 3002 (internal, configurable via RSC_PORT env var)
 * Runtime: Bun >= 1.1 with --conditions=react-server
 *
 * @see fixtures/flight/server/region.js (webpack reference)
 * @see fixtures/flight-esm/server/region.js (ESM reference)
 */

// RSC runtime plugin — MUST be imported before any application source modules.
// Registers a Bun onLoad plugin that intercepts 'use client' and 'use server'
// modules, replacing them with Flight reference proxies.
import './bun-rsc-register.js';

// React core — for createElement.
import * as React from 'react';

// Flight server APIs for RSC serialization and Server Action decoding.
import {
  renderToReadableStream,
  decodeReply,
  decodeAction,
  decodeFormState,
} from 'react-server-dom-bun/server.browser';

// File system — used in manifest building and file reading.
import {readFile} from 'node:fs/promises';

// Path utilities — resolve file paths for manifests.
import {resolve} from 'node:path';

// ---------------------------------------------------------------------------
// Constants and Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.RSC_PORT || '3002', 10);

// __dirname equivalent for ESM in Bun.
const __dirname = new URL('.', import.meta.url).pathname;

// Root directory of the fixture (fixtures/flight-bun/).
const rootDir = resolve(__dirname, '..');

// Build artifacts directory (fixtures/flight-bun/build/).
const buildDir = resolve(rootDir, 'build');

// ---------------------------------------------------------------------------
// Client Module Manifest Generation (Dev Mode)
// ---------------------------------------------------------------------------

// In development mode, we dynamically build the client manifest by scanning
// the fixture's src/ directory for files containing the 'use client' directive.
// For each client module, we create a manifest entry mapping the absolute
// file path to an ImportManifestEntry with an empty chunks array (in dev,
// the client loads modules directly from the server rather than bundled chunks).
//
// In production, you would use the Bun bundler plugin (plugin.js) to generate
// a static react-client-manifest.json and load it here instead.

import {readdirSync, readFileSync} from 'node:fs';

function hasClientDirective(filePath) {
  try {
    const source = readFileSync(filePath, 'utf8');
    const trimmed = source.replace(/^\ufeff/, '').trimStart();
    return (
      trimmed.startsWith("'use client'") || trimmed.startsWith('"use client"')
    );
  } catch (e) {
    return false;
  }
}

function buildClientManifest() {
  const manifest = {};
  const srcPath = resolve(rootDir, 'src');
  let files;
  try {
    files = readdirSync(srcPath);
  } catch (e) {
    return manifest;
  }
  for (const file of files) {
    if (!file.endsWith('.js')) {
      continue;
    }
    const fullPath = resolve(srcPath, file);
    if (hasClientDirective(fullPath)) {
      // Map the absolute file path to a manifest entry.
      // The Flight server uses this to serialize client references so the
      // client can resolve and load the corresponding module.
      manifest[fullPath] = {
        id: fullPath,
        chunks: [],
        name: '*',
      };
    }
  }
  return manifest;
}

const clientManifest = buildClientManifest();

// ---------------------------------------------------------------------------
// RSC Flight Rendering
// ---------------------------------------------------------------------------

/**
 * Renders the React Server Component tree into a Flight protocol ReadableStream.
 *
 * @param {*} returnValue - Return value from a Server Action invocation.
 * @param {*} formState - Form state from progressive enhancement flows.
 * @returns {ReadableStream} A web ReadableStream containing the Flight payload.
 */
async function renderApp(returnValue, formState) {
  // Dynamic import of the root Server Component.
  // The bun-rsc-register plugin intercepts 'use client' imports inside
  // this module tree and replaces them with client reference proxies.
  const m = await import('../src/App.js');
  const App = m.default;

  const root = React.createElement(App);

  // The payload includes the component tree, any Server Action return value,
  // and form state for progressive enhancement reconciliation.
  const payload = {root, returnValue, formState};

  return renderToReadableStream(payload, clientManifest);
}

// ---------------------------------------------------------------------------
// Server Action Handler
// ---------------------------------------------------------------------------

/**
 * Processes POST requests for Server Actions.
 *
 * @param {Request} req - The incoming web Request object.
 * @returns {Promise<Response>} A Response containing the re-rendered Flight stream.
 */
async function handleServerAction(req) {
  const serverReference = req.headers.get('rsc-action');

  if (serverReference) {
    // Client-side invoked Server Action.
    const [filepath, name] = serverReference.split('#');
    const action = (await import(filepath))[name];

    if (action.$$typeof !== Symbol.for('react.server.reference')) {
      throw new Error('Invalid action');
    }

    // Decode the action arguments from the request body.
    let args;
    const contentType = req.headers.get('content-type') || '';
    if (contentType.startsWith('multipart/form-data')) {
      const formData = await req.formData();
      args = await decodeReply(formData);
    } else {
      const body = await req.text();
      args = await decodeReply(body);
    }

    // Invoke the action with the decoded arguments.
    const result = action.apply(null, args);
    try {
      await result;
    } catch (x) {
      // Error handled on the client side.
    }

    // Re-render the app with the action's return value.
    const flightStream = await renderApp(result, null);
    return new Response(flightStream, {
      headers: {'Content-Type': 'text/x-component'},
    });
  } else {
    // Progressive enhancement — form submission without JavaScript.
    const formData = await req.formData();
    const action = await decodeAction(formData);
    try {
      const result = await action();
      const formState = decodeFormState(result, formData);
      const flightStream = await renderApp(null, formState);
      return new Response(flightStream, {
        headers: {'Content-Type': 'text/x-component'},
      });
    } catch (x) {
      const flightStream = await renderApp(null, null);
      return new Response(flightStream, {
        headers: {'Content-Type': 'text/x-component'},
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Main Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,

  /**
   * Region server request handler.
   *
   * Routes:
   * - GET  / → RSC Flight stream
   * - POST / → Server Actions
   */
  async fetch(req) {
    const url = new URL(req.url);

    // POST / — Server Actions
    if (req.method === 'POST' && url.pathname === '/') {
      try {
        return await handleServerAction(req);
      } catch (e) {
        console.error('Server Action error:', e);
        return new Response('Internal Server Error', {status: 500});
      }
    }

    // GET / — Flight stream
    if (url.pathname === '/') {
      try {
        const flightStream = await renderApp(null, null);
        return new Response(flightStream, {
          headers: {'Content-Type': 'text/x-component'},
        });
      } catch (e) {
        console.error('RSC Render error:', e);
        return new Response('Internal Server Error', {status: 500});
      }
    }

    return new Response('Not Found', {status: 404});
  },
});

console.log(
  `Flight Bun RSC Region Server listening on http://localhost:${server.port}...`
);
