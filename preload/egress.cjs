// Preloaded into the backend and frontend via NODE_OPTIONS=--require.
//
// Reroutes outbound HTTPS for eBay and Amazon SES to the local fakes server,
// and blocks every other non-local HTTPS destination so a test run can never
// spend real eBay quota, send real email, or touch production. The apps are
// not modified; this works on any branch.
//
// Covers everything built on node:https (axios, follow-redirects, the AWS SDK's
// node-http-handler, ebay-oauth-nodejs-client). It does NOT cover global
// fetch()/undici; those calls are listed by `tools/fake.mjs egress` only if
// they reach this module, so treat fetch-based egress as unguarded.
//
// HARNESS_FAKES_URL  default http://127.0.0.1:4010
// HARNESS_EGRESS     block (default) | allow   -- what to do with other hosts

'use strict';

const http = require('node:http');
const https = require('node:https');

const FAKES = new URL(process.env.HARNESS_FAKES_URL || 'http://127.0.0.1:4010');
const MODE = process.env.HARNESS_EGRESS || 'block';

const ROUTED = [/(^|\.)ebay\.com$/i, /^email(-smtp)?(\.[a-z0-9-]+)?\.amazonaws\.com$/i];
const isLocal = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');

/** Normalise the (url?, options?, callback?) overloads of https.request. */
function normalise(args) {
  let url;
  let options = {};
  let cb;
  for (const a of args) {
    if (typeof a === 'function') cb = a;
    else if (typeof a === 'string' || a instanceof URL) url = new URL(a);
    else if (a && typeof a === 'object') options = a;
  }
  const merged = { ...options };
  if (url) {
    merged.hostname = merged.hostname || url.hostname;
    merged.path = merged.path || url.pathname + url.search;
    merged.port = merged.port || url.port;
  }
  const host = String(merged.hostname || merged.host || 'localhost').replace(/:\d+$/, '');
  return { merged, host, cb };
}

function reroute(merged, host, path, cb) {
  const headers = { ...(merged.headers || {}) };
  headers['x-harness-original-host'] = host;
  const opts = {
    protocol: 'http:',
    hostname: FAKES.hostname,
    port: FAKES.port || 80,
    method: merged.method || 'GET',
    path,
    headers,
    timeout: merged.timeout,
    signal: merged.signal,
  };
  return http.request(opts, cb);
}

const originalRequest = https.request;

function patchedRequest(...args) {
  const { merged, host, cb } = normalise(args);
  if (ROUTED.some((re) => re.test(host))) {
    return reroute(merged, host, merged.path || '/', cb);
  }
  if (isLocal(host) || MODE === 'allow') return originalRequest.apply(https, args);
  const blockedPath = `/__egress-blocked?path=${encodeURIComponent(merged.path || '/')}`;
  process.emitWarning(`harness blocked outbound HTTPS to ${host}`, { code: 'HARNESS_EGRESS' });
  return reroute({ ...merged, method: merged.method || 'GET' }, host, blockedPath, cb);
}

https.request = patchedRequest;
https.get = function get(...args) {
  const req = patchedRequest(...args);
  req.end();
  return req;
};

if (process.env.HARNESS_QUIET !== '1') {
  // stderr so it never pollutes JSON log parsing on stdout.
  process.stderr.write(`[harness] egress preload active: eBay/SES -> ${FAKES.origin}, other HTTPS: ${MODE}\n`);
}
