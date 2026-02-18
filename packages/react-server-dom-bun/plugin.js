/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ImportManifestEntry} from './src/shared/ReactFlightImportMetadata';

const acorn = require('acorn-loose');
const path = require('path');
const fs = require('fs');
const {pathToFileURL} = require('url');

type PluginOptions = {
  clientManifestFilename?: string,
  serverManifestFilename?: string,
  ssrManifestFilename?: string,
};

type BunPlugin = {
  name: string,
  setup: (build: any) => void | Promise<void>,
};

const PLUGIN_NAME = 'react-server-dom-bun';

/**
 * The CLIENT_REFERENCE_TAG and SERVER_REFERENCE_TAG symbols must match
 * the ones used in ReactFlightBunReferences.js and in the shared Flight
 * protocol implementation. Using Symbol.for() ensures cross-module identity.
 */
const CLIENT_REFERENCE_TAG = Symbol.for('react.client.reference');
const SERVER_REFERENCE_TAG = Symbol.for('react.server.reference');

/**
 * Detect whether the given module source begins with a 'use client' or
 * 'use server' directive.  Returns the matched directive string or null
 * when neither directive is present.  The function performs a fast string
 * indexOf check before invoking the parser so modules without either
 * literal substring are skipped without allocating an AST.
 */
function detectDirective(source: string): 'use client' | 'use server' | null {
  if (
    source.indexOf('use client') === -1 &&
    source.indexOf('use server') === -1
  ) {
    return null;
  }

  let body;
  try {
    body = acorn.parse(source, {
      ecmaVersion: '2024',
      sourceType: 'module',
    }).body;
  } catch (x) {
    return null;
  }

  for (let i = 0; i < body.length; i++) {
    const node = body[i];
    if (node.type !== 'ExpressionStatement' || !node.directive) {
      break;
    }
    if (node.directive === 'use client') {
      return 'use client';
    }
    if (node.directive === 'use server') {
      return 'use server';
    }
  }

  return null;
}

/**
 * Parse all exported names from a module source using acorn-loose.
 * Handles default exports, named function/class/variable declarations,
 * and named export specifiers (re-exports).  Returns an array of export
 * name strings (e.g. ['default', 'MyComponent', 'helper']).
 */
function parseExportNames(source: string): Array<string> {
  const names: Array<string> = [];
  let ast;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: '2024',
      sourceType: 'module',
    });
  } catch (x) {
    return names;
  }

  for (let i = 0; i < ast.body.length; i++) {
    const node = ast.body[i];
    switch (node.type) {
      case 'ExportDefaultDeclaration':
        names.push('default');
        break;
      case 'ExportNamedDeclaration':
        if (node.declaration) {
          if (
            node.declaration.type === 'FunctionDeclaration' ||
            node.declaration.type === 'ClassDeclaration'
          ) {
            if (node.declaration.id && node.declaration.id.name) {
              names.push(node.declaration.id.name);
            }
          } else if (node.declaration.type === 'VariableDeclaration') {
            const declarations = node.declaration.declarations;
            for (let j = 0; j < declarations.length; j++) {
              const decl = declarations[j];
              if (decl.id && decl.id.type === 'Identifier') {
                names.push(decl.id.name);
              }
            }
          }
        }
        if (node.specifiers) {
          for (let j = 0; j < node.specifiers.length; j++) {
            const spec = node.specifiers[j];
            if (spec.exported) {
              // Handle both Identifier and Literal exported names
              const exportedName =
                spec.exported.type === 'Identifier'
                  ? spec.exported.name
                  : spec.exported.value;
              if (typeof exportedName === 'string') {
                names.push(exportedName);
              }
            }
          }
        }
        break;
      // ExportAllDeclaration ('export * from ...') does not produce
      // individually named exports at the source level so we skip it.
      // The wildcard '*' manifest entry covers these re-exports.
    }
  }

  return names;
}

/**
 * Write the client, server, and SSR manifest files to the given output
 * directory.  Creates the directory recursively if it does not exist.
 * Errors during writing are logged but do not throw to avoid crashing
 * in-progress builds.
 */
