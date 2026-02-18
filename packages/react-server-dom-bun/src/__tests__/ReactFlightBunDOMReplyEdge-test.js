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

let bunServerMap;
let ReactServerDOMServer;
let ReactServerDOMClient;

describe('ReactFlightDOMBunReply', () => {
  beforeEach(() => {
    jest.resetModules();
    // Simulate the condition resolution
    jest.mock('react', () => require('react/react.react-server'));
    jest.mock('react-server-dom-bun/server', () =>
      require('react-server-dom-bun/server.edge'),
    );
    const BunMock = require('./utils/BunMock');
    bunServerMap = BunMock.bunServerMap;
    ReactServerDOMServer = require('react-server-dom-bun/server.edge');
    jest.resetModules();
    ReactServerDOMClient = require('react-server-dom-bun/client.edge');
  });

  it('can encode a reply', async () => {
    const body = await ReactServerDOMClient.encodeReply({some: 'object'});
    const decoded = await ReactServerDOMServer.decodeReply(
      body,
      bunServerMap,
    );

    expect(decoded).toEqual({some: 'object'});
  });
});
