// Fake eBay (Browse + OAuth) and fake Amazon SES, with a control API.
//
// Zero dependencies. Both the backend and the frontend reach this server via
// preload/egress.cjs, which reroutes their outbound HTTPS to *.ebay.com and
// email*.amazonaws.com here. Nothing in the apps is modified.
//
//   node fakes/server.mjs            (PORT env, default 4010)
//
// Control API (all JSON unless noted):
//   GET    /__control/state                      counts + current faults
//   POST   /__control/reset                      reseed catalog, clear calls/emails/faults
//   GET    /__control/ebay/calls[?since=ms]      every Browse/OAuth call received
//   GET    /__control/ebay/items                 current inventory
//   POST   /__control/ebay/items                 add listing(s), {title, price, conditionId, seller, ...}
//   DELETE /__control/ebay/items/:itemId         end a listing
//   POST   /__control/ebay/faults                {delayMs, status, failNext, failRate, emptyResults}
//   DELETE /__control/ebay/faults
//   GET    /__control/emails[?to=&since=ms]      captured SES sends (newest last)
//   GET    /__control/emails/:id/html            the email body as a page (HTML)
//   GET    /__control/inbox                      browsable inbox (HTML)
//   GET    /__control/egress                     outbound calls the preload blocked

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { makeItem, seedCatalog } from './catalog.mjs';

const PORT = Number(process.env.PORT ?? 4010);

const state = {
  items: seedCatalog(),
  calls: [],
  emails: [],
  blocked: [],
  faults: {},
  tokenSeq: 0,
};

function reset() {
  state.items = seedCatalog();
  state.calls = [];
  state.emails = [];
  state.blocked = [];
  state.faults = {};
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string';
  res.writeHead(status, {
    'content-type': isString ? 'text/plain; charset=utf-8' : 'application/json',
    ...headers,
  });
  res.end(isString ? body : JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function publicItem(item) {
  const { _aspects, ...rest } = item;
  return rest;
}

// ---------------------------------------------------------------------------
// eBay Browse search
// ---------------------------------------------------------------------------

/** Parse eBay's filter grammar: `price:[a..b],conditionIds:{1000|3000},sellers:{x}` */
function parseFilter(raw) {
  const out = {};
  if (!raw) return out;
  // Split on commas that are not inside [] or {}.
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    const idx = p.indexOf(':');
    if (idx < 0) continue;
    const key = p.slice(0, idx).trim();
    const val = p.slice(idx + 1).trim();
    const range = val.match(/^\[(.*)\.\.(.*)\]$/);
    const set = val.match(/^\{(.*)\}$/);
    if (range) out[key] = { min: range[1] === '' ? null : Number(range[1]), max: range[2] === '' ? null : Number(range[2]) };
    else if (set) out[key] = set[1].split('|').map((s) => s.trim()).filter(Boolean);
    else out[key] = val;
  }
  return out;
}

/**
 * Keyword matching, close enough to eBay for testing: every whitespace token
 * must appear in the title (case-insensitive); `(a,b)` means a OR b; `-term`
 * excludes. Unknown syntax is treated as literal text, which is also what eBay
 * effectively does with stray punctuation.
 */
function matchesQuery(title, q) {
  const t = title.toLowerCase();
  const tokens = (q ?? '').toLowerCase().match(/-?\([^)]*\)|\S+/g) ?? [];
  for (const raw of tokens) {
    const neg = raw.startsWith('-');
    const tok = neg ? raw.slice(1) : raw;
    let hit;
    const group = tok.match(/^\((.*)\)$/);
    if (group) hit = group[1].split(',').map((s) => s.trim()).filter(Boolean).some((g) => t.includes(g));
    else hit = t.includes(tok);
    if (neg ? hit : !hit) return false;
  }
  return true;
}