function writeManifestFiles(
  outputDir: string,
  clientManifestFilename: string,
  serverManifestFilename: string,
  ssrManifestFilename: string,
  clientManifest: {[string]: ImportManifestEntry},
  serverManifest: {[string]: ImportManifestEntry},
  ssrManifest: {
    moduleLoading: {prefix: string},
    moduleMap: {[string]: {[string]: {specifier: string, name: string}}},
  },
): void {
  try {
    const resolvedDir = path.resolve(outputDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, {recursive: true});
    }
    fs.writeFileSync(
      path.join(resolvedDir, clientManifestFilename),
      JSON.stringify(clientManifest, null, 2),
    );
    fs.writeFileSync(
      path.join(resolvedDir, serverManifestFilename),
      JSON.stringify(serverManifest, null, 2),
    );
    fs.writeFileSync(
      path.join(resolvedDir, ssrManifestFilename),
      JSON.stringify(ssrManifest, null, 2),
    );
  } catch (err) {
    console.error(
      PLUGIN_NAME + ': Failed to write manifest files: ' + err.message,
    );
  }
}

/**
 * Generate the replacement source code for a 'use client' module.
 *
 * Each named export is replaced with a client reference proxy object
 * carrying the $$typeof / $$id / $$async properties required by the
 * Flight protocol.  The module id is the file:// URL of the original
 * source file and the export name is appended after a '#' separator
 * (e.g. "file:///app/Counter.js#default").
 *
 * The generated code is pure JavaScript (no Flow annotations) because
 * it replaces the original module at build time and must be parseable
 * by any downstream tool.
 */
function generateClientProxyModule(
  moduleId: string,
  exportNames: Array<string>,
): string {
  let code = '// Auto-generated client reference proxy module\n';

  for (let i = 0; i < exportNames.length; i++) {
    const exportName = exportNames[i];
    const refId = JSON.stringify(moduleId + '#' + exportName);

    if (exportName === 'default') {
      code +=
        'var _defaultRef = Object.defineProperties(\n' +
        '  function() { throw new Error("Attempted to call the default export of ' +
        moduleId +
        ' from the server. ' +
        "Client references cannot be called on the server.\"); },\n" +
        '  {\n' +
        '    $$typeof: {value: Symbol.for("react.client.reference")},\n' +
        '    $$id: {value: ' +
        refId +
        '},\n' +
        '    $$async: {value: false}\n' +
        '  }\n' +
        ');\n' +
        'export default _defaultRef;\n';
    } else {
      code +=
        'export var ' +
        exportName +
        ' = Object.defineProperties(\n' +
        '  function() { throw new Error("Attempted to call ' +
        exportName +
        '() of ' +
        moduleId +
        ' from the server. ' +
        "Client references cannot be called on the server.\"); },\n" +
        '  {\n' +
        '    $$typeof: {value: Symbol.for("react.client.reference")},\n' +
        '    $$id: {value: ' +
        refId +
        '},\n' +
        '    $$async: {value: false}\n' +
        '  }\n' +
        ');\n';
    }
  }

  return code;
}

/**
 * Generate the replacement source code for a 'use server' module.
 *
 * The original module source is preserved so the server can actually
 * execute the functions.  Registration statements are appended that
 * annotate each exported function with $$typeof / $$id / $$bound
 * properties so the Flight serializer can encode them as server
 * references when they travel across the RSC boundary.
 */
function generateServerReferenceModule(
  moduleId: string,
  exportNames: Array<string>,
  originalSource: string,
): string {
  let code = originalSource + '\n\n// Auto-generated server reference registrations\n';

  for (let i = 0; i < exportNames.length; i++) {
    const exportName = exportNames[i];
    const refId = JSON.stringify(moduleId + '#' + exportName);

    if (exportName === 'default') {
      // Default exports are trickier because we cannot reference them by
      // variable name after the module is evaluated.  We skip inline
      // registration for defaults — the server runtime handles registration
      // of the default export via registerServerReference when the module
      // is first imported.
      continue;
    }

    code +=
      'if (typeof ' +
      exportName +
      ' === "function") {\n' +
      '  Object.defineProperties(' +
      exportName +
      ', {\n' +
      '    $$typeof: {value: Symbol.for("react.server.reference")},\n' +
      '    $$id: {value: ' +
      refId +
      ', configurable: true},\n' +
      '    $$bound: {value: null, configurable: true}\n' +
      '  });\n' +
      '}\n';
  }

  return code;
}

