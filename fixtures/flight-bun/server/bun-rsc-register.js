/**
 * Bun Runtime Plugin for React Server Components.
 *
 * This module registers a Bun runtime plugin that intercepts module loading
 * for files containing 'use client' or 'use server' directives. It replaces
 * client modules with Flight client reference proxies and annotates server
 * modules with server reference registrations.
 *
 * This is the Bun equivalent of the Node.js ESM loaders used by the other
 * flight fixtures (e.g. fixtures/flight/loader/region.js) and the
 * react-server-dom-esm/node-loader module.
 *
 * Usage: Import this module at the top of the server entry point BEFORE any
 * dynamic imports of application source code.
 *
 * @see packages/react-server-dom-esm/src/ReactFlightESMNodeLoader.js
 */

import {readFileSync} from 'node:fs';
import {plugin} from 'bun';
import {resolve, dirname} from 'node:path';

// ---------------------------------------------------------------------------
// Directive Detection Helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether a source file starts with a given directive string.
 * Handles both single-quoted and double-quoted forms, and skips leading
 * whitespace / hashbang lines.
 *
 * According to the ECMAScript spec, directives must be expression statements
 * consisting of a single string literal, appearing before any other statements.
 * A 'use client' or 'use server' directive MUST be the very first statement
 * (after optional hashbang and whitespace).
 */
function getDirective(source) {
  // Strip leading BOM, hashbang, and whitespace.
  let trimmed = source;
  if (trimmed.charCodeAt(0) === 0xfeff) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.startsWith('#!')) {
    const newline = trimmed.indexOf('\n');
    trimmed = newline === -1 ? '' : trimmed.slice(newline + 1);
  }
  trimmed = trimmed.trimStart();

  // Check for 'use client' or "use client"
  if (
    trimmed.startsWith("'use client'") ||
    trimmed.startsWith('"use client"')
  ) {
    return 'use client';
  }
  if (
    trimmed.startsWith("'use server'") ||
    trimmed.startsWith('"use server"')
  ) {
    return 'use server';
  }
  return null;
}

/**
 * Extracts exported names from a source file using simple regex matching.
 *
 * This handles the common export patterns used in the fixture's source files:
 *   - export default function Foo() { ... }
 *   - export default class Foo { ... }
 *   - export default <expr>
 *   - export function foo() { ... }
 *   - export async function foo() { ... }
 *   - export class Foo { ... }
 *   - export const foo = ..., bar = ...
 *   - export let foo = ...
 *   - export var foo = ...
 *
 * It does NOT handle re-exports (export { ... } from '...') or
 * export * — those are uncommon in client component files.
 */
function parseExportNames(source) {
  const names = [];

  // Match export default
  if (/\bexport\s+default\b/.test(source)) {
    names.push('default');
  }

  // Match named exports: export [async] function/class name
  const namedFuncRegex =
    /\bexport\s+(?:async\s+)?(?:function\s*\*?\s*|class\s+)(\w+)/g;
  let match;
  while ((match = namedFuncRegex.exec(source)) !== null) {
    if (match[1] && !names.includes(match[1])) {
      names.push(match[1]);
    }
  }

  // Match named exports: export const/let/var name
  const namedVarRegex = /\bexport\s+(?:const|let|var)\s+(\w+)/g;
  while ((match = namedVarRegex.exec(source)) !== null) {
    if (match[1] && !names.includes(match[1])) {
      names.push(match[1]);
    }
  }

  return names;
}

// ---------------------------------------------------------------------------
// Source Transformations
// ---------------------------------------------------------------------------

/**
 * Transforms a 'use client' module into client reference proxies.
 *
 * The original source is entirely replaced with registerClientReference()
 * calls for each export. This prevents client-side code from executing on
 * the server. The Flight serializer knows how to serialize these references
 * into module IDs that the client can resolve.
 *
 * @see packages/react-server-dom-esm/src/ReactFlightESMNodeLoader.js transformClientModule
 */
