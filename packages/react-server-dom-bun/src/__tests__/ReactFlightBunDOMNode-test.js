/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {patchSetImmediate} from '../../../../scripts/jest/patchSetImmediate';

// Polyfill ReadableStream/WritableStream for Node jest environment where not available
if (typeof ReadableStream === 'undefined') {
  global.ReadableStream =
    require('web-streams-polyfill/ponyfill/es6').ReadableStream;
}
if (typeof WritableStream === 'undefined') {
  global.WritableStream =
    require('web-streams-polyfill/ponyfill/es6').WritableStream;
}
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = require('util').TextEncoder;
}
if (typeof TextDecoder === 'undefined') {
  global.TextDecoder = require('util').TextDecoder;
}

let clientExports;
let bunMap;
let bunModules;
let bunModuleLoading;
let React;
let ReactDOMServer;
let ReactServer;
let ReactServerDOMServer;
let ReactServerDOMStaticServer;
let ReactServerDOMClient;
let Stream;
let use;
let serverAct;
let assertConsoleErrorDev;

const streamOptions = {
  objectMode: true,
};

describe('ReactFlightBunDOMNode', () => {
  beforeEach(() => {
    jest.resetModules();

    patchSetImmediate();
    serverAct = require('internal-test-utils').serverAct;

    // Simulate the condition resolution
    jest.mock('react', () => require('react/react.react-server'));
    jest.mock('react-server-dom-bun/server', () =>
      require('react-server-dom-bun/server.node'),
    );
    ReactServer = require('react');
    ReactServerDOMServer = require('react-server-dom-bun/server');
    jest.mock('react-server-dom-bun/static', () =>
      jest.requireActual('react-server-dom-bun/static.node'),
    );
    ReactServerDOMStaticServer = require('react-server-dom-bun/static');

    const BunMock = require('./utils/BunMock');
    clientExports = BunMock.clientExports;
    bunMap = BunMock.bunMap;
    bunModules = BunMock.bunModules;
    bunModuleLoading = BunMock.moduleLoading;

    jest.resetModules();
    __unmockReact();
    jest.unmock('react-server-dom-bun/server');
    jest.mock('react-server-dom-bun/client', () =>
      require('react-server-dom-bun/client.node'),
    );

    React = require('react');
    ReactDOMServer = require('react-dom/server.node');
    ReactServerDOMClient = require('react-server-dom-bun/client');
    Stream = require('stream');
    use = React.use;

    const InternalTestUtils = require('internal-test-utils');
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  function readResult(stream) {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const writable = new Stream.PassThrough();
      writable.setEncoding('utf8');
      writable.on('data', chunk => {
        buffer += chunk;
      });
      writable.on('error', error => {
        reject(error);
      });
      writable.on('end', () => {
        resolve(buffer);
      });
      stream.pipe(writable);
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

  function createDelayedStream() {
    let resolveDelayedStream;
    const promise = new Promise(resolve => (resolveDelayedStream = resolve));
    const delayedStream = new Stream.Transform({
      ...streamOptions,
      transform(chunk, encoding, callback) {
        // Artificially delay pushing the chunk.
        promise.then(() => {
          this.push(chunk);
          callback();
        });
      },
    });
    return {delayedStream, resolveDelayedStream};
  }

  it('should allow an alternative module mapping to be used for SSR', async () => {
    function ClientComponent() {
      return <span>Client Component</span>;
    }
    // The Client build may not have the same IDs as the Server bundles for the same
    // component.
    const ClientComponentOnTheClient = clientExports(
      ClientComponent,
      'path/to/chunk.js',
    );
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
      ReactServerDOMServer.renderToPipeableStream(<App />, bunMap),
    );
    const readable = new Stream.PassThrough();

    stream.pipe(readable);

    let response;
    function ClientRoot() {
      if (!response) {
        response = ReactServerDOMClient.createFromNodeStream(readable, {
          moduleMap: translationMap,
          moduleLoading: bunModuleLoading,
        });
      }
      return use(response);
    }

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToPipeableStream(<ClientRoot />),
    );
    const result = await readResult(ssrStream);
    expect(result).toEqual(
      '<script src="/prefix/path/to/chunk.js" async=""></script><span>Client Component</span>',
    );
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

    const debugReadable = new Stream.PassThrough(streamOptions);

    const rscStream = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {
          debugChannel: new Stream.Writable({
            write(chunk, encoding, callback) {
              debugReadable.write(chunk, encoding);
              callback();
            },
            final() {
              debugReadable.end();
            },
          }),
        },
      ),
    );

    // Create a delayed stream to simulate that the RSC stream might be
    // transported slower than the debug channel, which must not lead to a
    // `Connection closed` error in the Flight client.
    const {delayedStream, resolveDelayedStream} = createDelayedStream();

    rscStream.pipe(delayedStream);

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

    const response = ReactServerDOMClient.createFromNodeStream(
      delayedStream,
      serverConsumerManifest,
      {debugChannel: debugReadable},
    );

    setTimeout(resolveDelayedStream);

    let ownerStack;

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToPipeableStream(
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

    // Create a delayed stream to simulate that the debug stream might be
    // transported slower than the RSC stream, which must not lead to missing
    // debug info.
    const {delayedStream, resolveDelayedStream} = createDelayedStream();

    const rscStream = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {
          debugChannel: new Stream.Writable({
            write(chunk, encoding, callback) {
              delayedStream.write(chunk, encoding);
              callback();
            },
            final() {
              delayedStream.end();
            },
          }),
        },
      ),
    );

    const readable = new Stream.PassThrough(streamOptions);

    rscStream.pipe(readable);

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

    const response = ReactServerDOMClient.createFromNodeStream(
      readable,
      serverConsumerManifest,
      {debugChannel: delayedStream},
    );

    setTimeout(resolveDelayedStream);

    let ownerStack;

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToPipeableStream(
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

  it('can decode a reply with a string body via decodeReply', async () => {
    const body = JSON.stringify('test-data');
    const decoded = await ReactServerDOMServer.decodeReply(body, {});
    expect(decoded).toEqual('test-data');
  });

  it('renderToPipeableStream abort method works', async () => {
    function App() {
      return ReactServer.createElement('div', null, 'Hello');
    }

    const errors = [];
    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {
          onError(error) {
            errors.push(error);
          },
        },
      ),
    );

    stream.abort('abort-reason');
    expect(stream).toBeDefined();
  });

  it('renderToPipeableStream throws if piped twice', async () => {
    function App() {
      return ReactServer.createElement('div', null, 'Hello');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        ReactServer.createElement(App, null),
        bunMap,
      ),
    );

    const writable1 = new Stream.PassThrough(streamOptions);
    stream.pipe(writable1);

    expect(() => {
      const writable2 = new Stream.PassThrough(streamOptions);
      stream.pipe(writable2);
    }).toThrow('React currently only supports piping to one writable stream.');
  });

  it('can decode a reply from busboy stream', async () => {
    const EventEmitter = require('events');
    const mockBusboy = new EventEmitter();

    const decodedPromise = ReactServerDOMServer.decodeReplyFromBusboy(
      mockBusboy,
      {},
    );

    mockBusboy.emit('field', '0', '"busboy-test"');
    mockBusboy.emit('finish');

    const decoded = await decodedPromise;
    expect(decoded).toEqual('busboy-test');
  });

  it('rejects base64 encoded file uploads via busboy', async () => {
    const EventEmitter = require('events');
    const mockBusboy = new EventEmitter();

    let destroyError;
    mockBusboy.destroy = function (error) {
      destroyError = error;
    };

    ReactServerDOMServer.decodeReplyFromBusboy(mockBusboy, {});

    const mockFileStream = new EventEmitter();
    mockBusboy.emit('file', '0', mockFileStream, {
      filename: 'test.txt',
      encoding: 'base64',
      mimeType: 'text/plain',
    });

    expect(destroyError).toBeDefined();
    expect(destroyError.message).toContain(
      "React doesn't accept base64 encoded file uploads",
    );
  });

  it('can decode a reply with a FormData body via decodeReply', async () => {
    const body = await ReactServerDOMClient.encodeReply({some: 'object'});
    const decoded = await ReactServerDOMServer.decodeReply(body, {});
    expect(decoded).toEqual({some: 'object'});
  });

  it('should encode long string in a compact format', async () => {
    const testString = '"\n\t'.repeat(500) + '🙃';

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream({
        text: testString,
      }),
    );

    const readable = new Stream.PassThrough(streamOptions);

    const stringResult = readResult(readable);
    const parsedResult = ReactServerDOMClient.createFromNodeStream(readable, {
      moduleMap: {},
      moduleLoading: bunModuleLoading,
    });

    stream.pipe(readable);

    const serializedContent = await stringResult;
    expect(serializedContent.length).toBeLessThan(2000);
    expect(serializedContent).not.toContain('\\n');
    expect(serializedContent).not.toContain('\\t');
    expect(serializedContent).not.toContain('\\"');
    expect(serializedContent).toContain('\t');

    const result = await parsedResult;
    expect(result.text).toBe(testString);
  });

  it('should be able to serialize any kind of typed array', async () => {
    const buffer = new Uint8Array([
      123, 4, 10, 5, 100, 255, 244, 45, 56, 67, 43, 124, 67, 89, 100, 20,
    ]).buffer;
    const buffers = [
      buffer,
      new Int8Array(buffer, 1),
      new Uint8Array(buffer, 2),
      new Uint8ClampedArray(buffer, 2),
      new Int16Array(buffer, 2),
      new Uint16Array(buffer, 2),
      new Int32Array(buffer, 4),
      new Uint32Array(buffer, 4),
      new Float32Array(buffer, 4),
      new Float64Array(buffer, 0),
      new BigInt64Array(buffer, 0),
      new BigUint64Array(buffer, 0),
      new DataView(buffer, 3),
    ];

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(buffers),
    );

    const readable = new Stream.PassThrough(streamOptions);
    const parsedResult = ReactServerDOMClient.createFromNodeStream(readable, {
      moduleMap: {},
      moduleLoading: bunModuleLoading,
    });

    stream.pipe(readable);

    const result = await parsedResult;
    expect(result).toEqual(buffers);
  });

  it('should allow accept a nonce option for Flight preinitialized scripts', async () => {
    function ClientComponent() {
      return ReactServer.createElement('span', null, 'Client Component');
    }

    const ClientComponentOnTheClient = clientExports(
      ClientComponent,
      'path/to/chunk.js',
    );
    const ClientComponentOnTheServer = clientExports(ClientComponent);

    const clientId = bunMap[ClientComponentOnTheClient.$$id].id;
    delete bunModules[clientId];

    const ssrMetadata = bunMap[ClientComponentOnTheServer.$$id];
    const translationMap = {
      [clientId]: {
        '*': ssrMetadata,
      },
    };
    const serverConsumerManifest = {
      moduleMap: translationMap,
      moduleLoading: bunModuleLoading,
    };

    function App() {
      return ReactServer.createElement(ClientComponentOnTheClient, null);
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        ReactServer.createElement(App, null),
        bunMap,
      ),
    );
    const readable = new Stream.PassThrough(streamOptions);
    let response;

    stream.pipe(readable);

    function ClientRoot() {
      if (response) return use(response);
      response = ReactServerDOMClient.createFromNodeStream(
        readable,
        serverConsumerManifest,
        {nonce: 'r4nd0m'},
      );
      return use(response);
    }

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToPipeableStream(
        React.createElement(ClientRoot, null),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toEqual(
      '<script src="/prefix/path/to/chunk.js" async="" nonce="r4nd0m"></script><span>Client Component</span>',
    );
  });

  it('can handle busboy error events gracefully', async () => {
    const EventEmitter = require('events');
    const mockBusboy = new EventEmitter();

    const decodedPromise = ReactServerDOMServer.decodeReplyFromBusboy(
      mockBusboy,
      {},
    );

    // Emit an error on the busboy stream
    mockBusboy.emit('error', new Error('Busboy parse error'));

    // The promise should reject with the error
    let caughtError;
    try {
      await decodedPromise;
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError.message).toBe('Busboy parse error');
  });

  it('should support onError callback for renderToPipeableStream', async () => {
    const errors = [];
    function ThrowingComponent() {
      throw new Error('render error');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        ReactServer.createElement(ThrowingComponent, null),
        bunMap,
        {
          onError(error) {
            errors.push(error.message);
          },
        },
      ),
    );

    const readable = new Stream.PassThrough(streamOptions);
    stream.pipe(readable);

    const parsedResult = ReactServerDOMClient.createFromNodeStream(readable, {
      moduleMap: {},
      moduleLoading: bunModuleLoading,
    });

    let caughtError;
    try {
      await parsedResult;
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeDefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should register and serialize server references', async () => {
    async function myAction(formData) {
      return 'action result';
    }

    const registered = ReactServerDOMServer.registerServerReference(
      myAction,
      'my-server-action-id',
      null,
    );

    // Verify the server reference has the correct $$typeof
    expect(registered.$$typeof).toBeDefined();
    expect(registered.$$id).toBe('my-server-action-id');

    // Should be callable
    expect(typeof registered).toBe('function');
  });

  it('should create and use temporary reference sets', async () => {
    const tempRefs = ReactServerDOMServer.createTemporaryReferenceSet();
    expect(tempRefs).toBeDefined();
  });

  it('should handle decodeReply with empty string body', async () => {
    const body = '""';
    const decoded = await ReactServerDOMServer.decodeReply(body, {});
    expect(decoded).toBe('');
  });

  it('should handle decodeReply with numeric body', async () => {
    const body = '42';
    const decoded = await ReactServerDOMServer.decodeReply(body, {});
    expect(decoded).toBe(42);
  });

  it('should handle decodeReply with null body', async () => {
    const body = 'null';
    const decoded = await ReactServerDOMServer.decodeReply(body, {});
    expect(decoded).toBe(null);
  });

  it('should handle decodeReply with boolean body', async () => {
    const body = 'true';
    const decoded = await ReactServerDOMServer.decodeReply(body, {});
    expect(decoded).toBe(true);
  });

  it('should support web streams in node via renderToReadableStream', async () => {
    function Text({children}) {
      return ReactServer.createElement('span', null, children);
    }
    const largeString = 'world'.repeat(1000);
    function HTML() {
      return ReactServer.createElement(
        'div',
        null,
        ReactServer.createElement(Text, null, 'hello'),
        ReactServer.createElement(Text, null, largeString),
      );
    }

    function App() {
      return {html: ReactServer.createElement(HTML, null)};
    }

    const readable = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
      ),
    );
    const response = ReactServerDOMClient.createFromReadableStream(readable, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });
    const model = await response;
    expect(model.html.type).toBe('div');
    expect(model.html.props.children.length).toBe(2);
  });

  it('can prerenderToNodeStream', async () => {
    let resolveGreeting;
    const greetingPromise = new Promise(resolve => {
      resolveGreeting = resolve;
    });

    async function Greeting() {
      await greetingPromise;
      return 'hello world';
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
        pendingResult: ReactServerDOMStaticServer.prerenderToNodeStream(
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

    const response = ReactServerDOMClient.createFromNodeStream(prelude, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });
    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToPipeableStream(
        React.createElement(ClientRoot, {response}),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toBe('<div>hello world</div>');
  });

  it('can prerender to a web-stream based result', async () => {
    let resolveGreeting;
    const greetingPromise = new Promise(resolve => {
      resolveGreeting = resolve;
    });

    async function Greeting() {
      await greetingPromise;
      return 'prerender web';
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

    // prelude from prerender is a ReadableStream
    expect(prelude).toBeDefined();
    expect(prelude instanceof ReadableStream).toBe(true);

    const response = ReactServerDOMClient.createFromReadableStream(prelude, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });

    function ClientRoot({response: r}) {
      return use(r);
    }

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToPipeableStream(
        React.createElement(ClientRoot, {response}),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toBe('<div>prerender web</div>');
  });

  it('prerenderToNodeStream with abort signal', async () => {
    const controller = new AbortController();

    function Hanging() {
      return new Promise(() => {});
    }

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

    const errors = [];
    const {pendingResult} = await serverAct(async () => {
      return {
        pendingResult: ReactServerDOMStaticServer.prerenderToNodeStream(
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

    controller.abort('abort-prerender');
    const {prelude} = await serverAct(() => pendingResult);
    expect(errors).toEqual([]);
    expect(prelude).toBeDefined();
  });

  it('prerender with abort signal', async () => {
    const controller = new AbortController();

    function Hanging() {
      return new Promise(() => {});
    }

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

    controller.abort('abort-web-prerender');
    const {prelude} = await serverAct(() => pendingResult);
    expect(errors).toEqual([]);
    expect(prelude).toBeDefined();
    expect(prelude instanceof ReadableStream).toBe(true);
  });

  it('renderToReadableStream with abort signal in node context', async () => {
    const controller = new AbortController();

    function App() {
      return ReactServer.createElement('div', null, 'web-stream-node');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {signal: controller.signal},
      ),
    );

    expect(stream).toBeDefined();
    expect(stream instanceof ReadableStream).toBe(true);

    // Read some content
    const reader = stream.getReader();
    const {value} = await reader.read();
    expect(value).toBeDefined();
    reader.releaseLock();
  });

  it('renderToReadableStream with already-aborted signal in node context', async () => {
    const controller = new AbortController();
    controller.abort('node-pre-aborted');

    function App() {
      return ReactServer.createElement('div', null, 'aborted-node');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {signal: controller.signal},
      ),
    );

    assertConsoleErrorDev(['node-pre-aborted']);

    expect(stream).toBeDefined();
    expect(stream instanceof ReadableStream).toBe(true);
  });

  it('renderToReadableStream with onError in node context', async () => {
    const errors = [];
    function Throwing() {
      throw new Error('node-web-stream-error');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(Throwing, null),
        bunMap,
        {
          onError(error) {
            errors.push(error.message);
          },
        },
      ),
    );

    // Consume to trigger error
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe('node-web-stream-error');
  });

  it('renderToReadableStream with identifierPrefix in node context', async () => {
    function App() {
      return ReactServer.createElement('span', null, 'node-prefix');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {identifierPrefix: 'node_'},
      ),
    );

    const response = ReactServerDOMClient.createFromReadableStream(stream, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });

    function ClientRoot({response: r}) {
      return use(r);
    }

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToPipeableStream(
        React.createElement(ClientRoot, {response}),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toBe('<span>node-prefix</span>');
  });

  it('renderToReadableStream with environmentName in node context', async () => {
    function App() {
      return ReactServer.createElement('span', null, 'env-node');
    }

    const stream = await serverAct(() =>
      ReactServerDOMServer.renderToReadableStream(
        ReactServer.createElement(App, null),
        bunMap,
        {environmentName: 'node-server'},
      ),
    );

    expect(stream).toBeDefined();
    expect(stream instanceof ReadableStream).toBe(true);

    const response = ReactServerDOMClient.createFromReadableStream(stream, {
      serverConsumerManifest: {
        moduleMap: null,
        moduleLoading: null,
      },
    });

    function ClientRoot({response: r}) {
      return use(r);
    }

    const ssrStream = await serverAct(() =>
      ReactDOMServer.renderToPipeableStream(
        React.createElement(ClientRoot, {response}),
      ),
    );
    const result = await readResult(ssrStream);
    expect(result).toBe('<span>env-node</span>');
  });

  it('can handle busboy file upload with pending fields', async () => {
    const EventEmitter = require('events');
    const mockBusboy = new EventEmitter();

    const decodedPromise = ReactServerDOMServer.decodeReplyFromBusboy(
      mockBusboy,
      {},
    );

    // Simulate file data stream
    const fileStream = new EventEmitter();

    // First emit a file to set pendingFiles > 0
    mockBusboy.emit('file', 'fileField', fileStream, {
      filename: 'test.txt',
      encoding: '7bit',
      mimeType: 'text/plain',
    });

    // While file is pending, emit a field (should be queued)
    mockBusboy.emit('field', '0', '"queued-field"');

    // Finish the file
    fileStream.emit('data', Buffer.from('file-content'));
    fileStream.emit('end');

    // The queued field should now be processed
    mockBusboy.emit('finish');

    const result = await decodedPromise;
    expect(result).toBe('queued-field');
  });

  it('prerenderToNodeStream with already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort('pre-abort-nodestream');

    function App() {
      return ReactServer.createElement('div', null, 'aborted');
    }

    const errors = [];
    const {pendingResult} = await serverAct(async () => {
      return {
        pendingResult: ReactServerDOMStaticServer.prerenderToNodeStream(
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

    // prerenderToNodeStream resolves cleanly even with pre-aborted signals,
    // without emitting console errors (unlike renderToReadableStream)
    const {prelude} = await serverAct(() => pendingResult);
    expect(prelude).toBeDefined();
    // Prelude should be a Node.js Readable stream
    expect(typeof prelude.pipe).toBe('function');
  });

  it('prerender with already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort('pre-abort-prerender');

    function App() {
      return ReactServer.createElement('div', null, 'aborted');
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

    // prerender resolves cleanly even with pre-aborted signals,
    // without emitting console errors (unlike renderToReadableStream)
    const {prelude} = await serverAct(() => pendingResult);
    expect(prelude).toBeDefined();
    expect(prelude instanceof ReadableStream).toBe(true);
  });
});
