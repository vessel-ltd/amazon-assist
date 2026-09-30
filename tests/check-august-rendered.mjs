// Optional local verification; these HTML fixtures contain private information.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {JSDOM,VirtualConsole} from 'jsdom';
import {captureRendered} from '../extension/rendered.js';
import {parseReceipt,reportHTML,renderedText} from '../extension/core.js';
const links=JSON.parse(await fs.readFile('tmp/fixtures/print-links.json','utf8'));
const receipts=[];
for(const order of links) {
  const dom=new JSDOM(await fs.readFile(`tmp/fixtures/august/${order.id}.html`,'utf8'),{virtualConsole:new VirtualConsole()});
  Object.defineProperty(dom.window.document,'readyState',{value:'complete'});
  const result=captureRendered(dom.window.document,'receipt',order.id);
  assert.equal(result.ready,true,`${order.id}: ${result.reason}`);
  const parsed=new JSDOM(result.html,{virtualConsole:new VirtualConsole()}).window.document;
  const receipt=parseReceipt(parsed,order);
  assert.ok(renderedText(parsed.querySelector('#orderDetails')).includes(order.id));
  receipts.push(receipt);
}
const reference=execFileSync('pdftotext',['Amazon領収書_2026-08.pdf','-'],{encoding:'utf8'});
assert.deepEqual(receipts.map(r=>r.id).sort(),[...new Set(reference.match(/[A-Z0-9]{3}-\d{7}-\d{7}/g))].sort());
await fs.writeFile('tmp/fixtures/august-preview.html',reportHTML(receipts,'2026-08'));
console.log(`${receipts.length} rendered receipts passed readiness, parsing, identity and reference membership checks.`);