function transformClientModule(source, filePath) {
  const names = parseExportNames(source);
  if (names.length === 0) {
    return '';
  }

  // Use the explicit server.browser entry point so this works without
  // --conditions=react-server.
  let newSrc =
    'import {registerClientReference} from "react-server-dom-bun/server.browser";\n';

  for (const name of names) {
    const errorMessage =
      name === 'default'
        ? `Attempted to call the default export of ${filePath} from the server ` +
          `but it's on the client. It's not possible to invoke a client function from ` +
          `the server, it can only be rendered as a Component or passed to props of a ` +
          `Client Component.`
        : `Attempted to call ${name}() from the server but ${name} is on the client. ` +
          `It's not possible to invoke a client function from the server, it can ` +
          `only be rendered as a Component or passed to props of a Client Component.`;

    if (name === 'default') {
      newSrc += 'export default ';
    } else {
      newSrc += 'export const ' + name + ' = ';
    }
    newSrc += 'registerClientReference(function() {';
    newSrc += 'throw new Error(' + JSON.stringify(errorMessage) + ');';
    newSrc += '},';
    newSrc += JSON.stringify(filePath) + ',';
    newSrc += JSON.stringify(name) + ');\n';
  }

  return newSrc;
}

/**
 * Transforms a 'use server' module by appending registerServerReference()
 * calls for each exported function.
 *
 * Unlike client modules, the original source is KEPT — server functions
 * need to actually execute on the server. The registerServerReference()
 * annotations add $$typeof / $$id / $$bound metadata so the Flight
 * serializer can serialize references to these functions for the client.
 *
 * @see packages/react-server-dom-esm/src/ReactFlightESMNodeLoader.js transformServerModule
 */
function transformServerModule(source, filePath) {
  const names = parseExportNames(source);
  if (names.length === 0) {
    return source;
  }

  // Append registration calls after the original source code.
  let newSrc = source + '\n';
  newSrc +=
    'import {registerServerReference as $$RSR} from "react-server-dom-bun/server.browser";\n';

  for (const name of names) {
    if (name === 'default') {
      // For default exports we can't easily re-reference them after the fact.
      // Skip — the build step handles default server reference registration.
      continue;
    }
    newSrc +=
      '$$RSR(' +
      name +
      ', ' +
      JSON.stringify(filePath) +
      ', ' +
      JSON.stringify(name) +
      ');\n';
  }

  return newSrc;
}

// ---------------------------------------------------------------------------
// Bun Runtime Plugin Registration
// ---------------------------------------------------------------------------

// Resolve the fixture src/ directory so we only intercept application files,
// not node_modules or server infrastructure.
const fixtureRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const srcDir = resolve(fixtureRoot, 'src');

plugin({
  name: 'react-server-components',
  setup(build) {
    // Intercept .js files under the fixture's src/ directory.
    // We build a regex from the escaped srcDir path so the filter
    // only fires for application source files, not node_modules.
    const escapedSrcDir = srcDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const srcFilter = new RegExp(escapedSrcDir + '.*\\.js$');

    build.onLoad({filter: srcFilter}, args => {
      let source;
      try {
        source = readFileSync(args.path, 'utf8');
      } catch (e) {
        // On read error, return empty contents so Bun continues.
        return {contents: '', loader: 'jsx'};
      }

      const directive = getDirective(source);

      if (directive === 'use client') {
        // Transformed client modules contain no JSX (only registerClientReference
        // calls), but we use 'jsx' loader for consistency.
        const transformed = transformClientModule(source, args.path);
        return {contents: transformed, loader: 'jsx'};
      }

      if (directive === 'use server') {
        // Transformed server modules retain the original source (which may
        // contain JSX) plus appended registerServerReference calls.
        const transformed = transformServerModule(source, args.path);
        return {contents: transformed, loader: 'jsx'};
      }

      // No directive — return the original source unchanged.
      // CRITICAL: Must use 'jsx' loader because fixture .js files contain JSX
      // syntax (React elements). Using 'js' would cause Bun to fail on JSX.
      return {contents: source, loader: 'jsx'};
    });
  },
});
