# Technical Specification

# 0. Agent Action Plan

## 0.1 Intent Clarification


### 0.1.1 Core Feature Objective

Based on the prompt, the Blitzy platform understands that the new feature requirement is to build a production-quality **`react-server-dom-bun`** package and a full-stack **`fixtures/flight-bun/`** demo application that enables React Server Components on the Bun runtime with full Flight protocol support — server serialization, client deserialization, streaming, and Server Actions.

The feature requirements, with enhanced clarity, are:

- **New Package `packages/react-server-dom-bun/`**: Create a bundler-specific React Flight integration for Bun that mirrors the structure, exports, Flow annotations, and naming conventions of the primary reference implementation `react-server-dom-turbopack` (mid-complexity, ~5K LOC, 55 files). This package acts as the Bun-specific adapter between the bundler-agnostic Flight protocol (provided by `react-server` and `react-client` shared packages) and the Bun runtime/bundler environment.
- **Server Exports Surface**: Implement `renderToPipeableStream`, `renderToReadableStream`, `decodeReply`, `decodeReplyFromBusboy`, `decodeReplyFromAsyncIterable`, `decodeAction`, `decodeFormState`, `registerServerReference`, `registerClientReference`, `createClientModuleProxy`, and `createTemporaryReferenceSet` — all routing through the shared Flight server implementation with Bun-specific bundler configuration.
- **Client Exports Surface**: Implement `createFromReadableStream`, `createFromFetch`, `encodeReply`, and client/server reference helpers — consuming the shared Flight client implementation with Bun-specific module resolution.
- **Static Exports Surface**: Implement `prerender` and `prerenderToNodeStream` for static Flight payload generation.
- **Bundler Config Interface**: Implement `ReactFlightServerConfigBunBundler.js` defining `ClientManifest`, `ServerReferenceId`, `ClientReferenceMetadata` types, and resolution functions (`resolveClientReferenceMetadata`, `getClientReferenceKey`, `getServerReferenceId`, `getServerReferenceBoundArguments`, `getServerReferenceLocation`) — mirroring the turbopack bundler config pattern.
- **Bun Plugin**: Provide a Bun bundler plugin leveraging the `Bun.build()` plugin API (onResolve/onLoad hooks, esbuild-compatible pattern) for `'use client'` and `'use server'` directive detection, client component manifest generation, and server reference tracking.
- **Shared Config Forks**: Create new fork files in `packages/react-server/src/forks/` and `packages/react-client/src/forks/` for `dom-bun-*` host configurations, replacing the current Fizz-only `dom-bun` stubs with Flight-enabled variants.
- **Root Entry Shims**: Generate ~10-line proxy files (client.js, server.js, static.js × node/browser/edge variants, plus guard files) matching the turbopack pattern exactly.
- **New Fixture `fixtures/flight-bun/`**: Create a full-stack demo application demonstrating RSC on Bun with Bun HTTP server (`Bun.serve()`), Flight streaming responses, Server Components (async data fetching, nested layouts, Suspense boundaries), Client Components (counter with state, form with controlled inputs, transition-based navigation), Server Actions (form mutation handler, optimistic UI update), in-memory mock data, Playwright E2E test suite, and `bun run dev` entry point on port 3001.
- **Build System Integration**: Register new bundle entries in `scripts/rollup/bundles.js`, add workspace entry in root `package.json`, configure Jest for package tests, and update `scripts/shared/inlinedHostConfigs.js` with new `dom-browser-bun`, `dom-node-bun`, and `dom-edge-bun` host configurations.

Implicit requirements detected:

- The existing `dom-bun` inlinedHostConfig entry (currently Fizz-only) must be updated or supplemented with Flight-enabled `dom-browser-bun`, `dom-node-bun`, and `dom-edge-bun` configurations pointing to the new `react-server-dom-bun` entry points.
- The existing null-stub fork file `packages/react-client/src/forks/ReactFlightClientConfig.dom-bun.js` needs to be replaced with working implementations that reference `react-server-dom-bun` client bundler config.
- The existing `packages/react-server/src/forks/ReactFlightServerConfig.dom-bun.js` that currently imports from `ReactFlightServerConfigBundlerCustom` must be replaced with variants pointing to `ReactFlightServerConfigBunBundler`.
- `npm/` adapter directory must be created for CJS distribution bundles with NODE_ENV-based development/production resolution.
- The `findNearestExistingForkFile` function in `scripts/rollup/forks.js` will automatically resolve fork files by progressively shortening the hyphenated segments of the host config shortName (e.g., `dom-browser-bun` → `dom-browser` → `dom` → fallback), so fork files must be named to match at the correct resolution level.
- All code MUST use Flow type annotations (never TypeScript) consistent with React core packages, targeting Flow `^0.279.0`.

Feature dependencies and prerequisites:

- The shared Flight protocol implementation in `packages/react-server/` and `packages/react-client/` is already complete and bundler-agnostic
- The Bun-specific stream config `ReactServerStreamConfigBun.js` (136 lines) already provides the streaming primitives (`BunReadableStreamController`, `Bun.hash()`, `Buffer.byteLength`)
- `BUN_DEV`/`BUN_PROD` bundle types already exist in `scripts/rollup/bundles.js` (used for Fizz)
- Bun runtime >= 1.1 is required for the bundler plugin API and `Bun.serve()` capabilities
- Playwright `^1.56.1` (already in monorepo devDependencies) is needed for fixture E2E tests

### 0.1.2 Special Instructions and Constraints

**Preservation Boundaries (MUST NOT modify):**
- Source files in: `packages/react-reconciler/`, `packages/react-dom/`, `packages/react/`, `packages/scheduler/`, `packages/react-server/src/` (non-fork files), `packages/react-client/src/` (non-fork files), or any existing `react-server-dom-*` package
- Existing fixture apps in `fixtures/`
- Anything in `/compiler/`
- MUST NOT add new feature flags to `shared/ReactFeatureFlags.js`

**Allowed modifications to existing files (exhaustive list):**
- `scripts/rollup/bundles.js` — new bundle entries for react-server-dom-bun
- `packages/react-server/src/forks/` — new/updated fork files for dom-*-bun configurations
- `packages/react-client/src/forks/` — new/updated fork files for dom-*-bun configurations
- `package.json` (root) — new workspace entry
- `scripts/shared/inlinedHostConfigs.js` — new host config entries for dom-browser-bun, dom-node-bun, dom-edge-bun

**Architectural requirements:**
- The Flight protocol wire format is immutable — the new package consumes the shared implementation, it NEVER reimplements serialization/deserialization logic
- All code MUST use Flow type annotations (NEVER TypeScript) consistent with React core packages
- All file naming conventions, export patterns, entry shim structure, test organization, and Flow annotation style MUST match the `react-server-dom-turbopack` reference

**Validation gates:**

| Gate | Command | Pass Criteria |
|------|---------|---------------|
| Type checking | `yarn flow` | Zero errors |
| Lint + format | `yarn linc` | Zero violations |
| Package tests | `yarn jest packages/react-server-dom-bun` | All pass, 85%+ coverage |
| Build | `yarn build --r=experimental` | Zero errors, Bun bundles emitted |
| Fixture starts | `cd fixtures/flight-bun && bun install && bun run dev` | HTTP 200 on localhost:3001 |
| E2E tests | `cd fixtures/flight-bun && bun run test:e2e` | All Playwright tests pass |
| Regression | `yarn jest packages/react-server-dom-webpack packages/react-server-dom-turbopack packages/react-server-dom-parcel` | Zero failures vs baseline |

### 0.1.3 Technical Interpretation

These feature requirements translate to the following technical implementation strategy:

