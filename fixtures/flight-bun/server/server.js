/**
 * Unified launcher for the flight-bun fixture.
 *
 * This file exists as a convenience entry point. The actual architecture uses
 * TWO separate Bun processes (matching the pattern of all other flight fixtures):
 *
 *   1. region.js — RSC rendering server (--conditions=react-server, port 3002)
 *   2. global.js — SSR + static serving (no conditions, port 3001)
 *
 * React's architecture requires these to be separate processes because:
 * - The Flight server (react-server-dom-bun/server) needs React's
 *   __SERVER_INTERNALS, which are only exported under the react-server condition.
 * - The SSR server (react-dom/server) needs React's __CLIENT_INTERNALS,
 *   which are only exported WITHOUT the react-server condition.
 *
 * Use `bun run dev` (or `bun run dev:region` + `bun run dev:global` separately)
 * instead of running this file directly.
 *
 * @see server/region.js — RSC server
 * @see server/global.js — SSR server
 * @see fixtures/flight/server/region.js — webpack reference (same pattern)
 */

console.error(
  'Error: Do not run server.js directly.\n' +
    'Use `bun run dev` to start both the RSC region server and SSR global server.\n' +
    'Alternatively, run them separately:\n' +
    '  bun run dev:region  (RSC server on port 3002)\n' +
    '  bun run dev:global  (SSR server on port 3001)\n'
);
process.exit(1);
