import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {DiagnosticLog,errorCode,VERSION} from '../extension/diagnostics.js';
import {pageDiagnostics} from '../extension/rendered.js';
import {RenderedAmazonReader} from '../extension/worker.js';
import fs from 'node:fs/promises';
const orderId='250-1111111-2222222';

test('diagnostic serialization excludes private text, arbitrary fields and raw errors',()=>{
  const privateText='PRIVATE_ADDRESS_CARD_PRODUCT';
  const doc=new JSDOM(`<div id="orderDetails">領収書 ${orderId} ￥123 ${privateText}<div data-component="viewPaymentPlanSummaryWidget">${privateText}</div></div>`).window.document;
  const log=new DiagnosticLog('2026-09');
  log.add('page_state',{...pageDiagnostics(doc,orderId),orderId,stage:'receipt',html:doc.body.outerHTML,url:'https://example.com/?secret='+privateText,message:privateText});
  log.add('failed',{code:errorCode(new Error(privateText)),stage:privateText,orderId:privateText,readyState:privateText,amount:privateText});
  log.add(privateText,{count:1});
  const json=log.json();
  assert.doesNotMatch(json,/PRIVATE_ADDRESS_CARD_PRODUCT|outerHTML|https:|￥123/);
  const result=JSON.parse(json);
  assert.equal(result.events.length,2);
  assert.equal(result.events[0].identity,true);
  assert.equal(result.events[0].orderId,orderId);
  assert.equal(result.events[0].paymentReady,true);
  assert.equal(result.events[1].code,'unclassified');
  assert.equal(result.pdfSaveVerified,false);
});

test('timeouts retain page state and order identity without retaining page contents',async()=>{
  const log=new DiagnosticLog('2026-09');
  const tabs={create:async()=>({id:1}),get:async()=>({url:'https://www.amazon.co.jp/gp/css/summary/print.html'}),update:async()=>{},sendMessage:async()=>({ready:false,reason:'PRIVATE_BODY',diagnostic:{main:false,identity:false,readyState:'complete'}})};
  const reader=new RenderedAmazonReader(tabs,new AbortController().signal,{pollMs:1,timeoutMs:20},(event,fields)=>log.add(event,fields));
  await assert.rejects(reader.load('https://www.amazon.co.jp/gp/css/summary/print.html','receipt',orderId),/タイムアウト/);
  const events=JSON.parse(log.json()).events;
  assert.equal(events.filter(e=>e.event==='page_state').length,1);
  assert.equal(events.at(-1).code,'timeout');
  assert.equal(events.at(-1).orderId,orderId);
  assert.equal(reader.keepOpen,true);
  assert.doesNotMatch(log.json(),/PRIVATE_BODY/);
});

test('ready pages emit success; log never claims PDF saved and bounds memory',async()=>{
  globalThis.DOMParser=new JSDOM('').window.DOMParser;
  const log=new DiagnosticLog('2026-09');
  const tabs={create:async()=>({id:1}),get:async()=>({}),sendMessage:async()=>({ready:true,html:'<p>private receipt</p>',diagnostic:{main:true}})};
  const reader=new RenderedAmazonReader(tabs,new AbortController().signal,{pollMs:1,settleMs:0,timeoutMs:1000},(event,fields)=>log.add(event,fields));
  await reader.load('https://www.amazon.co.jp/gp/css/summary/print.html','receipt',orderId);
  assert.equal(log.data.events.at(-1).event,'page_ready');
  log.add('print_requested',{stage:'print'});
  assert.equal(log.data.pdfSaveVerified,false);
  for(let i=0;i<2100;i++)log.add('page_open',{index:i});
  assert.equal(log.data.events.length,2000);
  assert.ok(log.data.droppedEvents>0);
  assert.doesNotMatch(log.json(),/private receipt/);
});

test('manifest and visible version match diagnostic version',async()=>{
  const manifest=JSON.parse(await fs.readFile('extension/manifest.json','utf8'));
  assert.equal(manifest.version,VERSION);
  assert.ok((await fs.readFile('extension/app.html','utf8')).includes(`v${VERSION}`));
});

test('failed app run exposes a working diagnostic download and a new run replaces the log',async()=>{
  const html=await fs.readFile('extension/app.html','utf8');
  const source=(await fs.readFile('extension/app.js','utf8')).replace(/^import .*;\r?\n/gm,'');
  const dom=new JSDOM(html,{url:'https://example.test/app.html',runScripts:'outside-only'});
  const w=dom.window;
  let blob,download;
  w.Blob=Blob;
  w.URL.createObjectURL=value=>{blob=value;return 'blob:test';};
  w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){download=this.download;};
  w.Function('DiagnosticLog','VERSION','errorCode',source)(DiagnosticLog,VERSION,errorCode);
  const form=w.document.getElementById('export-form');
  const button=w.document.getElementById('diagnostics');
  assert.equal(button.hidden,true);
  // This exercises an actual app error route without a Chrome runtime.
  await form.onsubmit({preventDefault(){}});
  assert.equal(button.hidden,false);
  assert.equal(w.document.getElementById('export').disabled,false);
  button.click();
  assert.match(download,/^Amazon診断_.*\.json$/);
  const first=JSON.parse(await blob.text());
  assert.equal(first.events.at(-1).code,'not_extension');
  w.document.getElementById('month').value='2026-08';
  await form.onsubmit({preventDefault(){}});
  button.click();
  const second=JSON.parse(await blob.text());
  assert.equal(second.month,'2026-08');
  assert.equal(second.events.length,first.events.length);
  dom.window.close();
});