- To **implement the Bun-specific Flight server adapter**, we will create `packages/react-server-dom-bun/src/server/ReactFlightServerConfigBunBundler.js` defining the bundler interface types and resolution functions, then create `ReactFlightDOMServerBrowser.js`, `ReactFlightDOMServerEdge.js`, and `ReactFlightDOMServerNode.js` that delegate to `react-server/src/ReactFlightServer` with Bun-specific configuration — matching turbopack's server implementation structure exactly.
- To **implement the Bun-specific Flight client adapter**, we will create `packages/react-server-dom-bun/src/client/ReactFlightClientConfigBundlerBun.js` defining module resolution types (`SSRModuleMap`, `ServerManifest`, `ClientReference`, `ServerReferenceId`), `ReactFlightClientConfigBundlerBunBrowser.js` and `ReactFlightClientConfigBundlerBunServer.js` for target-specific loading, and `ReactFlightDOMClientBrowser.js`, `ReactFlightDOMClientEdge.js`, `ReactFlightDOMClientNode.js` for the three runtime targets.
- To **wire the build system**, we will add 6 bundle entries to `scripts/rollup/bundles.js` (server.browser, server.node, server.edge, client.browser, client.node, client.edge) following the turbopack pattern, add 3 new host config entries to `scripts/shared/inlinedHostConfigs.js` (dom-browser-bun, dom-node-bun, dom-edge-bun), and create new fork files that `findNearestExistingForkFile` will resolve.
- To **implement the Bun bundler plugin**, we will create `packages/react-server-dom-bun/plugin.js` exposing a Bun plugin using the `Bun.build()` plugin API with `onResolve`/`onLoad` hooks for `'use client'`/`'use server'` directive detection, client component manifest generation, and server reference annotation.
- To **build the fixture app**, we will create `fixtures/flight-bun/` with a `Bun.serve()`-based HTTP server that uses `renderToReadableStream` for RSC Flight streaming, a `predev` script that copies build artifacts from `../../build/oss-experimental/`, client-side hydration via `createFromFetch`, and a Playwright E2E test suite covering initial render, hydration, interactivity, Server Actions, and Suspense streaming.
- To **ensure zero regressions**, we will verify all existing tests in `react-server-dom-webpack`, `react-server-dom-turbopack`, `react-server-dom-parcel`, and `react-server-dom-esm` continue to pass by running them before and after integration.


## 0.2 Repository Scope Discovery


### 0.2.1 Comprehensive File Analysis

**Primary Reference Implementation — `packages/react-server-dom-turbopack/` (55 files):**

The turbopack package provides the complete structural template. Every file, naming convention, export, and pattern in the new `react-server-dom-bun` package mirrors this reference:

| Category | Turbopack Files | Purpose |
|----------|----------------|---------|
| Root entry shims | `client.browser.js`, `client.edge.js`, `client.node.js`, `server.browser.js`, `server.edge.js`, `server.node.js`, `static.browser.js`, `static.edge.js`, `static.node.js` | Thin re-export wrappers delegating to `src/` implementations |
| Guard files | `index.js`, `server.js`, `static.js`, `client.js` | Throw instructional error messages guiding correct import paths |
| Package config | `package.json` | Conditional exports map (workerd/deno/worker/node/edge-light/browser/react-server), peer dependencies, files list |
| npm adapters | `npm/client.browser.js`, `npm/client.edge.js`, `npm/client.node.js`, `npm/client.js`, `npm/server.browser.js`, `npm/server.edge.js`, `npm/server.node.js`, `npm/server.js`, `npm/static.browser.js`, `npm/static.edge.js`, `npm/static.node.js`, `npm/static.js`, `npm/index.js` | CJS adapters with NODE_ENV-based dev/prod bundle selection |
| Server src | `src/server/ReactFlightDOMServerBrowser.js`, `src/server/ReactFlightDOMServerEdge.js`, `src/server/ReactFlightDOMServerNode.js`, `src/server/ReactFlightServerConfigTurbopackBundler.js`, `src/server/react-flight-dom-server.browser.js`, `src/server/react-flight-dom-server.edge.js`, `src/server/react-flight-dom-server.node.js` | Server-side Flight serialization with bundler-specific config |
| Client src | `src/client/ReactFlightClientConfigBundlerTurbopack.js`, `src/client/ReactFlightClientConfigBundlerTurbopackBrowser.js`, `src/client/ReactFlightClientConfigBundlerTurbopackServer.js`, `src/client/ReactFlightClientConfigTargetTurbopackBrowser.js`, `src/client/ReactFlightClientConfigTargetTurbopackServer.js`, `src/client/ReactFlightDOMClientBrowser.js`, `src/client/ReactFlightDOMClientEdge.js`, `src/client/ReactFlightDOMClientNode.js`, `src/client/react-flight-dom-client.browser.js`, `src/client/react-flight-dom-client.edge.js`, `src/client/react-flight-dom-client.node.js` | Client-side Flight deserialization with bundler-specific module loading |
| Shared | `src/shared/ReactFlightImportMetadata.js` | Import metadata types and tuple accessors |
| References | `src/ReactFlightTurbopackReferences.js` | Client/Server reference types with $$typeof symbols |
| Tests | `src/__tests__/ReactFlightTurbopackDOM-test.js`, `src/__tests__/ReactFlightTurbopackDOMBrowser-test.js`, `src/__tests__/ReactFlightTurbopackDOMEdge-test.js`, `src/__tests__/ReactFlightTurbopackDOMNode-test.js`, `src/__tests__/ReactFlightTurbopackDOMReply-test.js`, `src/__tests__/ReactFlightTurbopackDOMReplyEdge-test.js`, `src/__tests__/utils/TurbopackMock.js` | Per-platform unit/integration tests with mock bundler |

**Existing Bun Infrastructure (Fizz-only, to be extended):**

| File Path | Current State | Required Action |
|-----------|--------------|-----------------|
| `packages/react-server/src/ReactServerStreamConfigBun.js` | Complete 136-line Bun stream implementation with `BunReadableStreamController`, `Bun.hash()`, `Buffer.byteLength` | No modification (shared infrastructure, consumed as-is) |
| `packages/react-server/src/forks/ReactFlightServerConfig.dom-bun.js` | Imports from `ReactFlightServerConfigBundlerCustom` (generic), no specific bundler | Will be superseded by new `dom-browser-bun`, `dom-node-bun`, `dom-edge-bun` fork variants |
| `packages/react-server/src/forks/ReactServerStreamConfig.dom-bun.js` | Re-exports from `ReactServerStreamConfigBun` | No modification needed |
| `packages/react-client/src/forks/ReactFlightClientConfig.dom-bun.js` | Contains null stubs for all bundler functions (`resolveClientReference: null`, etc.), sets `rendererPackageName = 'react-server-dom-bun'` | Will be superseded by new `dom-browser-bun`, `dom-node-bun`, `dom-edge-bun` client fork variants |
| `packages/react-dom/src/server/react-dom-server.bun.js` | Fizz server for Bun | No modification (out of scope) |

**Build System Files to Modify:**

| File Path | LOC | Required Changes |
|-----------|-----|-----------------|
| `scripts/rollup/bundles.js` | 1359 | Add 6 new bundle entries (server.browser/node/edge, client.browser/node/edge) using BUN_DEV/BUN_PROD types |
| `scripts/shared/inlinedHostConfigs.js` | ~550 | Add 3 new host config entries: `dom-browser-bun`, `dom-node-bun`, `dom-edge-bun` with entryPoints and paths |
| `package.json` (root) | ~150 | No explicit modification needed — `packages/*` glob already covers new package |

**Shared Fork Files to Create:**

| File Path | Purpose |
|-----------|---------|
| `packages/react-server/src/forks/ReactFlightServerConfig.dom-browser-bun.js` | Server flight config for browser target — references `ReactFlightServerConfigBunBundler`, no AsyncLocalStorage |
| `packages/react-server/src/forks/ReactFlightServerConfig.dom-node-bun.js` | Server flight config for Node target — references `ReactFlightServerConfigBunBundler`, with AsyncLocalStorage |
| `packages/react-server/src/forks/ReactFlightServerConfig.dom-edge-bun.js` | Server flight config for edge target — references `ReactFlightServerConfigBunBundler`, no AsyncLocalStorage |
| `packages/react-client/src/forks/ReactFlightClientConfig.dom-browser-bun.js` | Client flight config for browser — references `ReactFlightClientConfigBundlerBun` + browser target |
| `packages/react-client/src/forks/ReactFlightClientConfig.dom-node-bun.js` | Client flight config for Node — references `ReactFlightClientConfigBundlerBun` + server target |
| `packages/react-client/src/forks/ReactFlightClientConfig.dom-edge-bun.js` | Client flight config for edge — references `ReactFlightClientConfigBundlerBun` + server target |

