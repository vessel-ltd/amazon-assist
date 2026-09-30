// Local-only sample with Amazon/d-point payments; not committed private data.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {parseReceipt,renderedText,reportHTML} from '../extension/core.js';
const parse=html=>new JSDOM(html,{virtualConsole:new VirtualConsole()}).window.document;
const source=parse(await fs.readFile('tmp/fixtures/receipt-september-points.html','utf8'));
const orderId=source.querySelector('#orderDetails').textContent.match(/[A-Z0-9]{3}-\d{7}-\d{7}/)[0];
const receipt=parseReceipt(source,{id:orderId});
const output=parse(receipt.html);
for(const name of ['shippingAddress','chargeSummary','viewPaymentPlanSummaryWidget']) {
  const selector=`[data-component="${name}"]`;
  assert.equal(renderedText(output.querySelector(selector)).replace(/\s/g,''),renderedText(source.querySelector(selector)).replace(/\s/g,''));
}
await fs.writeFile('tmp/fixtures/payment-layout-preview.html',reportHTML([receipt],'2026-09'));
console.log('Layout changed without altering address, payment information, or amounts.');
