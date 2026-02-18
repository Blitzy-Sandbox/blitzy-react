/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Client bundle build script for the Bun Flight fixture.
// Uses Bun.build() API with the RSC plugin from react-server-dom-bun/plugin
// for 'use client' / 'use server' directive detection and manifest generation.
//
// Run with: bun run scripts/build.js

import path from 'path';
import {rmSync, existsSync, writeFileSync} from 'node:fs';
import {bunReactServerComponentsPlugin} from 'react-server-dom-bun/plugin';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
// import.meta.dir is the Bun-native equivalent of __dirname. It returns the
// directory of the currently executing script without requiring a CommonJS
// environment.
const rootDir = path.resolve(import.meta.dir, '..');
const srcDir = path.join(rootDir, 'src');
const buildDir = path.join(rootDir, 'build');
const entryPoint = path.join(srcDir, 'index.js');

const isProduction = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Clean previous build artifacts
// ---------------------------------------------------------------------------
if (existsSync(buildDir)) {
  rmSync(buildDir, {recursive: true, force: true});
  console.log('Cleaned previous build directory.');
}

console.log('Building client bundle...');
console.log('  Entry:  ' + entryPoint);
console.log('  Output: ' + buildDir);
console.log('  Mode:   ' + (isProduction ? 'production' : 'development'));

// ---------------------------------------------------------------------------
// Execute Bun.build()
// ---------------------------------------------------------------------------
// Bun.build() is the Bun-native bundler API. It returns a Promise that
// resolves to a BuildOutput containing:
//   - success  : boolean – whether the build completed without errors
//   - outputs  : BuildArtifact[] – emitted files with path, kind, and size
//   - logs     : BuildMessage[] – warnings and errors from the build
//
// The bunReactServerComponentsPlugin() integrates with onResolve/onLoad hooks
// to detect 'use client' and 'use server' directives, replace client modules
// with reference proxies, annotate server modules with reference metadata, and
// write react-client-manifest.json, react-server-manifest.json, and
// react-ssr-manifest.json into the output directory.
//
// The naming.entry option maps the entry point output to 'client.[ext]' so
// the produced bundle is build/client.js — matching the path expected by
// public/index.html (<script src="/static/client.js">) and the server's
// fallback bootstrap script resolution.
// ---------------------------------------------------------------------------
const result = await Bun.build({
  entrypoints: [entryPoint],
  outdir: buildDir,
  target: 'browser',
  format: 'esm',
  splitting: true,
  plugins: [bunReactServerComponentsPlugin()],
  minify: isProduction,
  sourcemap: 'external',
  naming: {
    entry: 'client.[ext]',
    chunk: '[name]-[hash].[ext]',
    asset: '[name]-[hash].[ext]',
  },
});

// ---------------------------------------------------------------------------
// Handle build result
// ---------------------------------------------------------------------------
if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write entrypoint manifest
// ---------------------------------------------------------------------------
// The server reads build/entrypoint-manifest.json to discover bootstrap
// script paths. This allows the server to inject the correct <script> tag
// into SSR-rendered HTML without hardcoding the filename.
const entryArtifacts = result.outputs.filter(a => a.kind === 'entry-point');
const mainEntry = entryArtifacts.length > 0
  ? '/static/' + path.basename(entryArtifacts[0].path)
  : '/static/client.js';

const manifestPath = path.join(buildDir, 'entrypoint-manifest.json');
const entrypointManifest = {main: mainEntry};
writeFileSync(manifestPath, JSON.stringify(entrypointManifest, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Log build output
// ---------------------------------------------------------------------------
console.log('Client build completed successfully.');
console.log('Output directory: ' + buildDir);
for (const artifact of result.outputs) {
  console.log('  ' + artifact.path + ' (' + artifact.kind + ')');
}
console.log('Entrypoint manifest: ' + manifestPath);
