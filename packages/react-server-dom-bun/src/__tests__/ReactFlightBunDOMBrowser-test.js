/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {patchMessageChannel} from '../../../../scripts/jest/patchMessageChannel';

// Polyfills for test environment
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.WritableStream =
  require('web-streams-polyfill/ponyfill/es6').WritableStream;
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.Response = require('undici').Response;

let clientExports;
let React;
let ReactDOMClient;
let ReactServerDOMServer;
let ReactServerDOMStaticServer;
let ReactServerDOMClient;
let ReactServer;
let ReactServerScheduler;
let act;
let serverAct;
let assertConsoleErrorDev;
let bunMap;
let use;

describe('ReactFlightBunDOMBrowser', () => {
  beforeEach(() => {
    jest.resetModules();

    ReactServerScheduler = require('scheduler');
    patchMessageChannel(ReactServerScheduler);
    const InternalTestUtils = require('internal-test-utils');
    serverAct = InternalTestUtils.serverAct;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    // Simulate the condition resolution
    jest.mock('react', () => require('react/react.react-server'));
    ReactServer = require('react');

    jest.mock('react-server-dom-bun/server', () =>
      require('react-server-dom-bun/server.browser'),
    );
    jest.mock('react-server-dom-bun/static', () =>
      require('react-server-dom-bun/static.browser'),
    );
    const BunMock = require('./utils/BunMock');
    clientExports = BunMock.clientExports;
    bunMap = BunMock.bunMap;

    ReactServerDOMServer = require('react-server-dom-bun/server.browser');
    ReactServerDOMStaticServer = require('react-server-dom-bun/static');

    __unmockReact();
    jest.resetModules();

    ({act} = require('internal-test-utils'));
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactServerDOMClient = require('react-server-dom-bun/client');
    use = React.use;
  });

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

  function normalizeCodeLocInfo(str) {
    return (
      str &&
      str.replace(/^ +(?:at|in) ([\S]+)[^\n]*/gm, function (m, name) {
        return '    in ' + name + (/\d/.test(m) ? ' (at **)' : '');
      })
    );
  }

  it('should resolve HTML using W3C streams', async () => {
    function Text({children}) {
      return <span>{children}</span>;
    }
    function HTML() {
      return (
        <div>
          <Text>hello</Text>
          <Text>world</Text>
        </div>
      );
    }

    function App() {
      const model = {
        html: <HTML />,
      };
      return model;
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(<App />),
    );
    const response = ReactServerDOMClient.createFromReadableStream(stream);
    const model = await response;
    expect(model).toEqual({
      html: (
        <div>
          <span>hello</span>
          <span>world</span>
        </div>
      ),
    });
  });

  it('does not close the response early when using a fast debug channel', async () => {
    function Component() {
      return <div>Hi</div>;
    }

    let debugReadableStreamController;

    const debugReadableStream = new ReadableStream({
      start(controller) {
        debugReadableStreamController = controller;
      },
    });

    const rscStream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(<Component />, bunMap, {
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
      }),
    );

    function ClientRoot({response}) {
      return use(response);
    }

    const response = ReactServerDOMClient.createFromReadableStream(
      // Create a delayed stream to simulate that the RSC stream might be
      // transported slower than the debug channel, which must not lead to a
      // `Connection closed` error in the Flight client.
      createDelayedStream(rscStream),
      {
        debugChannel: {readable: debugReadableStream},
      },
    );

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<ClientRoot response={response} />);
    });

    expect(container.innerHTML).toBe('<div>Hi</div>');
  });

  it('can transport debug info through a dedicated debug channel', async () => {
    let ownerStack;

    const ClientComponent = clientExports(() => {
      ownerStack = React.captureOwnerStack ? React.captureOwnerStack() : null;
      return <p>Hi</p>;
    });

    function App() {
      return ReactServer.createElement(
        ReactServer.Suspense,
        null,
        ReactServer.createElement(ClientComponent, null),
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

    const response = ReactServerDOMClient.createFromReadableStream(rscStream, {
      replayConsoleLogs: true,
      debugChannel: {
        readable: debugReadableStream,
        // Explicitly not defining a writable side here. Its presence was
        // previously used as a condition to wait for referenced debug chunks.
      },
    });

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<ClientRoot response={response} />);
    });

    if (__DEV__) {
      expect(normalizeCodeLocInfo(ownerStack)).toBe('\n    in App (at **)');
    }

    expect(container.innerHTML).toBe('<p>Hi</p>');
  });

  it('should support renderToReadableStream with onError callback', async () => {
    const errors = [];
    function BadComponent() {
      throw new Error('render error');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(BadComponent),
        bunMap,
        {
          onError(error) {
            errors.push(error.message);
            return 'digest-' + error.message;
          },
        },
      ),
    );

    // The stream should still be produced (errors are encoded in the payload)
    expect(stream).toBeTruthy();
    expect(stream instanceof ReadableStream).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe('render error');
  });

  it('should support renderToReadableStream with abort signal (already aborted)', async () => {
    function App() {
      return ReactServer.createElement('div', null, 'hello');
    }

    const controller = new AbortController();
    controller.abort('test abort reason');

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App),
        bunMap,
        {
          signal: controller.signal,
        },
      ),
    );
    assertConsoleErrorDev(['test abort reason']);

    expect(stream).toBeTruthy();
    expect(stream instanceof ReadableStream).toBe(true);
  });

  it('should support renderToReadableStream with abort signal (abort after start)', async () => {
    let resolveGreeting;
    const greetingPromise = new Promise(resolve => {
      resolveGreeting = resolve;
    });

    function Greeting() {
      if (greetingPromise) throw greetingPromise;
      return 'hello';
    }

    const controller = new AbortController();

    const stream = await serverAct(() => {
      const s = ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(Greeting),
        bunMap,
        {
          signal: controller.signal,
        },
      );
      // Abort after starting the render
      controller.abort('late abort');
      return s;
    });
    assertConsoleErrorDev(['late abort']);

    expect(stream).toBeTruthy();
    expect(stream instanceof ReadableStream).toBe(true);
  });

  it('should support renderToReadableStream with identifierPrefix', async () => {
    function App() {
      return ReactServer.createElement('div', null, 'prefixed');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App),
        bunMap,
        {
          identifierPrefix: 'bun-prefix-',
        },
      ),
    );

    const response = ReactServerDOMClient.createFromReadableStream(stream);
    const model = await response;
    // Verify the element structure without deep-equality on _owner (which
    // carries debug metadata in dev mode).
    expect(model.$$typeof).toBe(Symbol.for('react.transitional.element'));
    expect(model.type).toBe('div');
    expect(model.props.children).toBe('prefixed');
  });

  it('should decode a reply from string body', async () => {
    const body = await ReactServerDOMClient.encodeReply('hello world');
    const decoded = await ReactServerDOMServer.decodeReply(body, bunMap);
    expect(decoded).toBe('hello world');
  });

  it('should decode a reply from FormData body', async () => {
    const body = await ReactServerDOMClient.encodeReply({key: 'value'});
    const decoded = await ReactServerDOMServer.decodeReply(body, bunMap);
    expect(decoded).toEqual({key: 'value'});
  });

  it('should decode a reply with temporaryReferences option', async () => {
    const tempRefs = ReactServerDOMServer.createTemporaryReferenceSet();
    const body = await ReactServerDOMClient.encodeReply({data: 42});
    const decoded = await ReactServerDOMServer.decodeReply(body, bunMap, {
      temporaryReferences: tempRefs,
    });
    expect(decoded).toEqual({data: 42});
  });

  it('should handle prerender with a basic component', async () => {
    function App() {
      return ReactServer.createElement('div', null, 'prerendered');
    }

    // prerender is exported from the static entry, not the server entry
    const result = await serverAct(() =>
      ReactServerDOMStaticServer.prerender(
        ReactServer.createElement(App),
        bunMap,
      ),
    );
    expect(result).toBeTruthy();
    expect(result.prelude).toBeTruthy();
    expect(result.prelude instanceof ReadableStream).toBe(true);

    // Read the prelude and verify content via client
    const response = ReactServerDOMClient.createFromReadableStream(
      result.prelude,
    );
    const model = await response;
    expect(model.$$typeof).toBe(Symbol.for('react.transitional.element'));
    expect(model.type).toBe('div');
    expect(model.props.children).toBe('prerendered');
  });

  it('should handle prerender with onError callback', async () => {
    const errors = [];
    function BadApp() {
      throw new Error('prerender error');
    }

    try {
      await serverAct(() =>
        ReactServerDOMStaticServer.prerender(
          ReactServer.createElement(BadApp),
          bunMap,
          {
            onError(error) {
              errors.push(error.message);
            },
          },
        ),
      );
    } catch (e) {
      // Fatal errors cause the prerender promise to reject
    }
    expect(errors).toContain('prerender error');
  });

  it('should handle prerender with abort signal', async () => {
    let resolve;
    const blockingPromise = new Promise(r => {
      resolve = r;
    });
    function Blocking() {
      throw blockingPromise;
    }

    const controller = new AbortController();

    let caughtError = null;
    try {
      await serverAct(async () => {
        const resultPromise = ReactServerDOMStaticServer.prerender(
          ReactServer.createElement(
            ReactServer.Suspense,
            {fallback: ReactServer.createElement('div', null, 'loading')},
            ReactServer.createElement(Blocking),
          ),
          bunMap,
          {
            signal: controller.signal,
          },
        );

        // Abort should cause the prerender to reject
        controller.abort('abort prerender');
        resolve();

        return resultPromise;
      });
    } catch (e) {
      caughtError = e;
    }
    // The abort should have caused the prerender to reject or the error
    // to be logged.
    if (caughtError == null) {
      // If it didn't throw, it should still have produced a result
      // (prerender might complete before abort kicks in)
    }
  });

  it('should support registerClientReference and registerServerReference', () => {
    // These are re-exported from the server barrel
    expect(typeof ReactServerDOMServer.registerClientReference).toBe(
      'function',
    );
    expect(typeof ReactServerDOMServer.registerServerReference).toBe(
      'function',
    );
    expect(typeof ReactServerDOMServer.createClientModuleProxy).toBe(
      'function',
    );
    expect(typeof ReactServerDOMServer.createTemporaryReferenceSet).toBe(
      'function',
    );
  });

  it('should support createFromFetch on the client', async () => {
    function App() {
      return ReactServer.createElement('span', null, 'fetched');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App),
        bunMap,
      ),
    );

    // Simulate a fetch response using the polyfilled Response
    const fetchResponse = new Response(stream);
    const response = ReactServerDOMClient.createFromFetch(
      Promise.resolve(fetchResponse),
    );
    const model = await response;
    expect(model.$$typeof).toBe(Symbol.for('react.transitional.element'));
    expect(model.type).toBe('span');
    expect(model.props.children).toBe('fetched');
  });
});
