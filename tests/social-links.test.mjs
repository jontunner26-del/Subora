// Keeps the social links in step: tools/site.config.json is the one list, the build copies it into the app and the page footers.
// Run: node --test tests/social-links.test.mjs   (after: node tools/build-pages.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const cfg = JSON.parse(read('tools/site.config.json')).social;
const wanted = Object.values(cfg).filter(Boolean);

test('the app footer list matches site.config.json', () => {
  for (const f of ['index.html', 'store.html']) {
    const m = read(f).match(/SOCIAL-START\*\/(\[.*?\])\/\*SOCIAL-END/);
    assert.ok(m, f + ' has no social list');
    const urls = JSON.parse(m[1]).map(x => x[1]);
    assert.deepEqual([...urls].sort(), [...wanted].sort(), f + ' is out of date, run node tools/build-pages.mjs');
  }
});

test('the app footer renders a Follow us row with a safe external link each', () => {
  const h = read('index.html');
  assert.match(h, /<b>Follow us<\/b>/);
  assert.match(h, /target=\\"_blank\\" rel=\\"noopener noreferrer\\"|target="_blank" rel="noopener noreferrer"/);
});

test('the crawlable footers and static pages list every social link', () => {
  for (const f of ['index.html', 'store.html', 'about.html', 'contact.html', 'blog/index.html']) {
    const h = read(f);
    for (const u of wanted) assert.ok(h.includes(u), f + ' is missing ' + u);
  }
});

test('X and the WhatsApp channel are included, without share tracking parameters', () => {
  assert.equal(cfg.x, 'https://x.com/Subora_com_ng');
  assert.equal(cfg.whatsapp_channel, 'https://whatsapp.com/channel/0029Vb9utC2DDmFPJ7RmGI2f');
  assert.ok(wanted.every(u => !/[?&](s|_t|_r|cplk)=/.test(u)), 'a link still has a tracking parameter');
});
