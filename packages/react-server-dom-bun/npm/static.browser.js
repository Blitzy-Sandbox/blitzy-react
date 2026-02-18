'use strict';

var s;
if (process.env.NODE_ENV === 'production') {
  s = require('./cjs/react-server-dom-bun-server.browser.production.js');
} else {
  s = require('./cjs/react-server-dom-bun-server.browser.development.js');
}

exports.prerender = s.prerender;