**Integration Point Discovery:**

- **Build system entry**: `scripts/rollup/bundles.js` — new bundle definitions with `moduleType: RENDERER`, `condition: 'react-server'` for server bundles, `externals: ['async_hooks', 'crypto', 'stream', 'util']` for node variant
- **Host config resolution**: `scripts/shared/inlinedHostConfigs.js` — 3 new entries mapping entry points to paths arrays
- **Fork resolution**: `scripts/rollup/forks.js` — `findNearestExistingForkFile` will automatically resolve new fork files by progressively shortening segment names (no modification needed to forks.js itself)
- **Flow type checking**: `.flowconfig` — no modification needed, `packages/*` glob covers new package
- **Jest test runner**: `scripts/jest/` — Jest config resolves via `inlinedHostConfigs.js`, new entries enable test running

### 0.2.2 Web Search Research Conducted

- **Bun Bundler Plugin API**: Bun provides a unified plugin API (`onResolve`/`onLoad` hooks) compatible with esbuild patterns. Plugins use `build.onResolve({ filter: /regex/ }, callback)` and `build.onLoad({ filter: /regex/ }, callback)` for module resolution and transformation. The API works identically for runtime and bundler plugins.
- **Bun.serve() HTTP Server**: Bun's HTTP server uses `Bun.serve({ fetch(req) { ... } })` with native `ReadableStream` support for streaming responses. The `fetch` handler returns standard `Response` objects. Route-based handling and streaming are natively supported.
- **Bun Server Components Status**: Bun's bundler has experimental RSC support via `--server-components` flag. Bun's plugin API enables `'use client'`/`'use server'` directive detection through import rewriting. The `bun-plugin-server-components` plugin exists as an official reference. Bun's manifest generation from `BunBuild` provides client/server import resolution.
- **Bun Runtime Version**: Bun >= 1.1 provides the necessary APIs (bundler plugin API, `Bun.serve()`, `Bun.build()`, `Bun.hash()`, `ReadableStream`). Bun 1.3 (October 2025) adds full-stack dev server with built-in routing and HTML imports.

### 0.2.3 New File Requirements

**New source files to create — `packages/react-server-dom-bun/`:**

- `package.json` — Package manifest with conditional exports, peerDependencies (react, react-dom ^19.3.0), dependencies (acorn-loose, neo-async)
- `index.js` — Guard file: throws "Use react-server-dom-bun/client instead"
- `client.js` — Guard file: throws about --conditions react-server requirement
- `server.js` — Guard file: throws about --conditions react-server requirement
- `static.js` — Guard file: throws about --conditions react-server requirement
- `client.browser.js` — Re-export from `./src/client/react-flight-dom-client.browser`
- `client.edge.js` — Re-export from `./src/client/react-flight-dom-client.edge`
- `client.node.js` — Re-export from `./src/client/react-flight-dom-client.node`
- `server.browser.js` — Named re-exports of server APIs from `./src/server/react-flight-dom-server.browser`
- `server.edge.js` — Named re-exports of server APIs from `./src/server/react-flight-dom-server.edge`
- `server.node.js` — Named re-exports of server APIs from `./src/server/react-flight-dom-server.node`
- `static.browser.js` — Named re-exports of prerender APIs from `./src/server/react-flight-dom-server.browser`
- `static.edge.js` — Named re-exports of prerender APIs from `./src/server/react-flight-dom-server.edge`
- `static.node.js` — Named re-exports of prerender APIs from `./src/server/react-flight-dom-server.node`
- `plugin.js` — Bun bundler plugin for RSC directive detection
- `src/ReactFlightBunReferences.js` — Client/Server reference types with $$typeof symbols
- `src/shared/ReactFlightImportMetadata.js` — Import metadata types and tuple accessors
- `src/server/ReactFlightServerConfigBunBundler.js` — Bundler-specific server config
- `src/server/ReactFlightDOMServerBrowser.js` — Server impl for browser target
- `src/server/ReactFlightDOMServerEdge.js` — Server impl for edge target
- `src/server/ReactFlightDOMServerNode.js` — Server impl for node target
- `src/server/react-flight-dom-server.browser.js` — Barrel re-export
- `src/server/react-flight-dom-server.edge.js` — Barrel re-export
- `src/server/react-flight-dom-server.node.js` — Barrel re-export
- `src/client/ReactFlightClientConfigBundlerBun.js` — Bundler-specific client config
- `src/client/ReactFlightClientConfigBundlerBunBrowser.js` — Browser-specific module loading
- `src/client/ReactFlightClientConfigBundlerBunServer.js` — Server/edge-specific module loading
- `src/client/ReactFlightClientConfigTargetBunBrowser.js` — Browser target config
- `src/client/ReactFlightClientConfigTargetBunServer.js` — Server/edge target config
- `src/client/ReactFlightDOMClientBrowser.js` — Client impl for browser target
- `src/client/ReactFlightDOMClientEdge.js` — Client impl for edge target
- `src/client/ReactFlightDOMClientNode.js` — Client impl for node target
- `src/client/react-flight-dom-client.browser.js` — Barrel re-export
- `src/client/react-flight-dom-client.edge.js` — Barrel re-export
- `src/client/react-flight-dom-client.node.js` — Barrel re-export
- `npm/index.js` — CJS guard adapter
- `npm/client.js` — CJS guard adapter
- `npm/client.browser.js` — CJS adapter with NODE_ENV resolution
- `npm/client.edge.js` — CJS adapter with NODE_ENV resolution
- `npm/client.node.js` — CJS adapter with NODE_ENV resolution
- `npm/server.js` — CJS guard adapter
- `npm/server.browser.js` — CJS adapter with NODE_ENV resolution
- `npm/server.edge.js` — CJS adapter with NODE_ENV resolution
- `npm/server.node.js` — CJS adapter with NODE_ENV resolution
- `npm/static.js` — CJS guard adapter
- `npm/static.browser.js` — CJS adapter with NODE_ENV resolution
- `npm/static.edge.js` — CJS adapter with NODE_ENV resolution
- `npm/static.node.js` — CJS adapter with NODE_ENV resolution

**New test files:**

- `src/__tests__/ReactFlightBunDOM-test.js` — Core DOM integration tests
- `src/__tests__/ReactFlightBunDOMBrowser-test.js` — Browser-specific flight tests
- `src/__tests__/ReactFlightBunDOMEdge-test.js` — Edge runtime flight tests
- `src/__tests__/ReactFlightBunDOMNode-test.js` — Node runtime flight tests
- `src/__tests__/ReactFlightBunDOMReply-test.js` — Server Action reply serialization tests
- `src/__tests__/ReactFlightBunDOMReplyEdge-test.js` — Edge reply tests
- `src/__tests__/utils/BunMock.js` — Mock bundler infrastructure for tests

**New fixture files — `fixtures/flight-bun/`:**

- `package.json` — Fixture dependencies (react, react-dom, react-server-dom-bun, playwright)
- `server/server.js` — Bun HTTP server with Flight streaming
- `src/App.js` — Root Server Component with async data fetching and nested layouts
- `src/Counter.js` — Client Component with useState
- `src/Form.js` — Client Component with controlled inputs and Server Action
- `src/Navigation.js` — Client Component with transition-based navigation
- `src/Layout.js` — Nested layout Server Component
- `src/data.js` — In-memory mock data store
- `src/actions.js` — Server Action handlers
- `public/index.html` — HTML shell with bootstrap script reference
- `scripts/build.js` — Bun build script using `Bun.build()` with RSC plugin
- `scripts/predev.sh` — Copy build artifacts from `../../build/oss-experimental/`
- `playwright.config.js` — Playwright configuration for E2E tests
- `__tests__/__e2e__/smoke.test.js` — Playwright E2E smoke tests covering initial render, hydration, interactivity, Server Actions, Suspense streaming


## 0.3 Dependency Inventory


### 0.3.1 Private and Public Packages

