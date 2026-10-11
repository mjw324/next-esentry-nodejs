// CLI for the fakes server's control API.
//
//   node tools/fake.mjs state
//   node tools/fake.mjs reset
//   node tools/fake.mjs calls [--since <ms-epoch>] [--summary]
//   node tools/fake.mjs items [--grep <text>]
//   node tools/fake.mjs add "<title>" [--price 199.99] [--condition 3000] [--seller name]
//   node tools/fake.mjs end <itemId>
//   node tools/fake.mjs fault '{"delayMs":15000}'   |  '{"failNext":3,"status":503}'  |  '{"emptyResults":true}'
//   node tools/fake.mjs clear-faults
//   node tools/fake.mjs emails [--to addr]
//   node tools/fake.mjs last-email [--to addr]      subject, recipients, text body, links
//   node tools/fake.mjs egress                       outbound HTTPS the preload blocked
import { args, fakes, FAKES } from './lib.mjs';

const a = args();
const [cmd, ...rest] = a._;
const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

switch (cmd) {
  case 'state': print(await fakes('/state')); break;
  case 'reset': print(await fakes('/reset', { method: 'POST' })); break;
  case 'calls': {
    const calls = await fakes(`/ebay/calls?since=${a.since ?? 0}`);
    if (a.summary) {
      const by = {};
      for (const c of calls) by[`${c.kind} ${c.status}`] = (by[`${c.kind} ${c.status}`] ?? 0) + 1;
      print({ total: calls.length, by });
    } else print(calls);
    break;
  }
  case 'items': {
    const items = await fakes('/ebay/items');
    const g = a.grep?.toLowerCase();
    print(items.filter((i) => !g || i.title.toLowerCase().includes(g)).map((i) => `${i.itemId}  $${i.price.value}  [${i.conditionId}]  ${i.seller.username}  ${i.title}`).join('\n'));
    break;
  }
  case 'add': {
    const body = { title: rest.join(' ') };
    if (a.price) body.price = a.price;
    if (a.condition) body.conditionId = a.condition;
    if (a.seller) body.seller = { username: a.seller, feedbackPercentage: '99.0', feedbackScore: 100 };
    print(await fakes('/ebay/items', { method: 'POST', body }));
    break;
  }
  case 'end': print(await fakes(`/ebay/items/${encodeURIComponent(rest[0])}`, { method: 'DELETE' })); break;
  case 'fault': print(await fakes('/ebay/faults', { method: 'POST', body: rest.join(' ') || '{}' })); break;
  case 'clear-faults': print(await fakes('/ebay/faults', { method: 'DELETE' })); break;
  case 'emails': {
    const emails = await fakes(`/emails${a.to ? `?to=${encodeURIComponent(a.to)}` : ''}`);
    print(emails.map((e) => `${new Date(e.at).toISOString()}  ${e.via}  to=${e.to.join(',')}  "${e.subject}"  ${FAKES}/__control/emails/${e.id}/html`).join('\n') || '(none)');
    break;
  }
  case 'last-email': {
    const emails = await fakes(`/emails${a.to ? `?to=${encodeURIComponent(a.to)}` : ''}`);
    const e = emails.at(-1);
    if (!e) { print('(none)'); break; }
    const links = [...new Set((e.html ?? e.text ?? '').match(/https?:\/\/[^\s"'<>)]+/g) ?? [])];
    print({ subject: e.subject, from: e.from, to: e.to, at: new Date(e.at).toISOString(), view: `${FAKES}/__control/emails/${e.id}/html`, links, text: e.text?.slice(0, 2000) });
    break;
  }
  case 'egress': print(await fakes('/egress')); break;
  default:
    console.error('usage: node tools/fake.mjs state|reset|calls|items|add|end|fault|clear-faults|emails|last-email|egress');
    process.exit(2);
}
