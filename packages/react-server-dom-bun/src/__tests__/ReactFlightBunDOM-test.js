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

// Polyfills for test environment
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

let act;
let serverAct;
let use;
let clientExports;
let clientExportsESM;
let serverExports;
let bunMap;
let bunServerMap;
let Stream;
let React;
let ReactServer;
let ReactDOMClient;
let ReactServerDOMServer;
let ReactServerDOMClient;
let Suspense;
let ErrorBoundary;
let createClientModuleProxy;
let registerServerReference;
let assertConsoleErrorDev;

describe('ReactFlightBunDOM', () => {
  beforeEach(() => {
    // For this first reset we are going to load the dom-node version of react-server-dom-bun/server
    // This can be thought of as essentially being the React Server Components scope with react-server
    // condition
    jest.resetModules();

    patchSetImmediate();
    serverAct = require('internal-test-utils').serverAct;

    // Simulate the condition resolution
    jest.mock('react-server-dom-bun/server', () =>
      require('react-server-dom-bun/server.node'),
    );
    jest.mock('react', () => require('react/react.react-server'));

    const BunMock = require('./utils/BunMock');
    clientExports = BunMock.clientExports;
    clientExportsESM = BunMock.clientExportsESM;
    serverExports = BunMock.serverExports;
    bunMap = BunMock.bunMap;
    bunServerMap = BunMock.bunServerMap;

    ReactServerDOMServer = require('react-server-dom-bun/server');
    ReactServer = require('react');
    createClientModuleProxy = ReactServerDOMServer.createClientModuleProxy;
    registerServerReference = ReactServerDOMServer.registerServerReference;

    // This reset is to load modules for the SSR/Browser scope.
    jest.resetModules();
    __unmockReact();
    const testUtils = require('internal-test-utils');
    act = testUtils.act;
    assertConsoleErrorDev = testUtils.assertConsoleErrorDev;
    Stream = require('stream');
    React = require('react');
    use = React.use;
    Suspense = React.Suspense;
    ReactDOMClient = require('react-dom/client');
    ReactServerDOMClient = require('react-server-dom-bun/client');
    // Polyfill Response for createFromFetch tests
    if (typeof Response === 'undefined') {
      global.Response = require('undici').Response;
    }

    ErrorBoundary = class extends React.Component {
      state = {hasError: false, error: null};
      static getDerivedStateFromError(error) {
        return {
          hasError: true,
          error,
        };
      }
      render() {
        if (this.state.hasError) {
          return this.props.fallback(this.state.error);
        }
        return this.props.children;
      }
    };
  });

  function getTestStream() {
    const writable = new Stream.PassThrough();
    const readable = new ReadableStream({
      start(controller) {
        writable.on('data', chunk => {
          controller.enqueue(chunk);
        });
        writable.on('end', () => {
          controller.close();
        });
      },
    });
    return {
      readable,
      writable,
    };
  }

  it('should resolve HTML using Node streams', async () => {
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

    const {writable, readable} = getTestStream();
    const {pipe} = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(<App />, bunMap),
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);
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

  it('should resolve the root', async () => {
    // Model
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
    function RootModel() {
      return {
        html: <HTML />,
      };
    }

    // View
    function Message({response}) {
      return <section>{use(response).html}</section>;
    }
    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Message response={response} />
        </Suspense>
      );
    }

    const {writable, readable} = getTestStream();
    const {pipe} = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(<RootModel />, bunMap),
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe(
      '<section><div><span>hello</span><span>world</span></div></section>',
    );
  });

  it('should unwrap async module references', async () => {
    const AsyncModule = Promise.resolve(function AsyncModule({text}) {
      return 'Async: ' + text;
    });

    const AsyncModule2 = Promise.resolve({
      exportName: 'Module',
    });

    function Print({response}) {
      return <p>{use(response)}</p>;
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    const AsyncModuleRef = await clientExports(AsyncModule);
    const AsyncModuleRef2 = await clientExports(AsyncModule2);

    const {writable, readable} = getTestStream();
    const {pipe} = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        <AsyncModuleRef text={AsyncModuleRef2.exportName} />,
        bunMap,
      ),
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>Async: Module</p>');
  });

  it('should unwrap async ESM module references', async () => {
    const AsyncModule = Promise.resolve(function AsyncModule({text}) {
      return 'Async: ' + text;
    });

    const AsyncModule2 = Promise.resolve({
      exportName: 'Module',
    });

    function Print({response}) {
      return <p>{use(response)}</p>;
    }

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Print response={response} />
        </Suspense>
      );
    }

    const AsyncModuleRef = await clientExportsESM(AsyncModule);
    const AsyncModuleRef2 = await clientExportsESM(AsyncModule2);

    const {writable, readable} = getTestStream();
    const {pipe} = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        <AsyncModuleRef text={AsyncModuleRef2.exportName} />,
        bunMap,
      ),
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>Async: Module</p>');
  });

  it('should error when a bundler uses async ESM modules with createClientModuleProxy', async () => {
    const AsyncModule = Promise.resolve(function AsyncModule() {
      return 'This should not be rendered';
    });

    function Print({response}) {
      return <p>{use(response)}</p>;
    }

    function App({response}) {
      return (
        <ErrorBoundary
          fallback={error => (
            <p>
              {__DEV__ ? error.message + ' + ' : null}
              {error.digest}
            </p>
          )}>
          <Suspense fallback={<h1>Loading...</h1>}>
            <Print response={response} />
          </Suspense>
        </ErrorBoundary>
      );
    }

    const AsyncModuleRef = await clientExportsESM(AsyncModule, {
      forceClientModuleProxy: true,
    });

    const {writable, readable} = getTestStream();
    const {pipe} = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        <AsyncModuleRef />,
        bunMap,
        {
          onError(error) {
            return __DEV__ ? 'a dev digest' : `digest(${error.message})`;
          },
        },
      ),
    );
    pipe(writable);
    const response = ReactServerDOMClient.createFromReadableStream(readable);

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });

    const errorMessage = `The module "${Object.keys(bunMap).at(0)}" is marked as an async ESM module but was loaded as a CJS proxy. This is probably a bug in the React Server Components bundler.`;

    expect(container.innerHTML).toBe(
      __DEV__
        ? `<p>${errorMessage} + a dev digest</p>`
        : `<p>digest(${errorMessage})</p>`,
    );
  });

  it('should access $$typeof, $$id, and $$async on client references', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // Client module proxy should expose $$typeof, $$id, $$async
    expect(ref.$$typeof).toBeDefined();
    expect(typeof ref.$$id).toBe('string');
    expect(ref.$$async).toBe(false);
  });

  it('should return undefined for defaultProps and _debugInfo on client module proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // These are handled by getReference in the top-level proxy
    expect(ref.defaultProps).toBeUndefined();
    expect(ref._debugInfo).toBeUndefined();
    expect(ref.toJSON).toBeUndefined();
  });

  it('should return undefined for displayName on deep proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // Deep proxy: access a named sub-export first
    const namedRef = ref.SomeExport;
    // deepProxyHandlers returns undefined for displayName, defaultProps, _debugInfo, toJSON
    expect(namedRef.displayName).toBeUndefined();
    expect(namedRef.defaultProps).toBeUndefined();
    expect(namedRef._debugInfo).toBeUndefined();
    expect(namedRef.toJSON).toBeUndefined();
  });

  it('should throw when accessing Provider on a deep proxy client reference', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // Access a named sub-export to get a deep proxy
    const namedRef = ref.SomeChild;
    expect(() => namedRef.Provider).toThrow(
      'Cannot render a Client Context Provider on the Server.',
    );
  });

  it('should throw when accessing then on a sync client reference deep proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // Access a named sub-export which creates a deep proxy
    const namedRef = ref.SomeExport;
    expect(() => namedRef.then).toThrow(
      'Cannot await or return from a thenable.',
    );
  });

  it('should throw when trying to set on client module proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    expect(() => {
      ref.something = 'value';
    }).toThrow('Cannot assign to a client module from a server module.');
  });

  it('should throw when trying to set on deep proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    const namedRef = ref.SomeExport;
    expect(() => {
      namedRef.x = 'value';
    }).toThrow('Cannot assign to a client module from a server module.');
  });

  it('should support getOwnPropertyDescriptor on client module proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // getOwnPropertyDescriptor for $$typeof should work directly on target
    const typeofDesc = Object.getOwnPropertyDescriptor(ref, '$$typeof');
    expect(typeofDesc).toBeDefined();
    // For a named export, it creates and caches the reference
    const desc = Object.getOwnPropertyDescriptor(ref, 'SomeExport');
    expect(desc).toBeDefined();
    expect(desc.writable).toBe(false);
    expect(desc.configurable).toBe(false);
    expect(desc.enumerable).toBe(false);
  });

  it('should pretend to be a Promise via getPrototypeOf', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    expect(Object.getPrototypeOf(ref)).toBe(Promise.prototype);
  });

  it('should support __esModule on client module proxy then accessor', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // Accessing __esModule should return true and set up default
    const esm = ref.__esModule;
    expect(esm).toBe(true);
    expect(ref.default).toBeDefined();
    expect(ref.default.$$id).toContain('#');
  });

  it('should support then accessor for non-async client references', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // For sync modules, 'then' should register a client reference
    const thenRef = ref.then;
    expect(typeof thenRef).toBe('function');
    expect(ref.status).toBe('fulfilled');
    expect(ref.value).toBeDefined();
    // Subsequent accesses should return cached value
    expect(ref.then).toBe(thenRef);
  });

  it('should throw for Symbol property access on top-level proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    // Top-level proxy getReference throws for unknown symbols
    expect(() => ref[Symbol.for('testSymbol')]).toThrow(
      'Cannot read Symbol exports.',
    );
  });

  it('should return Symbol.toPrimitive and Symbol.toStringTag from deep proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    const namedRef = ref.SomeExport;
    // These built-in symbols have special handling in deepProxyHandlers
    expect(namedRef[Symbol.toPrimitive]).toBe(
      Object.prototype[Symbol.toPrimitive],
    );
    expect(namedRef[Symbol.toStringTag]).toBe(
      Object.prototype[Symbol.toStringTag],
    );
  });

  it('should throw for arbitrary property access on deep proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    const namedRef = ref.SomeExport;
    // Accessing a sub-property on a named export deep proxy throws
    expect(() => namedRef.someSubProp).toThrow(
      'Cannot access',
    );
  });

  it('should cache named exports on client module proxy', async () => {
    function MyComponent() {
      return <span>hi</span>;
    }
    const ref = clientExports(MyComponent);
    const first = ref.myExport;
    const second = ref.myExport;
    expect(first).toBe(second);
  });

  it('should register and use server references with bind', async () => {
    function greet(name) {
      return 'Hello ' + name;
    }
    const ServerModule = serverExports({greet});
    const greetRef = ServerModule.greet;
    // Server references should have $$typeof, $$id
    expect(greetRef.$$typeof).toBeDefined();
    expect(greetRef.$$id).toBeDefined();
    // bind should preserve server reference properties
    const boundGreet = greetRef.bind(null, 'World');
    expect(boundGreet.$$typeof).toBeDefined();
    expect(boundGreet.$$id).toBe(greetRef.$$id);
    expect(boundGreet.$$bound).toEqual(['World']);
  });

  it('should chain bind on server references', async () => {
    function add(a, b, c) {
      return a + b + c;
    }
    const ServerModule = serverExports({add});
    const addRef = ServerModule.add;
    const bound1 = addRef.bind(null, 1);
    expect(bound1.$$bound).toEqual([1]);
    const bound2 = bound1.bind(null, 2);
    expect(bound2.$$bound).toEqual([1, 2]);
  });

  // @gate __DEV__
  it('should warn when binding this on server references in dev', async () => {
    function myAction() {}
    const ServerModule = serverExports({myAction});
    const ref = ServerModule.myAction;
    // In dev, binding a non-null 'this' triggers a console.error warning
    ref.bind({someThis: true});
    assertConsoleErrorDev([
      'Cannot bind "this" of a Server Action. Pass null or undefined as the first argument to .bind().',
    ]);
  });

  it('server reference toString should return placeholder', async () => {
    function myAction() {
      return 'result';
    }
    const ServerModule = serverExports({myAction});
    expect(ServerModule.myAction.toString()).toBe(
      'function () { [omitted code] }',
    );
  });

  it('should register a server reference for a function module export', async () => {
    function directExport() {
      return 'direct';
    }
    const mod = serverExports(directExport);
    expect(mod.$$typeof).toBeDefined();
    expect(mod.$$id).toBeDefined();
    expect(mod.$$bound).toBe(null);
  });

  it('should support createClientModuleProxy', async () => {
    const proxy = createClientModuleProxy('test-module-id');
    expect(proxy.$$typeof).toBeDefined();
    expect(proxy.$$id).toBe('test-module-id');
    expect(proxy.$$async).toBe(false);
    // Named export access
    const named = proxy.someExport;
    expect(named).toBeDefined();
    expect(named.$$id).toContain('#someExport');
  });

  it('should handle createFromFetch', async () => {
    function Greeting() {
      return <div>Hello from createFromFetch</div>;
    }

    const {writable, readable} = getTestStream();
    const {pipe} = await serverAct(() =>
      ReactServerDOMServer.renderToPipeableStream(
        <Greeting />,
        bunMap,
      ),
    );
    pipe(writable);

    // Create a mock fetch response
    const fetchPromise = Promise.resolve(new Response(readable));
    const response = ReactServerDOMClient.createFromFetch(fetchPromise);

    function App({response}) {
      return (
        <Suspense fallback={<h1>Loading...</h1>}>
          <Message response={response} />
        </Suspense>
      );
    }
    function Message({response}) {
      return use(response);
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<div>Hello from createFromFetch</div>');
  });

  it('should handle createFromFetch rejection', async () => {
    const fetchPromise = Promise.reject(new Error('Network error'));
    const response = ReactServerDOMClient.createFromFetch(fetchPromise);

    function App({response}) {
      return (
        <ErrorBoundary
          fallback={error => <p>{error.message}</p>}>
          <Suspense fallback={<h1>Loading...</h1>}>
            <Message response={response} />
          </Suspense>
        </ErrorBoundary>
      );
    }
    function Message({response}) {
      return use(response);
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App response={response} />);
    });
    expect(container.innerHTML).toBe('<p>Network error</p>');
  });
});