The following table catalogs all packages relevant to the `react-server-dom-bun` feature addition, sourced from direct repository inspection of dependency manifests and the user's specification:

| Registry | Package Name | Version | Purpose |
|----------|-------------|---------|---------|
| npm (internal) | `react` | 19.3.0 | Core React library — peerDependency of the new package |
| npm (internal) | `react-dom` | 19.3.0 | React DOM bindings — peerDependency of the new package |
| npm (internal) | `react-server` | 19.3.0 | Shared bundler-agnostic Flight server implementation (not published separately) |
| npm (internal) | `react-client` | 19.3.0 | Shared bundler-agnostic Flight client implementation (not published separately) |
| npm (internal) | `react-dom-bindings` | 19.3.0 | DOM-specific Flight server/client config (ReactFlightServerConfigDOM, ReactFlightClientConfigDOM) |
| npm (internal) | `shared` | 19.3.0 | Shared utilities (ReactTypes, ReactVersion, hasOwnProperty, ReactFeatureFlags) |
| npm (public) | `acorn-loose` | (match turbopack) | Loose JavaScript parser for server reference parsing |
| npm (public) | `neo-async` | (match turbopack) | Async utilities — dependency mirroring turbopack pattern |
| npm (public) | `flow-bin` | ^0.279.0 | Flow type checker — monorepo devDependency |
| npm (public) | `jest` | ^29.4.2 | Test runner — monorepo devDependency |
| npm (public) | `rollup` | ^3.29.5 | Build system — monorepo devDependency |
| npm (public) | `playwright` | ^1.56.1 | E2E testing framework — fixture devDependency |
| Runtime | `bun` | >= 1.1 | JavaScript runtime with built-in bundler — required for fixture and plugin |

All versions are sourced from direct inspection of `packages/react-server-dom-turbopack/package.json` (version 19.3.0, dependencies: acorn-loose, neo-async) and the root `package.json` (devDependencies: flow-bin ^0.279.0, jest ^29.4.2, rollup ^3.29.5).

### 0.3.2 Dependency Updates

**Import Updates:**

Files requiring new internal imports for the `react-server-dom-bun` package (new files, not modifications to existing packages):

- `packages/react-server-dom-bun/src/server/**/*.js` — Import from `react-server/src/ReactFlightServer`, `react-dom-bindings/src/server/ReactFlightServerConfigDOM`, `react-dom-bindings/src/server/ReactDOMFlightServerHostDispatcher`
- `packages/react-server-dom-bun/src/client/**/*.js` — Import from `react-client/src/ReactFlightClient`, `react-dom-bindings/src/shared/ReactFlightClientConfigDOM`, `react-client/src/ReactFlightClientConfig`
- `packages/react-server-dom-bun/src/shared/**/*.js` — Import from `shared/ReactTypes`, `shared/hasOwnProperty`
- `packages/react-server-dom-bun/src/ReactFlightBunReferences.js` — Import from `shared/ReactTypes`

**New fork file imports** (these are the existing-file modifications):