function refinementsFor(items, fieldgroups) {
  const groups = new Set(fieldgroups);
  const tally = (fn) => {
    const m = new Map();
    for (const it of items) for (const k of [].concat(fn(it))) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const refinement = {};
  if (groups.has('CONDITION_REFINEMENTS')) {
    const names = Object.fromEntries(items.map((i) => [i.conditionId, i.condition]));
    refinement.conditionDistributions = tally((i) => i.conditionId).map(([id, n]) => ({ condition: names[id], conditionId: id, matchCount: n }));
  }
  if (groups.has('BUYING_OPTION_REFINEMENTS')) {
    refinement.buyingOptionDistributions = tally((i) => i.buyingOptions).map(([b, n]) => ({ buyingOption: b, matchCount: n }));
  }
  if (groups.has('CATEGORY_REFINEMENTS')) {
    const names = Object.fromEntries(items.map((i) => [i.categories[0].categoryId, i.categories[0].categoryName]));
    const cats = tally((i) => i.categories[0].categoryId);
    refinement.categoryDistributions = cats.map(([id, n]) => ({ categoryId: id, categoryName: names[id], matchCount: n }));
    if (cats.length) refinement.dominantCategoryId = cats[0][0];
  }
  if (groups.has('ASPECT_REFINEMENTS')) {
    const aspectNames = new Set(items.flatMap((i) => Object.keys(i._aspects ?? {})));
    refinement.aspectDistributions = [...aspectNames].map((name) => ({
      localizedAspectName: name,
      aspectValueDistributions: tally((i) => i._aspects?.[name] ?? []).map(([v, n]) => ({ localizedAspectValue: v, matchCount: n })),
    }));
  }
  return refinement;
}

async function handleSearch(req, res, url) {
  const q = url.searchParams.get('q') ?? '';
  const filter = parseFilter(url.searchParams.get('filter'));
  const sort = url.searchParams.get('sort');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const fieldgroups = (url.searchParams.get('fieldgroups') ?? 'MATCHING_ITEMS').split(',');

  const call = {
    at: Date.now(),
    kind: 'browse.search',
    host: req.headers['x-harness-original-host'] ?? req.headers.host,
    query: Object.fromEntries(url.searchParams),
    status: 200,
  };
  state.calls.push(call);

  const f = state.faults;
  if (f.delayMs) await sleep(f.delayMs);
  if (f.failNext > 0 || (f.failRate && Math.random() < f.failRate)) {
    if (f.failNext > 0) f.failNext -= 1;
    call.status = f.status ?? 500;
    return send(res, call.status, { errors: [{ errorId: 10001, domain: 'API_BROWSE', category: 'APPLICATION', message: 'Fake injected failure (harness)' }] });
  }
  if (!/^Bearer \S+/.test(req.headers.authorization ?? '')) {
    call.status = 401;
    return send(res, 401, { errors: [{ errorId: 1001, domain: 'OAuth', category: 'REQUEST', message: 'Invalid access token' }] });
  }

  let matched = f.emptyResults ? [] : state.items.filter((it) => matchesQuery(it.title, q));
  if (filter.price) {
    const { min, max } = filter.price;
    matched = matched.filter((it) => (min == null || Number(it.price.value) >= min) && (max == null || Number(it.price.value) <= max));
  }
  if (filter.conditionIds) matched = matched.filter((it) => filter.conditionIds.includes(it.conditionId));
  if (filter.sellers) matched = matched.filter((it) => filter.sellers.map((s) => s.toLowerCase()).includes(it.seller.username.toLowerCase()));

  if (sort === 'newlyListed') matched.sort((a, b) => b.itemCreationDate.localeCompare(a.itemCreationDate));
  else if (sort === 'price') matched.sort((a, b) => Number(a.price.value) - Number(b.price.value));
  else if (sort === '-price') matched.sort((a, b) => Number(b.price.value) - Number(a.price.value));

  const page = matched.slice(offset, offset + limit);
  call.returned = page.length;
  call.total = matched.length;

  const href = `https://api.ebay.com/buy/browse/v1/item_summary/search?${url.searchParams}`;
  const body = { href, total: matched.length, limit, offset };
  if (offset + limit < matched.length) body.next = href.replace(/offset=\d+/, '') + `&offset=${offset + limit}`;
  // Real eBay omits itemSummaries entirely when nothing matches.
  if (page.length && fieldgroups.some((g) => g === 'MATCHING_ITEMS' || g === 'EXTENDED' || g === 'FULL')) {
    body.itemSummaries = page.map(publicItem);
  }
  if (fieldgroups.some((g) => g.endsWith('_REFINEMENTS'))) body.refinement = refinementsFor(matched, fieldgroups);
  return send(res, 200, body);
}

// ---------------------------------------------------------------------------
// SES (v1 query protocol, plus v2 JSON for completeness)
// ---------------------------------------------------------------------------

function captureEmail(email) {
  const rec = { id: randomUUID(), at: Date.now(), ...email };
  state.emails.push(rec);
  console.log(`[ses] ${rec.to.join(',')} :: ${rec.subject}`);
  return rec;
}

async function handleSesV1(req, res) {
  const params = new URLSearchParams(await readBody(req));
  const action = params.get('Action');
  if (action !== 'SendEmail') {
    return send(res, 400, `<ErrorResponse><Error><Code>Unsupported</Code><Message>Harness fake supports SendEmail only, got ${escapeHtml(action)}</Message></Error></ErrorResponse>`, { 'content-type': 'text/xml' });
  }
  const list = (prefix) => [...params.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  const rec = captureEmail({
    from: params.get('Source'),
    to: list('Destination.ToAddresses.member.'),
    cc: list('Destination.CcAddresses.member.'),
    bcc: list('Destination.BccAddresses.member.'),
    subject: params.get('Message.Subject.Data'),
    html: params.get('Message.Body.Html.Data'),
    text: params.get('Message.Body.Text.Data'),
    via: 'ses-v1',
    host: req.headers['x-harness-original-host'],
  });
  const xml = `<SendEmailResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><SendEmailResult><MessageId>${rec.id}</MessageId></SendEmailResult><ResponseMetadata><RequestId>${randomUUID()}</RequestId></ResponseMetadata></SendEmailResponse>`;
  return send(res, 200, xml, { 'content-type': 'text/xml' });
}

async function handleSesV2(req, res) {
  const body = JSON.parse((await readBody(req)) || '{}');
  const simple = body.Content?.Simple ?? {};
  const rec = captureEmail({
    from: body.FromEmailAddress,
    to: body.Destination?.ToAddresses ?? [],
    cc: body.Destination?.CcAddresses ?? [],
    bcc: body.Destination?.BccAddresses ?? [],
    subject: simple.Subject?.Data,
    html: simple.Body?.Html?.Data,
    text: simple.Body?.Text?.Data,
    via: 'ses-v2',
    host: req.headers['x-harness-original-host'],
  });
  return send(res, 200, { MessageId: rec.id });
}

// ---------------------------------------------------------------------------
// control API
// ---------------------------------------------------------------------------

function inboxHtml() {
  const rows = [...state.emails].reverse().map((e) => `
    <tr><td>${new Date(e.at).toLocaleTimeString()}</td><td>${escapeHtml(e.to.join(', '))}</td>
    <td><a href="/__control/emails/${e.id}/html">${escapeHtml(e.subject)}</a></td><td>${escapeHtml(e.via)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Harness inbox</title>
  <style>body{font:14px system-ui;margin:24px}td,th{padding:6px 10px;border-bottom:1px solid #ddd;text-align:left}</style>
  <h1>Harness inbox (${state.emails.length})</h1>
  <table><tr><th>Time</th><th>To</th><th>Subject</th><th>Via</th></tr>${rows || '<tr><td colspan=4>No emails yet</td></tr>'}</table>`;
}

async function handleControl(req, res, url) {
  const p = url.pathname.replace(/^\/__control/, '');
  const since = Number(url.searchParams.get('since') ?? 0);

  if (p === '/state') {
    return send(res, 200, { items: state.items.length, calls: state.calls.length, emails: state.emails.length, blocked: state.blocked.length, faults: state.faults });
  }
  if (p === '/reset' && req.method === 'POST') {
    reset();
    return send(res, 200, { ok: true });
  }
  if (p === '/ebay/calls') {
    if (req.method === 'DELETE') { state.calls = []; return send(res, 200, { ok: true }); }
    return send(res, 200, state.calls.filter((c) => c.at >= since));
  }
  if (p === '/ebay/items') {
    if (req.method === 'POST') {
      const input = JSON.parse((await readBody(req)) || '{}');
      const created = [].concat(input).map((i) => makeItem(i));
      state.items.push(...created);
      return send(res, 201, created.map(publicItem));
    }
    return send(res, 200, state.items.map(publicItem));
  }
  const del = p.match(/^\/ebay\/items\/(.+)$/);
  if (del && req.method === 'DELETE') {
    const id = decodeURIComponent(del[1]);
    const before = state.items.length;
    state.items = state.items.filter((i) => i.itemId !== id);
    return send(res, before === state.items.length ? 404 : 200, { removed: before - state.items.length });
  }
  if (p === '/ebay/faults') {
    if (req.method === 'DELETE') { state.faults = {}; return send(res, 200, { ok: true }); }
    if (req.method === 'POST') { state.faults = { ...state.faults, ...JSON.parse((await readBody(req)) || '{}') }; return send(res, 200, state.faults); }
    return send(res, 200, state.faults);
  }
  if (p === '/emails') {
    if (req.method === 'DELETE') { state.emails = []; return send(res, 200, { ok: true }); }
    const to = url.searchParams.get('to')?.toLowerCase();
    return send(res, 200, state.emails.filter((e) => e.at >= since && (!to || e.to.some((t) => t.toLowerCase() === to))));
  }
  const html = p.match(/^\/emails\/([^/]+)\/html$/);
  if (html) {
    const e = state.emails.find((x) => x.id === html[1]);
    if (!e) return send(res, 404, 'not found');
    return send(res, 200, e.html ?? `<pre>${escapeHtml(e.text)}</pre>`, { 'content-type': 'text/html; charset=utf-8' });
  }
  if (p === '/inbox') return send(res, 200, inboxHtml(), { 'content-type': 'text/html; charset=utf-8' });
  if (p === '/egress') return send(res, 200, state.blocked);
  return send(res, 404, { error: 'unknown control route' });
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/__control')) return await handleControl(req, res, url);

    if (url.pathname === '/__egress-blocked') {
      const rec = { at: Date.now(), host: req.headers['x-harness-original-host'], method: req.method, path: url.searchParams.get('path') };
      state.blocked.push(rec);
      console.warn(`[egress] BLOCKED ${rec.method} https://${rec.host}${rec.path}`);
      return send(res, 502, { error: 'harness blocked outbound request', ...rec });
    }

    if (url.pathname === '/identity/v1/oauth2/token' && req.method === 'POST') {
      await readBody(req);
      state.calls.push({ at: Date.now(), kind: 'oauth.token', host: req.headers['x-harness-original-host'], status: 200 });
      state.tokenSeq += 1;
      return send(res, 200, { access_token: `fake-ebay-app-token-${state.tokenSeq}`, expires_in: 7200, token_type: 'Application Access Token' });
    }

    if (url.pathname === '/buy/browse/v1/item_summary/search' && req.method === 'GET') return await handleSearch(req, res, url);

    if (url.pathname.startsWith('/v2/email/outbound-emails') && req.method === 'POST') return await handleSesV2(req, res);
    if (url.pathname === '/' && req.method === 'POST' && String(req.headers['content-type']).includes('x-www-form-urlencoded')) return await handleSesV1(req, res);

    // Anything else the apps try to reach: record it so it shows up as a gap.
    state.calls.push({ at: Date.now(), kind: 'unhandled', method: req.method, host: req.headers['x-harness-original-host'], path: url.pathname, status: 404 });
    console.warn(`[fakes] unhandled ${req.method} ${req.headers['x-harness-original-host'] ?? ''}${url.pathname}`);
    return send(res, 404, { errors: [{ message: `Harness fake has no route for ${req.method} ${url.pathname}` }] });
  } catch (err) {
    console.error('[fakes] handler error', err);
    return send(res, 500, { error: String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fakes] eBay + SES fake listening on http://127.0.0.1:${PORT}  (inbox: /__control/inbox)`);
});
