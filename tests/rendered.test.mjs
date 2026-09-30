import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import fs from 'node:fs/promises';
import {captureRendered} from '../extension/rendered.js';
import {parseOrders} from '../extension/core.js';
const id='250-1111111-2222222';
function document(html) {
  const dom=new JSDOM(html,{url:'https://www.amazon.co.jp/your-orders/orders#aa-worker=test'});
  Object.defineProperty(dom.window.document,'readyState',{value:'complete',configurable:true});
  return dom.window.document;
}
test('encrypted card waits for Amazon rendering and never skips a pending order',()=>{
  const doc=document(`<div class="js-order-card"><div class="order-header"><script>(function(payload){window.SiegeClientSideDecryption(payload)})('encrypted');</script></div></div>`);
  assert.equal(captureRendered(doc,'orders').ready,false);
  doc.querySelector('.order-header').insertAdjacentHTML('beforeend',`<span>注文日 2026年8月31日</span><a href="/your-orders/invoice/popover?orderId=${id}">領収書等</a>`);
  const result=captureRendered(doc,'orders');
  assert.equal(result.ready,true);assert.doesNotMatch(result.html,/SiegeClientSideDecryption/);
  assert.equal(parseOrders(document(result.html),'https://www.amazon.co.jp','2026-08').orders[0].id,id);
});
test('script dates cannot masquerade as a visible order date',()=>{
  const doc=document(`<div class="js-order-card"><div class="order-header"><script>const date='2026年8月31日'</script></div></div>`);
  assert.equal(captureRendered(doc,'orders').ready,false);
});
test('receipt waits for asynchronous payment and validates the actual order',()=>{
  const doc=document(`<div id="orderDetails"><h1>領収書</h1>${id}<p>￥1,234</p><div data-component="viewPaymentPlanSummaryWidget"><h5>支払い方法</h5><script>encrypted()</script></div></div>`);
  assert.equal(captureRendered(doc,'receipt',id).ready,false);
  doc.querySelector('[data-component]').insertAdjacentHTML('beforeend','<span>カード •••• 1234</span>');
  assert.equal(captureRendered(doc,'receipt',id).ready,true);
  assert.equal(captureRendered(doc,'receipt','503-9999999-0000000').ready,false);
});
test('loading, login and challenge are not interpreted as empty orders',()=>{
  const doc=document('<p>0件の注文</p>');
  Object.defineProperty(doc,'readyState',{value:'loading'});
  assert.equal(captureRendered(doc,'orders').ready,false);
  assert.throws(()=>captureRendered(document('<input type="password">'),'orders'),/ログイン/);
  assert.throws(()=>captureRendered(document('<input id="captchacharacters">'),'orders'),/確認/);
});
test('signed-in Amazon navbar contains a hidden signIn form, not a login challenge',()=>{
  const doc=document(`<form name="signIn" id="ap_navbar_form" style="display:none"><input name="metadata1" type="hidden"></form><div class="js-order-card"><div class="order-header">注文日 2026年8月31日<a href="/your-orders/invoice/popover?orderId=${id}">領収書等</a></div></div>`);
  assert.equal(captureRendered(doc,'orders').ready,true);
});
test('generated Chrome bridge checks sender and navigation token',async()=>{
  const source=await fs.readFile(new URL('../extension/reader-content.js',import.meta.url),'utf8');
  const dom=new JSDOM('<p>0件の注文</p>',{url:'https://www.amazon.co.jp/your-orders/orders#aa-worker=test',runScripts:'outside-only'});
  Object.defineProperty(dom.window.document,'readyState',{value:'complete'});
  let listener;
  dom.window.chrome={runtime:{id:'our-extension',onMessage:{addListener:f=>listener=f}}};
  dom.window.eval(source);
  let response;
  listener({type:'AA_CAPTURE',token:'test',kind:'orders'},{id:'unrelated'},r=>response=r);
  assert.equal(response,undefined);
  listener({type:'AA_CAPTURE',token:'old',kind:'orders'},{id:'our-extension'},r=>response=r);
  assert.equal(response.ready,false);
  listener({type:'AA_CAPTURE',token:'test',kind:'orders'},{id:'our-extension'},r=>response=r);
  assert.equal(response.ready,true);assert.match(response.html,/0件/);
});