- `packages/react-server/src/forks/ReactFlightServerConfig.dom-browser-bun.js` — Imports from `react-server-dom-bun/src/server/ReactFlightServerConfigBunBundler`
- `packages/react-server/src/forks/ReactFlightServerConfig.dom-node-bun.js` — Imports from `react-server-dom-bun/src/server/ReactFlightServerConfigBunBundler`, `async_hooks`
- `packages/react-server/src/forks/ReactFlightServerConfig.dom-edge-bun.js` — Imports from `react-server-dom-bun/src/server/ReactFlightServerConfigBunBundler`
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-browser-bun.js` — Imports from `react-server-dom-bun/src/client/ReactFlightClientConfigBundlerBun`, `react-server-dom-bun/src/client/ReactFlightClientConfigBundlerBunBrowser`, `react-server-dom-bun/src/client/ReactFlightClientConfigTargetBunBrowser`
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-node-bun.js` — Imports from `react-server-dom-bun/src/client/ReactFlightClientConfigBundlerBun`, `react-server-dom-bun/src/client/ReactFlightClientConfigBundlerBunServer`, `react-server-dom-bun/src/client/ReactFlightClientConfigTargetBunServer`
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-edge-bun.js` — Imports from `react-server-dom-bun/src/client/ReactFlightClientConfigBundlerBun`, `react-server-dom-bun/src/client/ReactFlightClientConfigBundlerBunServer`, `react-server-dom-bun/src/client/ReactFlightClientConfigTargetBunServer`

**External Reference Updates:**

- `scripts/rollup/bundles.js` — 6 new bundle entry objects referencing `react-server-dom-bun/src/server/react-flight-dom-server.*` and `react-server-dom-bun/src/client/react-flight-dom-client.*`
- `scripts/shared/inlinedHostConfigs.js` — 3 new configuration objects with entryPoints and paths arrays
- `packages/react-server-dom-bun/package.json` — New package manifest with peerDependencies, dependencies, conditional exports


## 0.4 Integration Analysis


### 0.4.1 Existing Code Touchpoints

**Direct modifications required to existing files:**

- **`scripts/rollup/bundles.js`** (lines ~565-640 region): Add 6 new bundle entry objects after the existing turbopack entries. Server bundles use `bundleTypes: [BUN_DEV, BUN_PROD]`, `moduleType: RENDERER`, `condition: 'react-server'`. Client bundles use `bundleTypes: [BUN_DEV, BUN_PROD]`, `moduleType: RENDERER`. The node server variant adds `externals: ['async_hooks', 'crypto', 'stream', 'util']`.

- **`scripts/shared/inlinedHostConfigs.js`**: Add 3 new host configuration entries following the turbopack triple pattern:
  - `dom-browser-bun`: entryPoints `['react-server-dom-bun/src/client/react-flight-dom-client.browser', 'react-server-dom-bun/src/server/react-flight-dom-server.browser']`, paths array listing all `react-server-dom-bun` browser paths plus shared react-dom/react-dom-bindings paths, `isFlowTyped: true`, `isServerSupported: true`
  - `dom-node-bun`: entryPoints `['react-server-dom-bun/src/client/react-flight-dom-client.node', 'react-server-dom-bun/src/server/react-flight-dom-server.node']`, paths array including node-specific react-dom server paths
  - `dom-edge-bun`: entryPoints `['react-server-dom-bun/src/client/react-flight-dom-client.edge', 'react-server-dom-bun/src/server/react-flight-dom-server.edge']`, paths array including edge-specific react-dom server paths

**New fork files (in existing directories, replacing null-stub behavior):**

- **`packages/react-server/src/forks/ReactFlightServerConfig.dom-browser-bun.js`**: Exports from `react-server-dom-bun/src/server/ReactFlightServerConfigBunBundler` + `react-dom-bindings/src/server/ReactFlightServerConfigDOM`, sets `supportsRequestStorage = false`, uses `ReactFlightServerConfigDebugNoop`, `ReactFlightStackConfigV8`, `ReactServerConsoleConfigBrowser`
- **`packages/react-server/src/forks/ReactFlightServerConfig.dom-node-bun.js`**: Same as browser but with `supportsRequestStorage = true`, `AsyncLocalStorage` from `async_hooks`, uses `ReactFlightServerConfigDebugNode`, `ReactServerConsoleConfigServer`
- **`packages/react-server/src/forks/ReactFlightServerConfig.dom-edge-bun.js`**: Same as browser variant but uses `ReactServerConsoleConfigServer` and `ReactFlightServerConfigDebugNoop`
- **`packages/react-client/src/forks/ReactFlightClientConfig.dom-browser-bun.js`**: Sets `rendererPackageName = 'react-server-dom-bun'`, exports from Web stream config, browser console/debug configs, `ReactFlightClientConfigBundlerBun`, `ReactFlightClientConfigBundlerBunBrowser`, `ReactFlightClientConfigTargetBunBrowser`, DOM flight client config, `usedWithSSR = false`
- **`packages/react-client/src/forks/ReactFlightClientConfig.dom-node-bun.js`**: Same but Node stream config, server console/debug configs, `ReactFlightClientConfigBundlerBunServer`, `ReactFlightClientConfigTargetBunServer`, `usedWithSSR = true`
- **`packages/react-client/src/forks/ReactFlightClientConfig.dom-edge-bun.js`**: Same as node variant but Web stream config, `usedWithSSR = true`

**Build system fork resolution chain:**

The `findNearestExistingForkFile` function in `scripts/rollup/forks.js` resolves fork files by progressively shortening the hyphenated shortName. For the new host configs:

```
dom-browser-bun → tries: dom-browser-bun.js ✓ (new file)
dom-node-bun    → tries: dom-node-bun.js ✓ (new file)
dom-edge-bun    → tries: dom-edge-bun.js ✓ (new file)
```

For `ReactServerStreamConfig` forks, the resolution will fall through to the existing `dom-bun.js`:

```
dom-browser-bun → tries: dom-browser-bun.js ✗, dom-browser.js ✗, dom.js ✗
dom-node-bun    → tries: dom-node-bun.js ✗, dom-node.js ✗, dom.js ✗
```

This means `ReactServerStreamConfig` fork files may also be needed for the new host configs, or the existing `dom-bun` Fizz stream config will be reused. Since the Bun stream config is target-agnostic (`ReactServerStreamConfigBun.js` works for all targets), new `ReactServerStreamConfig.dom-browser-bun.js`, `ReactServerStreamConfig.dom-node-bun.js`, and `ReactServerStreamConfig.dom-edge-bun.js` files should be created as simple re-exports of `../ReactServerStreamConfigBun`, mirroring how `ReactServerStreamConfig.dom-bun.js` already works.

### 0.4.2 Dependency Injections

- **Rollup bundle pipeline**: The new bundles in `bundles.js` are automatically picked up by `scripts/rollup/build.js` during `yarn build`. The `moduleType: RENDERER` classification causes the build to apply the correct Rollup plugins, external resolution, and output formatting.
- **Flow type checking**: The new `inlinedHostConfigs.js` entries enable Flow to resolve the correct fork files when type-checking the new package. Flow uses these configs via `scripts/flow/config/flowconfig` which references `scripts/flow/environment.js` for module resolution.
- **Jest test discovery**: Jest discovers tests via the test regex pattern in `scripts/jest/config.source.js`. The `packages/react-server-dom-bun/src/__tests__/` path will be automatically picked up. The `inlinedHostConfigs.js` entries enable Jest's module mocking to resolve the correct fork files.

### 0.4.3 Database/Schema Updates

No database or schema changes are required. The fixture application uses an in-memory mock data store (`fixtures/flight-bun/src/data.js`) with no external database dependency, as specified in the requirements.


## 0.5 Technical Implementation


### 0.5.1 File-by-File Execution Plan

**CRITICAL: Every file listed below MUST be created or modified.**

**Group 1 — Core Package Structure (`packages/react-server-dom-bun/`):**

- **CREATE: `packages/react-server-dom-bun/package.json`** — Package manifest with name `react-server-dom-bun`, version `19.3.0`, conditional exports map mirroring turbopack (client/server/static × workerd/deno/worker/node/edge-light/browser/react-server conditions), peerDependencies (react ^19.3.0, react-dom ^19.3.0), dependencies (acorn-loose, neo-async), files array listing all distribution artifacts
- **CREATE: `packages/react-server-dom-bun/index.js`** — Guard file: `throw new Error('Use react-server-dom-bun/client instead')`
- **CREATE: `packages/react-server-dom-bun/client.js`** — Guard file: `throw new Error('react-server-dom-bun/client is not available in this environment')`
- **CREATE: `packages/react-server-dom-bun/server.js`** — Guard file: `throw new Error('react-server-dom-bun/server requires --conditions react-server')`
- **CREATE: `packages/react-server-dom-bun/static.js`** — Guard file: `throw new Error('react-server-dom-bun/static requires --conditions react-server')`
- **CREATE: `packages/react-server-dom-bun/client.browser.js`** — Re-export: `export * from './src/client/react-flight-dom-client.browser'`
- **CREATE: `packages/react-server-dom-bun/client.edge.js`** — Re-export: `export * from './src/client/react-flight-dom-client.edge'`
- **CREATE: `packages/react-server-dom-bun/client.node.js`** — Re-export: `export * from './src/client/react-flight-dom-client.node'`
- **CREATE: `packages/react-server-dom-bun/server.browser.js`** — Named re-exports of browser server APIs
- **CREATE: `packages/react-server-dom-bun/server.edge.js`** — Named re-exports of edge server APIs
- **CREATE: `packages/react-server-dom-bun/server.node.js`** — Named re-exports of node server APIs (renderToPipeableStream, renderToReadableStream, decodeReply, decodeReplyFromBusboy, decodeReplyFromAsyncIterable, decodeAction, decodeFormState, registerServerReference, registerClientReference, createClientModuleProxy, createTemporaryReferenceSet)
- **CREATE: `packages/react-server-dom-bun/static.browser.js`** — Named re-exports: prerender
- **CREATE: `packages/react-server-dom-bun/static.edge.js`** — Named re-exports: prerender
- **CREATE: `packages/react-server-dom-bun/static.node.js`** — Named re-exports: prerender, prerenderToNodeStream
- **CREATE: `packages/react-server-dom-bun/plugin.js`** — Bun bundler plugin exposing `bunReactServerComponentsPlugin()` using `Bun.build()` plugin API with `onResolve`/`onLoad` hooks for `'use client'`/`'use server'` directive detection and manifest generation

**Group 2 — Server Implementation (`packages/react-server-dom-bun/src/server/`):**

- **CREATE: `src/server/ReactFlightServerConfigBunBundler.js`** — Bundler-specific server configuration: defines `ClientManifest`, `ServerReferenceId`, `ClientReferenceMetadata` types, implements `resolveClientReferenceMetadata`, `getClientReferenceKey`, `getServerReferenceId`, `getServerReferenceBoundArguments`, `getServerReferenceLocation` using Bun's module ID scheme
- **CREATE: `src/server/ReactFlightDOMServerBrowser.js`** — Browser target server implementation: exports `renderToReadableStream`, `decodeReply`, `decodeAction`, `decodeFormState`, delegates to `react-server/src/ReactFlightServer`
- **CREATE: `src/server/ReactFlightDOMServerEdge.js`** — Edge target server implementation: exports `renderToReadableStream`, `decodeReply`, `decodeReplyFromAsyncIterable`, `decodeAction`, `decodeFormState`, delegates to shared Flight server
- **CREATE: `src/server/ReactFlightDOMServerNode.js`** — Node target server implementation: exports `renderToPipeableStream`, `renderToReadableStream`, `decodeReply`, `decodeReplyFromBusboy`, `decodeReplyFromAsyncIterable`, `decodeAction`, `decodeFormState`, implements Node.js Writable pipe-based streaming
- **CREATE: `src/server/react-flight-dom-server.browser.js`** — Barrel: re-exports from `ReactFlightDOMServerBrowser` + reference registration APIs
- **CREATE: `src/server/react-flight-dom-server.edge.js`** — Barrel: re-exports from `ReactFlightDOMServerEdge` + reference registration APIs
- **CREATE: `src/server/react-flight-dom-server.node.js`** — Barrel: re-exports from `ReactFlightDOMServerNode` + reference registration APIs

**Group 3 — Client Implementation (`packages/react-server-dom-bun/src/client/`):**

- **CREATE: `src/client/ReactFlightClientConfigBundlerBun.js`** — Core bundler config: defines `SSRModuleMap`, `ServerManifest`, `ServerReferenceId`, `ClientReferenceManifestEntry`, `ClientReferenceMetadata`, `ClientReference<T>` types, implements `resolveClientReference`, `resolveServerReference`, `preloadModule`, `requireModule`, `prepareDestinationForModule`
- **CREATE: `src/client/ReactFlightClientConfigBundlerBunBrowser.js`** — Browser-specific module loading: implements `loadChunk` using dynamic `import()` for browser chunk loading
- **CREATE: `src/client/ReactFlightClientConfigBundlerBunServer.js`** — Server/edge-specific module loading: implements `loadChunk` using `__bun_require__` or `require()` for server-side chunk loading
- **CREATE: `src/client/ReactFlightClientConfigTargetBunBrowser.js`** — Browser target config: `moduleBaseURL` resolution, `prepareDestinationWithChunks` for script/link injection
- **CREATE: `src/client/ReactFlightClientConfigTargetBunServer.js`** — Server target config: server-side `moduleBaseURL` resolution
- **CREATE: `src/client/ReactFlightDOMClientBrowser.js`** — Browser client: exports `createFromReadableStream`, `createFromFetch`, `encodeReply`
- **CREATE: `src/client/ReactFlightDOMClientEdge.js`** — Edge client: exports `createFromReadableStream`, `createFromFetch`, `encodeReply` with edge-specific stream handling
- **CREATE: `src/client/ReactFlightDOMClientNode.js`** — Node client: exports `createFromNodeStream`, `encodeReply` with Node stream handling
- **CREATE: `src/client/react-flight-dom-client.browser.js`** — Barrel re-export from `ReactFlightDOMClientBrowser`
- **CREATE: `src/client/react-flight-dom-client.edge.js`** — Barrel re-export from `ReactFlightDOMClientEdge`
- **CREATE: `src/client/react-flight-dom-client.node.js`** — Barrel re-export from `ReactFlightDOMClientNode`

**Group 4 — Shared & References (`packages/react-server-dom-bun/src/`):**

- **CREATE: `src/shared/ReactFlightImportMetadata.js`** — Import metadata types: `ImportManifestEntry`, `ImportMetadata` (sync/async tuple), constants `ID=0`, `CHUNKS=1`, `NAME=2`, `isAsyncImport` helper
- **CREATE: `src/ReactFlightBunReferences.js`** — Reference types: `ServerReference<T>`, `ClientReference<T>` with `$$typeof`/`$$id`/`$$bound`/`$$async` symbols, `CLIENT_REFERENCE_TAG`, `SERVER_REFERENCE_TAG`, `isClientReference`, `isServerReference`, `registerClientReference` functions, custom `bind` for server references

**Group 5 — npm Adapters (`packages/react-server-dom-bun/npm/`):**

- **CREATE: 13 npm adapter files** (`index.js`, `client.js`, `client.browser.js`, `client.edge.js`, `client.node.js`, `server.js`, `server.browser.js`, `server.edge.js`, `server.node.js`, `static.js`, `static.browser.js`, `static.edge.js`, `static.node.js`) — Each implements NODE_ENV-based CJS bundle selection or guard behavior, mirroring turbopack npm adapters exactly

**Group 6 — Fork Files (in existing directories):**

- **CREATE: `packages/react-server/src/forks/ReactFlightServerConfig.dom-browser-bun.js`**
- **CREATE: `packages/react-server/src/forks/ReactFlightServerConfig.dom-node-bun.js`**
- **CREATE: `packages/react-server/src/forks/ReactFlightServerConfig.dom-edge-bun.js`**
- **CREATE: `packages/react-server/src/forks/ReactServerStreamConfig.dom-browser-bun.js`**
- **CREATE: `packages/react-server/src/forks/ReactServerStreamConfig.dom-node-bun.js`**
- **CREATE: `packages/react-server/src/forks/ReactServerStreamConfig.dom-edge-bun.js`**
- **CREATE: `packages/react-client/src/forks/ReactFlightClientConfig.dom-browser-bun.js`**
- **CREATE: `packages/react-client/src/forks/ReactFlightClientConfig.dom-node-bun.js`**
- **CREATE: `packages/react-client/src/forks/ReactFlightClientConfig.dom-edge-bun.js`**

**Group 7 — Build System Integration:**

- **MODIFY: `scripts/rollup/bundles.js`** — Add 6 bundle entries for react-server-dom-bun (server.browser, server.node, server.edge, client.browser, client.node, client.edge)
- **MODIFY: `scripts/shared/inlinedHostConfigs.js`** — Add 3 host config entries (dom-browser-bun, dom-node-bun, dom-edge-bun) with full entryPoints and paths arrays

**Group 8 — Tests (`packages/react-server-dom-bun/src/__tests__/`):**

- **CREATE: `src/__tests__/ReactFlightBunDOM-test.js`** — Core DOM integration tests
- **CREATE: `src/__tests__/ReactFlightBunDOMBrowser-test.js`** — Browser-specific tests
- **CREATE: `src/__tests__/ReactFlightBunDOMEdge-test.js`** — Edge runtime tests
- **CREATE: `src/__tests__/ReactFlightBunDOMNode-test.js`** — Node runtime tests
- **CREATE: `src/__tests__/ReactFlightBunDOMReply-test.js`** — Reply serialization tests
- **CREATE: `src/__tests__/ReactFlightBunDOMReplyEdge-test.js`** — Edge reply tests
- **CREATE: `src/__tests__/utils/BunMock.js`** — Mock bundler with `__bun_require__`, `bunClientModules`, `bunServerModules`, `bunClientMap`, `bunServerMap`, `clientExports`, `serverExports` mirroring TurbopackMock.js

**Group 9 — Fixture Application (`fixtures/flight-bun/`):**

- **CREATE: `package.json`** — Fixture manifest with `bun run dev` script, dependencies on react/react-dom/react-server-dom-bun
- **CREATE: `server/server.js`** — Bun HTTP server using `Bun.serve()` with Flight streaming: RSC rendering via `renderToReadableStream`, SSR hydration via `renderToPipeableStream` from react-dom/server, client bootstrap script injection, Server Action POST handler
- **CREATE: `src/App.js`** — Root Server Component: async data fetching, nested `<Layout>`, `<Suspense>` boundaries
- **CREATE: `src/Counter.js`** — Client Component: `'use client'`, `useState` counter with increment/decrement
- **CREATE: `src/Form.js`** — Client Component: `'use client'`, controlled form inputs, Server Action submission via `useActionState`
- **CREATE: `src/Navigation.js`** — Client Component: `'use client'`, `useTransition`-based navigation
- **CREATE: `src/Layout.js`** — Server Component: nested layout with header/sidebar/content structure
- **CREATE: `src/data.js`** — In-memory mock data store (array of objects with CRUD operations)
- **CREATE: `src/actions.js`** — Server Action handlers: `'use server'`, form mutation, data manipulation
- **CREATE: `public/index.html`** — HTML shell with `<div id="root">`, `<script>` bootstrap reference
- **CREATE: `scripts/build.js`** — Build script using `Bun.build()` with RSC plugin for client bundle generation
- **CREATE: `scripts/predev.sh`** — Pre-dev script to copy `../../build/oss-experimental/*` into fixture node_modules
- **CREATE: `playwright.config.js`** — Playwright config: baseURL `http://localhost:3001`, webServer command `bun run dev`
- **CREATE: `__tests__/__e2e__/smoke.test.js`** — E2E smoke tests: initial server render, client hydration, counter interactivity, form Server Action submission, Suspense streaming resolution

### 0.5.2 Implementation Approach per File

**Phase A — Establish Feature Foundation:**
- Create the complete `packages/react-server-dom-bun/` directory structure with all source files, starting with the shared types (`ReactFlightImportMetadata.js`, `ReactFlightBunReferences.js`), then the bundler config (`ReactFlightServerConfigBunBundler.js`, `ReactFlightClientConfigBundlerBun.js`), and finally the DOM server/client entry implementations.
- Create all root entry shims, guard files, and npm adapters as thin wrappers.

**Phase B — Integrate with Existing Build Systems:**
- Add bundle entries to `scripts/rollup/bundles.js` following the exact turbopack pattern with BUN_DEV/BUN_PROD types.
- Add host config entries to `scripts/shared/inlinedHostConfigs.js`.
- Create all fork files in `react-server/src/forks/` and `react-client/src/forks/` for the three Bun host configs.

**Phase C — Implement Bun-Specific Bundler Integration:**
- Implement the Bun bundler plugin (`plugin.js`) using Bun's `onResolve`/`onLoad` plugin API for `'use client'`/`'use server'` directive detection.
- Wire the module resolution system: `__bun_require__` for server-side module loading, dynamic `import()` for browser chunk loading.

**Phase D — Ensure Quality with Comprehensive Tests:**
- Create all 7 test files mirroring TurbopackMock/test patterns, substituting `__bun_require__` for `__turbopack_require__`.
- Target 85%+ line coverage across `packages/react-server-dom-bun/src/`.

**Phase E — Build Full-Stack Fixture:**
- Create `fixtures/flight-bun/` with Bun HTTP server, Server Components, Client Components, Server Actions, and Playwright E2E tests.
- Verify `bun run dev` serves streaming RSC content on port 3001.

### 0.5.3 User Interface Design

Not directly applicable — the feature is a runtime/bundler integration package. The fixture application provides a minimal UI for validation purposes only:

- **Server-rendered page**: Displays async-fetched data in a nested layout with Suspense fallbacks
- **Counter component**: Simple increment/decrement buttons demonstrating client-side state
- **Form component**: Text input with submit button demonstrating Server Actions and optimistic updates
- **Navigation**: Link-based navigation demonstrating transition-based route changes

The fixture UI is intentionally minimal, focused on verifying RSC protocol functionality rather than providing a polished user experience. No design system or CSS framework is required.


## 0.6 Scope Boundaries


### 0.6.1 Exhaustively In Scope

**All new package source files:**
- `packages/react-server-dom-bun/**/*.js` — Complete package: root entries, guards, src/, npm/, plugin
- `packages/react-server-dom-bun/src/server/**/*.js` — All server Flight implementations and configs
- `packages/react-server-dom-bun/src/client/**/*.js` — All client Flight implementations and configs
- `packages/react-server-dom-bun/src/shared/**/*.js` — Import metadata types
- `packages/react-server-dom-bun/src/ReactFlightBunReferences.js` — Reference type definitions
- `packages/react-server-dom-bun/npm/**/*.js` — All CJS distribution adapters
- `packages/react-server-dom-bun/plugin.js` — Bun bundler plugin
- `packages/react-server-dom-bun/package.json` — Package manifest

**All new package test files:**
- `packages/react-server-dom-bun/src/__tests__/**/*.js` — 7 test files + 1 mock utility

**All new fork files (in existing shared package directories):**
- `packages/react-server/src/forks/ReactFlightServerConfig.dom-browser-bun.js`
- `packages/react-server/src/forks/ReactFlightServerConfig.dom-node-bun.js`
- `packages/react-server/src/forks/ReactFlightServerConfig.dom-edge-bun.js`
- `packages/react-server/src/forks/ReactServerStreamConfig.dom-browser-bun.js`
- `packages/react-server/src/forks/ReactServerStreamConfig.dom-node-bun.js`
- `packages/react-server/src/forks/ReactServerStreamConfig.dom-edge-bun.js`
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-browser-bun.js`
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-node-bun.js`
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-edge-bun.js`