/**
 * Creates a Bun bundler plugin for React Server Components.
 *
 * The plugin uses Bun's `Bun.build()` plugin API with `onResolve` and
 * `onLoad` hooks (esbuild-compatible pattern) to:
 *
 * 1. Detect `'use client'` and `'use server'` directives in source files
 * 2. Replace `'use client'` modules with client reference proxies
 * 3. Annotate `'use server'` module exports with server reference metadata
 * 4. Generate client-manifest, server-manifest, and SSR-manifest JSON files
 *
 * Usage:
 *   Bun.build({ plugins: [bunReactServerComponentsPlugin()] })
 *
 * Options:
 *   clientManifestFilename — Name of the client manifest JSON file
 *                            (default: 'react-client-manifest.json')
 *   serverManifestFilename — Name of the server manifest JSON file
 *                            (default: 'react-server-manifest.json')
 *   ssrManifestFilename    — Name of the SSR manifest JSON file
 *                            (default: 'react-ssr-manifest.json')
 */
export function bunReactServerComponentsPlugin(
  options?: PluginOptions,
): BunPlugin {
  const clientManifestFilename: string =
    (options && options.clientManifestFilename) || 'react-client-manifest.json';
  const serverManifestFilename: string =
    (options && options.serverManifestFilename) || 'react-server-manifest.json';
  const ssrManifestFilename: string =
    (options && options.ssrManifestFilename) || 'react-ssr-manifest.json';

  // Manifest objects live in the plugin closure so they accumulate
  // entries across all onLoad invocations during a single build.
  const clientManifest: {[string]: ImportManifestEntry} = {};
  const serverManifest: {[string]: ImportManifestEntry} = {};
  const ssrManifest: {
    moduleLoading: {prefix: string},
    moduleMap: {[string]: {[string]: {specifier: string, name: string}}},
  } = {
    moduleLoading: {prefix: ''},
    moduleMap: {},
  };

  return {
    name: PLUGIN_NAME,
    setup(build: any): void {
      const outdir: string =
        (build.config && build.config.outdir) || './build';

      // ------------------------------------------------------------------
      // onResolve — intercept module resolution for JS/JSX/TS/TSX files.
      // We let Bun handle normal resolution and only use this hook to
      // observe which files are entering the module graph.  Returning
      // undefined signals "use default resolution".
      // ------------------------------------------------------------------
      build.onResolve(
        {filter: /\.(js|jsx|ts|tsx|mjs|cjs)$/},
        (args: {path: string, importer: string}) => {
          return undefined;
        },
      );

      // ------------------------------------------------------------------
      // onLoad — the main transformation hook.  For every JS/JSX/TS/TSX
      // file that Bun loads during bundling we:
      //   1. Read the source from disk
      //   2. Fast-check for 'use client' / 'use server' string literals
      //   3. Parse with acorn-loose to confirm the directive
      //   4. Generate replacement module code and update manifests
      // ------------------------------------------------------------------
      build.onLoad(
        {filter: /\.(js|jsx|ts|tsx|mjs|cjs)$/},
        (args: {path: string}) => {
          const filePath: string = args.path;

          // Read the original source from disk
          let source: string;
          try {
            source = fs.readFileSync(filePath, 'utf-8');
          } catch (readErr) {
            // If we cannot read the file, let Bun handle it with its
            // default loader which may resolve the file differently.
            return undefined;
          }

          // Fast path: skip files that do not contain either directive string
          const directive = detectDirective(source);
          if (directive === null) {
            return undefined;
          }

          // Build the file:// URL module identifier.  This matches how Bun
          // identifies modules internally and is used as the key in both
          // the client manifest and server manifest.
          const moduleId: string = (pathToFileURL(filePath).href: any);

          // Parse the exported names so we can generate per-export manifest
          // entries and per-export reference proxy objects.
          const exportNames: Array<string> = parseExportNames(source);

          if (directive === 'use client') {
            return processClientModule(
              moduleId,
              exportNames,
              filePath,
              outdir,
            );
          }

          if (directive === 'use server') {
            return processServerModule(
              moduleId,
              exportNames,
              source,
              outdir,
            );
          }

          // Unreachable — detectDirective only returns the two directives
          // or null (handled above).
          return undefined;
        },
      );

      // ----------------------------------------------------------------
      // processClientModule — handles a 'use client' module.
      //
      // Updates the client manifest and SSR manifest with the module's
      // export information, writes manifests to disk, and returns
      // replacement code that creates client reference proxy objects
      // instead of the original module implementation.
      // ----------------------------------------------------------------
      function processClientModule(
        moduleId: string,
        exportNames: Array<string>,
        filePath: string,
        outdir: string,
      ): {contents: string, loader: string} {
        // Compute relative chunk path from the output directory.  For Bun
        // builds the chunk is typically the bundled output file itself.
        const chunks: Array<string> = [];
        const resolvedOutdir = path.resolve(outdir);
        const relPath = path.relative(resolvedOutdir, filePath);
        if (relPath) {
          chunks.push(relPath);
        }

        // Register the wildcard manifest entry.  The server uses this to
        // resolve any export name from this module.
        clientManifest[moduleId] = {
          id: moduleId,
          chunks: chunks,
          name: '*',
        };

        // Register per-export manifest entries.  These allow the server
        // to resolve specific named exports directly.
        for (let i = 0; i < exportNames.length; i++) {
          const exportName = exportNames[i];
          const manifestKey = moduleId + '#' + exportName;
          clientManifest[manifestKey] = {
            id: moduleId,
            chunks: chunks,
            name: exportName,
          };
        }

        // Build SSR manifest entries so the server-side rendering pass
        // can locate the original module for hydration.
        const ssrExports: {[string]: {specifier: string, name: string}} = {};
        ssrExports['*'] = {
          specifier: moduleId,
          name: '*',
        };
        for (let i = 0; i < exportNames.length; i++) {
          const exportName = exportNames[i];
          ssrExports[exportName] = {
            specifier: moduleId,
            name: exportName,
          };
        }
        ssrManifest.moduleMap[moduleId] = ssrExports;

        // Persist manifests to disk after every client module discovery.
        // The last write during the build will contain the complete data.
        writeManifestFiles(
          outdir,
          clientManifestFilename,
          serverManifestFilename,
          ssrManifestFilename,
          clientManifest,
          serverManifest,
          ssrManifest,
        );

        // Generate and return the client reference proxy module
        const proxyCode = generateClientProxyModule(moduleId, exportNames);
        return {
          contents: proxyCode,
          loader: 'js',
        };
      }

      // ----------------------------------------------------------------
      // processServerModule — handles a 'use server' module.
      //
      // Updates the server manifest with the module's export information,
      // writes manifests to disk, and returns the original source code
      // with appended server reference registration statements.
      // ----------------------------------------------------------------
      function processServerModule(
        moduleId: string,
        exportNames: Array<string>,
        source: string,
        outdir: string,
      ): {contents: string, loader: string} {
        const chunks: Array<string> = [];

        // Register the wildcard manifest entry
        serverManifest[moduleId] = {
          id: moduleId,
          chunks: chunks,
          name: '*',
        };

        // Register per-export manifest entries
        for (let i = 0; i < exportNames.length; i++) {
          const exportName = exportNames[i];
          const manifestKey = moduleId + '#' + exportName;
          serverManifest[manifestKey] = {
            id: moduleId,
            chunks: chunks,
            name: exportName,
          };
        }

        // Persist manifests to disk
        writeManifestFiles(
          outdir,
          clientManifestFilename,
          serverManifestFilename,
          ssrManifestFilename,
          clientManifest,
          serverManifest,
          ssrManifest,
        );

        // Generate and return the server reference module
        const registrationCode = generateServerReferenceModule(
          moduleId,
          exportNames,
          source,
        );
        return {
          contents: registrationCode,
          loader: 'js',
        };
      }
    },
  };
}
