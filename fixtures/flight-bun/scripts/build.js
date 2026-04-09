/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Client bundle build script for the Bun Flight fixture.
//
// Bundles the client entry point (src/index.js) and all its dependencies —
// including the client component implementations (Counter, Form, Navigation),
// React, ReactDOM, and the react-server-dom-bun Flight client — into a single
// browser-ready JavaScript file at build/client.js.
//
// The __RSC_SRC_DIR__ define injects the absolute path to the fixture's src/
// directory so the client-side module cache keys match the absolute file paths
// that the region server serializes into the Flight stream.
//
// Run with: bun run scripts/build.js

import path from 'path';
import {rmSync, existsSync} from 'node:fs';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------
const rootDir = path.resolve(import.meta.dir, '..');
const srcDir = path.resolve(rootDir, 'src');
const buildDir = path.resolve(rootDir, 'build');
const entryPoint = path.resolve(srcDir, 'index.js');

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
console.log('  SrcDir: ' + srcDir);

// ---------------------------------------------------------------------------
// Execute Bun.build()
// ---------------------------------------------------------------------------
// The client entry point (src/index.js) uses require() to import client
// components and React packages. Bun.build() resolves and bundles all
// dependencies into a single output file.
//
// Key configuration:
// - target: 'browser' — produces browser-compatible output
// - define.__RSC_SRC_DIR__: Injects the absolute src/ path as a string
//   constant so the client-side module cache keys match the region server's
//   manifest keys (which are absolute file paths)
// - naming.entry: 'client.[ext]' — produces build/client.js matching the
//   HTML shell's <script src="/static/client.js"> reference
// ---------------------------------------------------------------------------
const result = await Bun.build({
  entrypoints: [entryPoint],
  outdir: buildDir,
  target: 'browser',
  format: 'esm',
  minify: isProduction,
  sourcemap: isProduction ? 'external' : 'none',
  define: {
    '__RSC_SRC_DIR__': JSON.stringify(srcDir),
  },
  naming: {
    entry: 'client.[ext]',
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
// Log build output
// ---------------------------------------------------------------------------
console.log('Client build completed successfully.');
for (const artifact of result.outputs) {
  const sizeKB = (artifact.size / 1024).toFixed(2);
  console.log('  ' + path.basename(artifact.path) + ' (' + sizeKB + ' KB)');
}