**Build system integration points:**
- `scripts/rollup/bundles.js` — 6 new bundle entries (server.browser, server.node, server.edge, client.browser, client.node, client.edge)
- `scripts/shared/inlinedHostConfigs.js` — 3 new host config entries (dom-browser-bun, dom-node-bun, dom-edge-bun)

**All new fixture files:**
- `fixtures/flight-bun/**/*` — Complete fixture: server, src, scripts, tests, public, config
- `fixtures/flight-bun/package.json` — Fixture manifest
- `fixtures/flight-bun/server/server.js` — Bun HTTP server
- `fixtures/flight-bun/src/*.js` — Server and Client Components, data, actions
- `fixtures/flight-bun/public/index.html` — HTML shell
- `fixtures/flight-bun/scripts/build.js` — Client build script
- `fixtures/flight-bun/scripts/predev.sh` — Pre-dev artifact copy script
- `fixtures/flight-bun/playwright.config.js` — Playwright configuration
- `fixtures/flight-bun/__tests__/__e2e__/smoke.test.js` — E2E smoke tests

**Documentation:**
- `packages/react-server-dom-bun/README.md` — Package documentation

### 0.6.2 Explicitly Out of Scope

- **Existing package source modifications**: No modifications to `packages/react-reconciler/`, `packages/react-dom/`, `packages/react/`, `packages/scheduler/`, `packages/react-server/src/` (non-fork files), `packages/react-client/src/` (non-fork files), or any existing `react-server-dom-*` package source code
- **Existing fixture modifications**: No modifications to `fixtures/flight/`, `fixtures/flight-esm/`, `fixtures/flight-parcel/`, or any other existing fixture
- **Compiler changes**: No modifications to anything in `/compiler/`
- **Feature flag additions**: No new feature flags in `shared/ReactFeatureFlags.js`
- **Flight protocol wire format changes**: The wire format is immutable — the new package consumes the shared implementation without reimplementing serialization/deserialization
- **Performance optimizations beyond feature requirements**: No optimization of existing packages or build system beyond what is needed for integration
- **TypeScript migration**: All code uses Flow type annotations exclusively — no TypeScript
- **Production deployment infrastructure**: The fixture is a development demo only
- **External database integration**: The fixture uses in-memory mock data only
- **CSS framework or design system**: The fixture uses minimal/no styling
- **Bun bundler core modifications**: The package provides a plugin for Bun's bundler, it does not modify Bun itself


