// Local integration check: actual rendered Amazon fixtures, Chrome tab/message
// API simulated in memory. No Amazon scripts, network, or credentials executed.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {RenderedAmazonReader} from '../extension/worker.js';
import {collectOrders,parseReceipt,reportHTML} from '../extension/core.js';
const source=await fs.readFile('extension/reader-content.js','utf8');
const domTools=new JSDOM('');
globalThis.DOMParser=domTools.window.DOMParser;
let current,listener,removed=false,navigations=0,polls=0;
async function navigate(url) {
  const u=new URL(url);
  const filename=u.pathname.includes('/summary/print') ? `tmp/fixtures/august/${u.searchParams.get('orderID')}.html` : `tmp/fixtures/history-${u.searchParams.get('page') || '0'}.html`;
  const html=await fs.readFile(filename,'utf8');
  current?.window.close();
  current=new JSDOM(html,{url,runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  Object.defineProperty(current.window.document,'readyState',{value:'complete'});
  current.window.chrome={runtime:{id:'test-extension',onMessage:{addListener:f=>listener=f}}};
  current.window.eval(source);navigations++;
}
const tabs={
  async create({url}) {await navigate(url);return {id:123};},
  async update(id,{url}) {if(url)await navigate(url);return {id};},
  async get(id) {return {id,url:current.window.location.href};},
  async remove(id) {assert.equal(id,123);removed=true;current.window.close();},
  async sendMessage(id,message) {polls++;let result;listener(message,{id:'test-extension'},r=>result=r);return JSON.parse(JSON.stringify(result));}
};
const controller=new AbortController();
const reader=new RenderedAmazonReader(tabs,controller.signal,{pollMs:1,settleMs:0,timeoutMs:5000});
const orders=await collectOrders('https://www.amazon.co.jp/your-orders/orders?timeFilter=year-2026','2026-08',url=>reader.load(url,'orders'),()=>{},controller.signal);
assert.equal(orders.length,16);
const receipts=[];
for(const order of orders) receipts.push(parseReceipt(await reader.load(`https://www.amazon.co.jp/gp/css/summary/print.html?orderID=${order.id}`,'receipt',order.id),order));
await reader.close();assert.equal(removed,true);
const report=reportHTML(receipts,'2026-08');
assert.equal(new JSDOM(report,{virtualConsole:new VirtualConsole()}).window.document.querySelectorAll('.receipt').length,16);
await fs.writeFile('tmp/fixtures/pipeline-preview.html',report);
console.log(`Full pipeline passed: ${navigations} navigations, ${polls} content-script messages, 16 receipts, worker tab cleanup.`);
