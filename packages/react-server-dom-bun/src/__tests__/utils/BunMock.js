/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

const url = require('url');

let bunModuleIdx = 0;
const bunServerModules = {};
const bunClientModules = {};
const bunErroredModules = {};
const bunServerMap = {};
const bunClientMap = {};
global.__bun_require__ = function (id) {
  if (bunErroredModules[id]) {
    throw bunErroredModules[id];
  }
  return bunClientModules[id] || bunServerModules[id];
};

const Server = require('react-server-dom-bun/server');
const registerClientReference = Server.registerClientReference;
const registerServerReference = Server.registerServerReference;
const createClientModuleProxy = Server.createClientModuleProxy;

exports.bunMap = bunClientMap;
exports.bunModules = bunClientModules;
exports.bunServerMap = bunServerMap;
exports.moduleLoading = {
  prefix: '/prefix/',
};

exports.clientExports = function clientExports(moduleExports, chunkUrl) {
  const chunks = [];
  if (chunkUrl !== undefined) {
    chunks.push(chunkUrl);
  }
  const idx = '' + bunModuleIdx++;
  bunClientModules[idx] = moduleExports;
  const path = url.pathToFileURL(idx).href;
  bunClientMap[path] = {
    id: idx,
    chunks,
    name: '*',
  };
  // We only add this if this test is testing ESM compat.
  if ('__esModule' in moduleExports) {
    bunClientMap[path + '#'] = {
      id: idx,
      chunks,
      name: '',
    };
  }
  if (typeof moduleExports.then === 'function') {
    moduleExports.then(
      asyncModuleExports => {
        for (const name in asyncModuleExports) {
          bunClientMap[path + '#' + name] = {
            id: idx,
            chunks,
            name: name,
          };
        }
      },
      () => {},
    );
  }
  if ('split' in moduleExports) {
    // If we're testing module splitting, we encode this name in a separate module id.
    const splitIdx = '' + bunModuleIdx++;
    bunClientModules[splitIdx] = {
      s: moduleExports.split,
    };
    bunClientMap[path + '#split'] = {
      id: splitIdx,
      chunks,
      name: 's',
    };
  }
  return createClientModuleProxy(path);
};

exports.clientExportsESM = function clientExportsESM(
  moduleExports,
  options?: {forceClientModuleProxy?: boolean} = {},
) {
  const chunks = [];
  const idx = '' + bunModuleIdx++;
  bunClientModules[idx] = moduleExports;
  const path = url.pathToFileURL(idx).href;

  const createClientReferencesForExports = ({exports, async}) => {
    bunClientMap[path] = {
      id: idx,
      chunks,
      name: '*',
      async: true,
    };

    if (options.forceClientModuleProxy) {
      return createClientModuleProxy(path);
    }

    if (typeof exports === 'object') {
      const references = {};

      for (const name in exports) {
        const id = path + '#' + name;
        bunClientMap[path + '#' + name] = {
          id: idx,
          chunks,
          name: name,
          async,
        };
        references[name] = registerClientReference(() => {}, id, name);
      }

      return references;
    }

    return registerClientReference(() => {}, path, '*');
  };

  if (
    moduleExports &&
    typeof moduleExports === 'object' &&
    typeof moduleExports.then === 'function'
  ) {
    return moduleExports.then(
      asyncModuleExports =>
        createClientReferencesForExports({
          exports: asyncModuleExports,
          async: true,
        }),
      () => {},
    );
  }

  return createClientReferencesForExports({exports: moduleExports});
};

// This tests server to server references. There's another case of client to server references.
exports.serverExports = function serverExports(moduleExports) {
  const idx = '' + bunModuleIdx++;
  bunServerModules[idx] = moduleExports;
  const path = url.pathToFileURL(idx).href;
  bunServerMap[path] = {
    id: idx,
    chunks: [],
    name: '*',
  };
  // We only add this if this test is testing ESM compat.
  if ('__esModule' in moduleExports) {
    bunServerMap[path + '#'] = {
      id: idx,
      chunks: [],
      name: '',
    };
  }
  if ('split' in moduleExports) {
    // If we're testing module splitting, we encode this name in a separate module id.
    const splitIdx = '' + bunModuleIdx++;
    bunServerModules[splitIdx] = {
      s: moduleExports.split,
    };
    bunServerMap[path + '#split'] = {
      id: splitIdx,
      chunks: [],
      name: 's',
    };
  }

  if (typeof exports === 'function') {
    // The module exports a function directly,
    registerServerReference(
      (exports: any),
      idx,
      // Represents the whole Module object instead of a particular import.
      null,
    );
  } else {
    const keys = Object.keys(exports);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = exports[keys[i]];
      if (typeof value === 'function') {
        registerServerReference((value: any), idx, key);
      }
    }
  }

  return moduleExports;
};