## 0.7 Rules for Feature Addition


### 0.7.1 Structural Conventions

- All file naming conventions, export patterns, entry shim structure, test organization, and Flow annotation style MUST match the `react-server-dom-turbopack` reference implementation exactly. This includes:
  - Root entry files: `{surface}.{target}.js` (e.g., `client.browser.js`, `server.node.js`)
  - Guard files: `index.js`, `server.js`, `static.js`, `client.js`
  - Source directory layout: `src/client/`, `src/server/`, `src/shared/`, `src/__tests__/`, `src/__tests__/utils/`
  - npm adapter directory: `npm/` with NODE_ENV-based CJS bundle selection
  - Naming pattern: Replace "Turbopack" with "Bun" in all file names and type names (e.g., `ReactFlightServerConfigTurbopackBundler.js` → `ReactFlightServerConfigBunBundler.js`)

### 0.7.2 Preservation Boundaries

- MUST NOT modify source files in the protected packages listed in the user's specification
- The ONLY allowed modifications to existing files are specifically enumerated: `scripts/rollup/bundles.js`, fork files in `packages/react-server/src/forks/` and `packages/react-client/src/forks/`, `scripts/shared/inlinedHostConfigs.js`, and the workspace entry in root `package.json`
- The existing `dom-bun` host config entry in `inlinedHostConfigs.js` must be preserved as-is (it serves the Fizz-only react-dom-server.bun path) — new Flight entries use distinct shortNames (`dom-browser-bun`, `dom-node-bun`, `dom-edge-bun`)

### 0.7.3 Type System Requirements

- All code MUST use Flow type annotations (NEVER TypeScript) consistent with React core packages
- Flow version target: `^0.279.0` (from monorepo `package.json`)
- Every `.js` file MUST include the `@flow` annotation in its copyright header
- All type imports must use Flow's `import type` syntax
- Opaque types should be used for bundler-specific types (e.g., `export opaque type ClientReferenceMetadata = ImportMetadata`)

### 0.7.4 Build System Integration Rules

- New bundle entries in `bundles.js` MUST use `BUN_DEV`/`BUN_PROD` bundle types (already defined at lines 17-18 of the file)
- Server bundles MUST set `condition: 'react-server'` and `moduleType: RENDERER`
- Node server bundles MUST include `externals: ['async_hooks', 'crypto', 'stream', 'util']`
- Host config entries MUST include all required paths for both server and client entry points
- All host configs MUST set `isFlowTyped: true` and `isServerSupported: true`

### 0.7.5 Flight Protocol Integrity

- The Flight protocol wire format is immutable and must not be reimplemented
- The new package MUST consume the shared `react-server/src/ReactFlightServer` and `react-client/src/ReactFlightClient` implementations via fork-based configuration injection
- Bundler-specific behavior is limited to: module ID schemes, chunk loading mechanisms, manifest format, and reference registration — all other serialization/deserialization logic comes from the shared packages

### 0.7.6 Validation Requirements

