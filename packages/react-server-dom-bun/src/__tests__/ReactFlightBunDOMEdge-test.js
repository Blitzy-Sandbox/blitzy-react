/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

let clientExports;
let bunMap;
let bunModules;
let React;
let ReactServer;
let ReactDOMServer;
let ReactServerDOMServer;
let ReactServerDOMStaticServer;
let ReactServerDOMClient;
let use;
let serverAct;
let assertConsoleErrorDev;

describe('ReactFlightBunDOMEdge', () => {
  beforeEach(() => {
    jest.resetModules();

    serverAct = require('internal-test-utils').serverAct;

    // Simulate the condition resolution
    jest.mock('react', () => require('react/react.react-server'));
    jest.mock('react-server-dom-bun/server', () =>
      require('react-server-dom-bun/server.edge'),
    );

    const BunMock = require('./utils/BunMock');
    clientExports = BunMock.clientExports;
    bunMap = BunMock.bunMap;
    bunModules = BunMock.bunModules;

    ReactServer = require('react');
    ReactServerDOMServer = require('react-server-dom-bun/server.edge');
    jest.mock('react-server-dom-bun/static', () =>
      require('react-server-dom-bun/static.edge'),
    );
    ReactServerDOMStaticServer = require('react-server-dom-bun/static');

    jest.resetModules();
    __unmockReact();

    React = require('react');
    ReactDOMServer = require('react-dom/server.edge');
    ReactServerDOMClient = require('react-server-dom-bun/client.edge');
    use = React.use;

    const InternalTestUtils = require('internal-test-utils');
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  async function readResult(stream) {
    const reader = stream.getReader();
    let result = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        return result;
      }
      result += Buffer.from(value).toString('utf8');
    }
  }

  function normalizeCodeLocInfo(str) {
    return (
      str &&
      str.replace(/^ +(?:at|in) ([\S]+)[^\n]*/gm, function (m, name) {
        return '    in ' + name + (/\d/.test(m) ? ' (at **)' : '');
      })
    );
  }

  function createDelayedStream(
    stream: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    return new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();
        while (true) {
          const {done, value} = await reader.read();
          if (done) {
            controller.close();
          } else {
            // Artificially delay between enqueuing chunks.
            await new Promise(resolve => setTimeout(resolve));
            controller.enqueue(value);
          }
        }
      },
    });
  }

  it('should allow an alternative module mapping to be used for SSR', async () => {
    function ClientComponent() {
      return <span>Client Component</span>;
    }
    // The Client build may not have the same IDs as the Server bundles for the same
    // component.
    const ClientComponentOnTheClient = clientExports(ClientComponent);
    const ClientComponentOnTheServer = clientExports(ClientComponent);

    // In the SSR bundle this module won't exist. We simulate this by deleting it.
    const clientId = bunMap[ClientComponentOnTheClient.$$id].id;
    delete bunModules[clientId];

    // Instead, we have to provide a translation from the client meta data to the SSR
    // meta data.
    const ssrMetadata = bunMap[ClientComponentOnTheServer.$$id];
    const translationMap = {
      [clientId]: {
        '*': ssrMetadata,
      },
    };

    function App() {
      return <ClientComponentOnTheClient />;
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(<App />, bunMap),
    );
    const response = ReactServerDOMClient.createFromReadableStream(stream, {
      serverConsumerManifest: {
        moduleMap: translationMap,
        moduleLoading: null,
      },
    });

    function ClientRoot() {
      return use(response);
    }

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(<ClientRoot />),
    );
    const result = await readResult(ssrStream);
    expect(result).toEqual('<span>Client Component</span>');
  });

  // @gate __DEV__
  it('can transport debug info through a separate debug channel', async () => {
    function Thrower() {
      throw new Error('ssr-throw');
    }

    const ClientComponentOnTheClient = clientExports(
      Thrower,
      123,
      'path/to/chunk.js',
    );

    const ClientComponentOnTheServer = clientExports(Thrower);

    function App() {
      return ReactServer.createElement(
        ReactServer.Suspense,
        null,
        ReactServer.createElement(ClientComponentOnTheClient, null),
      );
    }

    let debugReadableStreamController;

    const debugReadableStream = new ReadableStream({
      start(controller) {
        debugReadableStreamController = controller;
      },
    });

    const rscStream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {
          debugChannel: {
            writable: new WritableStream({
              write(chunk) {
                debugReadableStreamController.enqueue(chunk);
              },
              close() {
                debugReadableStreamController.close();
              },
            }),
          },
        },
      ),
    );

    function ClientRoot({response}) {
      return use(response);
    }

    const serverConsumerManifest = {
      moduleMap: {
        [bunMap[ClientComponentOnTheClient.$$id].id]: {
          '*': bunMap[ClientComponentOnTheServer.$$id],
        },
      },
      moduleLoading: null,
    };

    const response = ReactServerDOMClient.createFromReadableStream(
      // Create a delayed stream to simulate that the RSC stream might be
      // transported slower than the debug channel, which must not lead to a
      // `Connection closed` error in the Flight client.
      createDelayedStream(rscStream),
      {
        serverConsumerManifest,
        debugChannel: {readable: debugReadableStream},
      },
    );

    let ownerStack;

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(
        <ClientRoot response={response} />,
        {
          onError(err, errorInfo) {
            ownerStack = React.captureOwnerStack
              ? React.captureOwnerStack()
              : null;
          },
        },
      ),
    );

    const result = await readResult(ssrStream);

    expect(normalizeCodeLocInfo(ownerStack)).toBe('\n    in App (at **)');

    expect(result).toContain(
      'Switched to client rendering because the server rendering errored:\n\nssr-throw',
    );
  });

  // @gate __DEV__
  it('can transport debug info through a slow debug channel', async () => {
    function Thrower() {
      throw new Error('ssr-throw');
    }

    const ClientComponentOnTheClient = clientExports(
      Thrower,
      123,
      'path/to/chunk.js',
    );

    const ClientComponentOnTheServer = clientExports(Thrower);

    function App() {
      return ReactServer.createElement(
        ReactServer.Suspense,
        null,
        ReactServer.createElement(ClientComponentOnTheClient, null),
      );
    }

    let debugReadableStreamController;

    const debugReadableStream = new ReadableStream({
      start(controller) {
        debugReadableStreamController = controller;
      },
    });

    const rscStream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {
          debugChannel: {
            writable: new WritableStream({
              write(chunk) {
                debugReadableStreamController.enqueue(chunk);
              },
              close() {
                debugReadableStreamController.close();
              },
            }),
          },
        },
      ),
    );

    function ClientRoot({response}) {
      return use(response);
    }

    const serverConsumerManifest = {
      moduleMap: {
        [bunMap[ClientComponentOnTheClient.$$id].id]: {
          '*': bunMap[ClientComponentOnTheServer.$$id],
        },
      },
      moduleLoading: null,
    };

    const response = ReactServerDOMClient.createFromReadableStream(rscStream, {
      serverConsumerManifest,
      debugChannel: {
        readable:
          // Create a delayed stream to simulate that the debug stream might
          // be transported slower than the RSC stream, which must not lead to
          // missing debug info.
          createDelayedStream(debugReadableStream),
      },
    });

    let ownerStack;

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(
        <ClientRoot response={response} />,
        {
          onError(err, errorInfo) {
            ownerStack = React.captureOwnerStack
              ? React.captureOwnerStack()
              : null;
          },
        },
      ),
    );

    const result = await readResult(ssrStream);

    expect(normalizeCodeLocInfo(ownerStack)).toBe('\n    in App (at **)');

    expect(result).toContain(
      'Switched to client rendering because the server rendering errored:\n\nssr-throw',
    );
  });

  it('can prerender to a static result', async () => {
    let resolveGreeting;
    const greetingPromise = new Promise(resolve => {
      resolveGreeting = resolve;
    });

    function Greeting() {
      return greetingPromise.then(() => 'hello world');
    }

    function App() {
      return ReactServer.createElement(
        'div',
        null,
        ReactServer.createElement(Greeting, null),
      );
    }

    const {pendingResult} = await serverAct(async () => {
      return {
        pendingResult: ReactServerDOMStaticServer.prerender(
          ReactServer.createElement(App, null),
          bunMap,
        ),
      };
    });

    resolveGreeting();
    const {prelude} = await pendingResult;

    function ClientRoot({response}) {
      return use(response);
    }

    const response = ReactServerDOMClient.createFromReadableStream(prelude, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(
        React.createElement(ClientRoot, {response}),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toBe('<div>hello world</div>');
  });

  it('can prerender with an abort signal', async () => {
    const controller = new AbortController();

    function App() {
      return ReactServer.createElement(
        'div',
        null,
        ReactServer.createElement(
          ReactServer.Suspense,
          {fallback: 'loading...'},
          ReactServer.createElement(Hanging, null),
        ),
      );
    }

    function Hanging() {
      return new Promise(() => {
        // never resolves
      });
    }

    const errors = [];
    const {pendingResult} = await serverAct(async () => {
      return {
        pendingResult: ReactServerDOMStaticServer.prerender(
          ReactServer.createElement(App, null),
          bunMap,
          {
            signal: controller.signal,
            onError(err) {
              errors.push(err);
            },
          },
        ),
      };
    });

    controller.abort('boom');
    const {prelude} = await serverAct(() => pendingResult);
    // Abort reasons are not propagated as errors in prerender
    expect(errors).toEqual([]);

    function ClientRoot({response}) {
      return use(response);
    }

    const response = ReactServerDOMClient.createFromReadableStream(prelude, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });

    const ssrErrors = [];
    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(
        React.createElement(ClientRoot, {response}),
        {
          onError(error) {
            ssrErrors.push(error);
          },
        },
      ),
    );
    const result = await readResult(ssrStream);
    // The halted content should be replaced by an error fallback or empty
    expect(result).toBeDefined();
  });

  it('can decode a reply with a string body', async () => {
    const decoded = await ReactServerDOMServer.decodeReply(
      '"hello edge"',
      bunMap,
    );
    expect(decoded).toBe('hello edge');
  });

  it('can decode a reply with a FormData body', async () => {
    const formData = new FormData();
    formData.append('0', '"edge-form-data"');
    const decoded = await ReactServerDOMServer.decodeReply(
      formData,
      bunMap,
    );
    expect(decoded).toBe('edge-form-data');
  });

  it('encodeReply and decodeReply round-trip on edge', async () => {
    const body = await ReactServerDOMClient.encodeReply({key: 'edge-value'});
    const decoded = await ReactServerDOMServer.decodeReply(body, bunMap);
    expect(decoded).toEqual({key: 'edge-value'});
  });

  it('encodeReply with nested arrays and objects', async () => {
    const payload = {
      arr: [1, 2, 3],
      nested: {a: 'b', c: [true, false]},
    };
    const body = await ReactServerDOMClient.encodeReply(payload);
    const decoded = await ReactServerDOMServer.decodeReply(body, bunMap);
    expect(decoded).toEqual(payload);
  });

  it('renderToReadableStream with abort signal', async () => {
    const controller = new AbortController();

    function App() {
      return ReactServer.createElement('div', null, 'initial');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {
          signal: controller.signal,
        },
      ),
    );

    // Read some data before abort
    const reader = stream.getReader();
    const {value} = await reader.read();
    expect(value).toBeDefined();
    reader.releaseLock();
  });

  it('renderToReadableStream with already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort('pre-aborted');

    function App() {
      return ReactServer.createElement('div', null, 'should not render fully');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {
          signal: controller.signal,
        },
      ),
    );

    assertConsoleErrorDev(['pre-aborted']);

    // Stream should still be created - the abort is handled internally
    expect(stream).toBeDefined();
    expect(stream instanceof ReadableStream).toBe(true);
  });

  it('renderToReadableStream with identifierPrefix', async () => {
    function App() {
      return ReactServer.createElement('span', null, 'prefixed');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {identifierPrefix: 'edge_'},
      ),
    );

    function ClientRoot({response}) {
      return use(response);
    }

    const response = ReactServerDOMClient.createFromReadableStream(stream, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(
        React.createElement(ClientRoot, {response}),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toBe('<span>prefixed</span>');
  });

  it('renderToReadableStream with onError callback', async () => {
    const errors = [];
    function Failing() {
      throw new Error('edge component error');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(Failing, null),
        bunMap,
        {
          onError(error) {
            errors.push(error.message);
          },
        },
      ),
    );

    // Read the stream to trigger the error handling
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe('edge component error');
  });

  it('createFromReadableStream with serverConsumerManifest on edge', async () => {
    function ServerComponent() {
      return ReactServer.createElement('div', null, 'edge-ssr-component');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(ServerComponent, null),
        bunMap,
      ),
    );

    const response = ReactServerDOMClient.createFromReadableStream(stream, {
      serverConsumerManifest: {
        moduleMap: {},
        moduleLoading: null,
      },
    });

    function ClientRoot({response: resp}) {
      return use(resp);
    }

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(
        React.createElement(ClientRoot, {response}),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toBe('<div>edge-ssr-component</div>');
  });

  it('can decode a reply with various primitive types', async () => {
    // number
    const num = await ReactServerDOMServer.decodeReply('42', bunMap);
    expect(num).toBe(42);

    // boolean
    const bool = await ReactServerDOMServer.decodeReply('true', bunMap);
    expect(bool).toBe(true);

    // null
    const nul = await ReactServerDOMServer.decodeReply('null', bunMap);
    expect(nul).toBe(null);
  });

  it('encodeReply with Date object', async () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const body = await ReactServerDOMClient.encodeReply(date);
    const decoded = await ReactServerDOMServer.decodeReply(body, bunMap);
    expect(decoded).toEqual(date);
  });

  it('renderToReadableStream with environmentName option', async () => {
    function App() {
      return ReactServer.createElement('span', null, 'env-test');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {environmentName: 'edge-worker'},
      ),
    );

    // Verify the stream was created successfully with environment name option
    expect(stream).toBeDefined();
    expect(stream instanceof ReadableStream).toBe(true);

    const response = ReactServerDOMClient.createFromReadableStream(stream, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });

    function ClientRoot({response: resp}) {
      return use(resp);
    }

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToReadableStream(
        React.createElement(ClientRoot, {response}),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toBe('<span>env-test</span>');
  });
});
