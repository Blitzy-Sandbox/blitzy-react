/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Client entry point for the Bun Flight fixture.
 *
 * This module bootstraps client-side React by:
 * 1. Setting up the Bun module resolution globals (__bun_require__, __bun_load__).
 * 2. Importing and registering all client components into the module cache so
 *    the Flight client can synchronously resolve them when processing the
 *    Flight stream's client reference instructions.
 * 3. Fetching the RSC Flight payload from the global server's /rsc endpoint.
 * 4. Rendering the resolved component tree into the DOM with createRoot.
 *
 * Architecture Overview:
 * - Region server (port 3002): Runs with --conditions=react-server, produces
 *   Flight protocol streams via renderToReadableStream. Client components in
 *   the stream are serialized as references containing their absolute file
 *   paths (e.g. "/tmp/.../src/Counter.js") and export names.
 * - Global server (port 3001): Serves this HTML shell + proxies /rsc requests
 *   to the region server so the browser can fetch Flight streams.
 * - This client script: Loaded by the HTML shell, provides module resolution
 *   for the Flight client, fetches the Flight stream, and renders the tree.
 */

'use strict';

// ---------------------------------------------------------------------------
// Module Resolution Infrastructure
// ---------------------------------------------------------------------------

// The Flight client (react-server-dom-bun/client) expects two globals for
// module resolution:
//
// __bun_require__(id) — Synchronous lookup. Called by requireModule() after
//   chunks have been preloaded. Must return the module's exports object.
//
// __bun_load__(filename) — Asynchronous chunk loading. Called by preloadModule()
//   for each chunk listed in a client reference's metadata. Returns a Promise.
//
// In a production Bun-bundled application these would be provided by the Bun
// runtime. For this dev fixture we implement them as a simple cache-based
// registry populated by static imports below.

var moduleCache = Object.create(null);

globalThis.__bun_require__ = function bunRequire(id) {
  var mod = moduleCache[id];
  if (mod) {
    return mod;
  }
  throw new Error(
    'Module "' + id + '" has not been registered. ' +
    'Ensure all client components are imported and registered in src/index.js.'
  );
};

globalThis.__bun_load__ = function bunLoad(filename) {
  var mod = moduleCache[filename];
  if (mod) {
    return Promise.resolve(mod);
  }
  return Promise.reject(
    new Error('Cannot load chunk "' + filename + '": not in module cache.')
  );
};

// ---------------------------------------------------------------------------
// Client Component Registration
// ---------------------------------------------------------------------------

// Import ALL client components used by the application. These are the actual
// implementations (with React hooks, event handlers, etc.) that run in the
// browser. On the server side, these same files are replaced by the
// bun-rsc-register plugin with registerClientReference() stubs.
//
// Each module is registered in the cache keyed by its absolute file path —
// the same path the region server uses in the client manifest. The
// __RSC_SRC_DIR__ constant is injected at build time via Bun.build()'s
// `define` option and resolves to the fixture's src/ directory.

var CounterModule = require('./Counter.js');
var FormModule = require('./Form.js');
var NavigationModule = require('./Navigation.js');

/* global __RSC_SRC_DIR__ */
var srcDir = __RSC_SRC_DIR__;
moduleCache[srcDir + '/Counter.js'] = CounterModule;
moduleCache[srcDir + '/Form.js'] = FormModule;
moduleCache[srcDir + '/Navigation.js'] = NavigationModule;

// ---------------------------------------------------------------------------
// React Imports
// ---------------------------------------------------------------------------

var React = require('react');
var ReactDOM = require('react-dom/client');
var ReactServerDOMClient = require('react-server-dom-bun/client');

var createFromFetch = ReactServerDOMClient.createFromFetch;
var encodeReply = ReactServerDOMClient.encodeReply;

// ---------------------------------------------------------------------------
// Server Action Call Handler
// ---------------------------------------------------------------------------

/**
 * Invoked by the React runtime when a Server Action is triggered on the
 * client (e.g. form submission, event handler calling a server function).
 *
 * 1. Encodes the action arguments using encodeReply (Flight reply protocol).
 * 2. POSTs them to the server with the rsc-action header identifying the
 *    server function by its reference ID (filepath#exportName).
 * 3. Reads the re-rendered RSC payload from the response.
 * 4. Updates the root component tree with the new payload via startTransition.
 * 5. Returns the action's return value.
 */
var updateRoot;

function callServer(id, args) {
  return encodeReply(args).then(function (body) {
    return createFromFetch(
      fetch('/', {
        method: 'POST',
        headers: {
          Accept: 'text/x-component',
          'rsc-action': id,
        },
        body: body,
      }),
      {callServer: callServer}
    );
  }).then(function (result) {
    var root = result.root;
    var returnValue = result.returnValue;
    React.startTransition(function () {
      updateRoot(root);
    });
    return returnValue;
  });
}

// ---------------------------------------------------------------------------
// Shell Component
// ---------------------------------------------------------------------------

/**
 * Root shell component that holds the current RSC tree in state.
 * The data prop is a thenable (from createFromFetch) on initial render;
 * React.use() suspends until the Flight payload resolves, then the
 * resolved tree is stored in state. Server Action re-renders update
 * the state via the updateRoot setter.
 */
function Shell(props) {
  var resolved = React.use(props.data);
  var stateArray = React.useState(resolved.root);
  updateRoot = stateArray[1];
  return stateArray[0];
}

// ---------------------------------------------------------------------------
// Application Bootstrap
// ---------------------------------------------------------------------------

/**
 * Fetches the RSC Flight payload from the global server's /rsc proxy
 * endpoint and renders the component tree into the DOM.
 *
 * Uses createRoot (not hydrateRoot) because the global server sends an
 * HTML shell without server-rendered content — all rendering is performed
 * client-side from the Flight payload.
 */
var data = createFromFetch(
  fetch('/rsc', {
    headers: {
      Accept: 'text/x-component',
    },
  }),
  {callServer: callServer}
);

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(
    React.Suspense,
    {fallback: 'Loading...'},
    React.createElement(Shell, {data: data})
  )
);