- `yarn flow` must pass with zero errors on all generated code
- `yarn linc` must pass with zero lint/format violations
- Package unit and integration tests must achieve 85%+ line coverage across `packages/react-server-dom-bun/src/`
- Fixture app must start via `bun run dev`, serve RSC streaming content to a browser, and pass Playwright E2E smoke tests
- `yarn build --r=experimental` must complete successfully with the new package included
- Zero regressions: all existing tests in `react-server-dom-webpack`, `react-server-dom-turbopack`, `react-server-dom-parcel`, and `react-server-dom-esm` must continue to pass

### 0.7.7 Bun Runtime Requirements

- Bun runtime >= 1.1 is required for the bundler plugin API (`Bun.build()` with plugins), `Bun.serve()` HTTP server, `Bun.hash()` for content hashing, and `ReadableStream` support
- The fixture MUST use `Bun.serve()` for the HTTP server (not Node.js compatibility layer)
- The fixture development server entry point MUST be `bun run dev` on port 3001 (configurable via `${PORT}`)
- The Bun bundler plugin MUST use the standard `onResolve`/`onLoad` hook pattern compatible with esbuild


## 0.8 References


### 0.8.1 Repository Files and Folders Searched

The following files and folders were comprehensively inspected across the codebase to derive all conclusions in this Agent Action Plan:

**Root-level exploration:**
- `/` (repository root) — Package structure, workspace configuration, tooling configs
- `packages/` — All 38+ packages enumerated, confirmed no existing `react-server-dom-bun`
- `fixtures/` — All fixtures enumerated, confirmed no existing `flight-bun`
- `scripts/` — Build system scripts enumerated

**Primary reference implementation (`react-server-dom-turbopack`):**
- `packages/react-server-dom-turbopack/` — Full directory tree (src/, npm/, root files)
- `packages/react-server-dom-turbopack/package.json` — Version 19.3.0, exports map, dependencies
- `packages/react-server-dom-turbopack/index.js` — Guard file pattern
- `packages/react-server-dom-turbopack/client.browser.js` — Re-export pattern
- `packages/react-server-dom-turbopack/server.js` — Guard file pattern
- `packages/react-server-dom-turbopack/server.node.js` — Named export pattern
- `packages/react-server-dom-turbopack/static.node.js` — Static export pattern
- `packages/react-server-dom-turbopack/src/` — Complete source tree
- `packages/react-server-dom-turbopack/src/client/` — 11 client files enumerated and analyzed
- `packages/react-server-dom-turbopack/src/server/` — 7 server files enumerated and analyzed
- `packages/react-server-dom-turbopack/src/shared/ReactFlightImportMetadata.js` — Import metadata types
- `packages/react-server-dom-turbopack/src/ReactFlightTurbopackReferences.js` — Reference types
- `packages/react-server-dom-turbopack/src/__tests__/` — 6 test files + utils/TurbopackMock.js
- `packages/react-server-dom-turbopack/src/__tests__/ReactFlightTurbopackDOMNode-test.js` — Test pattern
- `packages/react-server-dom-turbopack/src/__tests__/utils/TurbopackMock.js` — Mock bundler pattern
- `packages/react-server-dom-turbopack/src/server/ReactFlightServerConfigTurbopackBundler.js` — Bundler config
- `packages/react-server-dom-turbopack/src/client/ReactFlightClientConfigBundlerTurbopack.js` — Client bundler config
- `packages/react-server-dom-turbopack/npm/client.browser.js` — CJS adapter pattern
- `packages/react-server-dom-turbopack/npm/server.node.js` — CJS adapter pattern
- `packages/react-server-dom-turbopack/npm/` — All 13 npm adapters enumerated

**Secondary reference implementations:**
- `packages/react-server-dom-esm/` — ESM package structure (simpler, Node-only)
- `packages/react-server-dom-parcel/` — Parcel package structure
- `packages/react-server-dom-webpack/` — Webpack package structure

**Existing Bun infrastructure:**
- `packages/react-server/src/ReactServerStreamConfigBun.js` — 136-line Bun stream implementation
- `packages/react-server/src/forks/ReactFlightServerConfig.dom-bun.js` — Existing Fizz-only fork
- `packages/react-server/src/forks/ReactServerStreamConfig.dom-bun.js` — Stream config fork
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-bun.js` — Null-stub client fork
- `packages/react-dom/src/server/react-dom-server.bun.js` — Fizz server entry
- `packages/react-dom/src/server/ReactDOMFizzServerBun.js` — Fizz implementation
- `packages/react-dom/npm/server.bun.js` — Fizz npm adapter

**Shared packages:**
- `packages/react-server/src/` — Flight server source tree and forks directory
- `packages/react-server/src/forks/` — All fork files enumerated (turbopack, bun, parcel, esm variants)
- `packages/react-client/src/` — Flight client source tree and forks directory
- `packages/react-client/src/forks/` — All fork files enumerated

**Fork file comparisons (turbopack vs bun):**
- `packages/react-server/src/forks/ReactFlightServerConfig.dom-browser-turbopack.js` — Browser server fork reference
- `packages/react-server/src/forks/ReactFlightServerConfig.dom-node-turbopack.js` — Node server fork reference
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-browser-turbopack.js` — Browser client fork reference
- `packages/react-client/src/forks/ReactFlightClientConfig.dom-node-turbopack.js` — Node client fork reference

**Build system:**
- `scripts/rollup/bundles.js` — 1359 lines, all bundle entries analyzed (turbopack lines 565-640, BUN_DEV/BUN_PROD at lines 17-18, Fizz bun at line 400)
- `scripts/rollup/forks.js` — 484 lines, `findNearestExistingForkFile` implementation (lines 29-43), fork resolution for ReactFlightServerConfig (lines 350-393), ReactFlightClientConfig (lines 394-432)
- `scripts/shared/inlinedHostConfigs.js` — All host configs analyzed: dom-bun (line 280), dom-browser-turbopack (line 330), dom-node-turbopack (line 148), dom-edge-turbopack (line 446)

**Fixture patterns:**
- `fixtures/flight/` — Webpack-based flight fixture: server/, src/, __tests__/, config/
- `fixtures/flight/server/global.js` — Express + Webpack server pattern
- `fixtures/flight/__tests__/__e2e__/smoke.test.js` — Playwright E2E test pattern
- `fixtures/flight-esm/` — ESM fixture structure and package.json
- `fixtures/flight-esm/package.json` — ESM fixture dependencies and scripts
- `fixtures/flight-parcel/` — Parcel fixture structure and package.json

**Dependency manifests:**
- `package.json` (root) — Workspace config, devDependencies (flow-bin ^0.279.0, jest ^29.4.2, rollup ^3.29.5, playwright)

### 0.8.2 Attachments

No attachments were provided for this project.

### 0.8.3 External Research Sources

- **Bun Plugin API documentation** (`https://bun.com/docs/bundler/plugins`) — Plugin lifecycle, `onResolve`/`onLoad` hooks, esbuild compatibility
- **Bun Bundler documentation** (`https://bun.com/blog/bun-bundler`, `https://www.bunjs.com.cn/bundler/`) — `Bun.build()` API, target options, plugin integration, experimental `--server-components` flag
- **Bun HTTP Server documentation** (`https://bun.com/docs/runtime/http/server`, `https://bun.com/reference/bun/serve`) — `Bun.serve()` API, fetch handler, streaming responses, route configuration
- **Server Components with Bun** (`https://gitnation.com/contents/server-components-with-bun`) — Jarred Sumner's talk on RSC integration with Bun's plugin API and manifest generation
- **Bun RSC Discussion** (`https://github.com/oven-sh/bun/discussions/5816`) — Community discussion on RSC + Client components in Bun, references to `bun-plugin-server-components`
- **Bun 1.3 release notes** (`https://bun.com/blog/bun-v1.3`) — Full-stack dev server, built-in routing, HTML imports
- **React monorepo tech spec sections**: 3.1 Programming Languages (Flow ^0.279.0), 3.2 Frameworks & Libraries (Rollup ^3.29.5, Jest ^29.4.2, Playwright ^1.56.1)


