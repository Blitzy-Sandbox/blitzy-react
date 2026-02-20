# react-server-dom-bun

React Flight (Server Components) bindings for DOM environments using the [Bun](https://bun.sh) runtime and bundler.

**This package is experimental. Use it at your own risk.**

## Overview

`react-server-dom-bun` implements the React Flight protocol for the Bun ecosystem. It enables React Server Components (RSC) — including server rendering, streaming, client hydration, and Server Actions — with Bun-specific bundler integration.

The package provides three surfaces:
- **Server** — Serializes React Server Component trees into Flight protocol streams.
- **Client** — Deserializes Flight streams into renderable React elements on the client.
- **Static** — Pre-renders Flight payloads for static site generation.

Each surface has three runtime targets: **browser**, **node**, and **edge**.

## Requirements

- **Bun** >= 1.1 (for `Bun.serve()`, `Bun.build()` plugin API, `Bun.hash()`)
- **React** >= 19.3.0 (peer dependency)
- **React DOM** >= 19.3.0 (peer dependency)

## Installation

```bash
bun add react-server-dom-bun react react-dom
```

## Quick Start

### Server (Region Server with RSC)

```js
// server.js — run with: bun run --conditions=react-server server.js
import {renderToReadableStream} from 'react-server-dom-bun/server.browser';
import App from './src/App.js'; // Server Component

Bun.serve({
  port: 3001,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/rsc') {
      // Render Server Component tree to a Flight stream
      const stream = renderToReadableStream(<App />, clientManifest);
      return new Response(stream, {
        headers: {'Content-Type': 'text/x-component'},
      });
    }

    return new Response('Not Found', {status: 404});
  },
});
```

### Client (Browser)

```js
// index.js — client-side entry point
import {createFromFetch} from 'react-server-dom-bun/client.browser';
import {createRoot} from 'react-dom/client';

const root = createRoot(document.getElementById('root'));

// Consume the Flight stream from the server
const data = createFromFetch(fetch('/rsc'));
root.render(data);
```

### Static Pre-rendering

```js
// prerender.js — static Flight payload generation
import {prerender} from 'react-server-dom-bun/static.browser';

const {prelude} = await prerender(<App />, clientManifest);
// prelude is a ReadableStream containing the static Flight payload
```

## API Reference

### Server Exports

Import from `react-server-dom-bun/server.browser`, `server.node`, or `server.edge`:

| Export | Description |
|--------|-------------|
| `renderToReadableStream(model, manifest, options?)` | Renders a Server Component tree into a `ReadableStream` of Flight data. Available on all targets. |
| `renderToPipeableStream(model, manifest, options?)` | Renders to a Node.js pipeable stream. **Node target only.** |
| `decodeReply(body, manifest)` | Decodes a Flight reply (from `encodeReply`) back into values. |
| `decodeReplyFromBusboy(busboyStream, manifest)` | Decodes a multipart reply from a Busboy stream. **Node target only.** |
| `decodeReplyFromAsyncIterable(iterable, manifest)` | Decodes a reply from an `AsyncIterable`. Available on node and edge. |
| `decodeAction(body, manifest)` | Decodes a Server Action invocation from a form submission. |
| `decodeFormState(actionResult, body, manifest)` | Decodes form state for progressive enhancement with `useActionState`. |
| `registerServerReference(ref, id, exportName)` | Registers a function as a Server Reference for Server Actions. |
| `registerClientReference(ref, id, exportName)` | Registers a module as a Client Reference for `'use client'` boundaries. |
| `createClientModuleProxy(moduleId)` | Creates a Proxy that lazily resolves client module exports. |
| `createTemporaryReferenceSet()` | Creates a set for tracking temporary references during serialization. |

### Client Exports

Import from `react-server-dom-bun/client.browser`, `client.node`, or `client.edge`:

| Export | Description |
|--------|-------------|
| `createFromReadableStream(stream, options?)` | Creates a React element tree from a `ReadableStream` of Flight data. |
| `createFromFetch(fetchPromise, options?)` | Creates a React element tree from a `fetch()` Response promise. |
| `encodeReply(value)` | Encodes a value for transmission back to the server (e.g., Server Action arguments). |

### Static Exports

Import from `react-server-dom-bun/static.browser`, `static.node`, or `static.edge`:

| Export | Description |
|--------|-------------|
| `prerender(model, manifest, options?)` | Pre-renders a Server Component tree. Returns `{prelude: ReadableStream}`. |
| `prerenderToNodeStream(model, manifest, options?)` | Pre-renders to Node.js streams. **Node target only.** Returns `{prelude: Readable}`. |

### Bundler Plugin

```js
// bun.build() plugin for RSC directive detection
import {bunReactServerComponentsPlugin} from 'react-server-dom-bun/plugin';

await Bun.build({
  entrypoints: ['./src/index.js'],
  plugins: [bunReactServerComponentsPlugin()],
});
```

The plugin intercepts `'use client'` and `'use server'` directives during bundling, generates client component manifests, and tracks server references.

## Conditional Exports

The `package.json` `"exports"` map automatically resolves the correct entry point based on your runtime environment:

| Condition | Server | Client | Static |
|-----------|--------|--------|--------|
| `workerd` / `edge-light` | `server.edge.js` | `client.edge.js` | `static.edge.js` |
| `deno` / `worker` / `browser` | `server.browser.js` | `client.browser.js` | `static.browser.js` |
| `node` | `server.node.js` | `client.node.js` | `static.node.js` |
| `react-server` | Uses server internals | — | Uses server internals |

## Architecture

This package acts as the Bun-specific adapter between:
- The **bundler-agnostic Flight protocol** (provided by `react-server` and `react-client` internal packages)
- The **Bun runtime/bundler environment** (module loading, chunk resolution, stream handling)

The Flight protocol wire format is immutable — this package only provides bundler configuration, module resolution, and stream transport. All serialization and deserialization logic comes from the shared React packages.

### Key Bundler Config Files

- `src/server/ReactFlightServerConfigBunBundler.js` — Defines how the server resolves client module references, server reference IDs, and bound arguments for the Bun module system.
- `src/client/ReactFlightClientConfigBundlerBun.js` — Defines how the client resolves module references back to actual modules using Bun's require/import system.
- `src/client/ReactFlightClientConfigBundlerBunBrowser.js` — Browser-specific chunk loading via dynamic `import()`.
- `src/client/ReactFlightClientConfigBundlerBunServer.js` — Server-side chunk loading via `__bun_require__`.

## Development

### Running Tests

```bash
# From React monorepo root
node ./scripts/jest/jest-cli.js --ci packages/react-server-dom-bun

# With coverage
NODE_ENV=development node ./scripts/jest/jest-cli.js --ci packages/react-server-dom-bun --coverage
```

### Flow Type Checking

```bash
# Check all three host configurations
node ./scripts/tasks/flow.js dom-browser-bun
node ./scripts/tasks/flow.js dom-node-bun
node ./scripts/tasks/flow.js dom-edge-bun
```

### Building

```bash
# Build only react-server-dom-bun bundles
RELEASE_CHANNEL=experimental node ./scripts/rollup/build.js react-server-dom-bun/ --type=BUN_DEV,BUN_PROD

# Full experimental build (required for fixture app)
yarn build --r=experimental
```

### Fixture App

A full-stack demo application is available in `fixtures/flight-bun/`:

```bash
# 1. Build experimental React (from monorepo root)
yarn build --r=experimental

# 2. Install fixture dependencies
cd fixtures/flight-bun
bun install

# 3. Copy build artifacts
bash scripts/predev.sh

# 4. Start dev server (port 3001)
bun run dev
```

## License

MIT
