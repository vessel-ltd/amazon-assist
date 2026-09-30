import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {amazonURL,parseMonth,parseOrderDate,parseOrders,receiptURL,parseReceipt,collectOrders,reportHTML,orderPrintURL} from '../extension/core.js';
const doc=html=>new JSDOM(html).window.document;
const id='250-1111111-2222222';
const card=(date='2026年8月31日',order=id)=>`<div class="order-card"><div class="order-header">注文日 ${date}<a href="/your-orders/invoice/popover?orderId=${order}">領収書等</a></div></div>`;
const base='https://www.amazon.co.jp/your-orders/orders?timeFilter=year-2026';
test('month boundary, descending order, duplicate order across pages',async()=>{
  const pages=[doc(card('2026年9月1日')+card()+ '<a href="?page=1">次へ →</a>'),doc(card()+card('2026年8月1日','D01-3333333-4444444')+card('2026年7月31日'))];
  const orders=await collectOrders(base,'2026-08',async()=>pages.shift(),()=>{});
  assert.deepEqual(orders.map(o=>o.day),[31,1]);assert.equal(orders[1].id,'D01-3333333-4444444');
});
test('rejects malformed month and external URL',()=>{
  assert.throws(()=>parseMonth('2026-13'));assert.throws(()=>amazonURL('https://evil.test'));assert.throws(()=>amazonURL('https://foo@www.amazon.co.jp/'));
});
test('login, challenge, unknown markup and missing order date fail closed',()=>{
  for(const html of ['<input type="password">','<input id="captchacharacters">','<h1>Oops</h1>',card('unknown')])assert.throws(()=>parseOrders(doc(html),base,'2026-08'));
  assert.equal(parseOrders(doc('0件の注文'),base,'2026-08').orders.length,0);
});
test('repeated pages are not silently treated as complete',async()=>{
  await assert.rejects(collectOrders(base,'2026-08',async()=>doc(card()+'<a href="?page=1">次へ</a>'),()=>{}),/ページ送りが繰り返/);
});
test('requires real print link in receipt menu',()=>{
  assert.throws(()=>receiptURL(doc('<a href="/invoice.pdf">適格請求書</a>'),base));
  assert.match(receiptURL(doc('<a href="/gp/css/summary/print.html?orderID=123">印刷可能な注文概要</a>'),base),/summary\/print/);
});
test('validates order identity and removes executable receipt content',()=>{
  const html=`<link rel="stylesheet" href="https://m.media-amazon.com/a.css"><div id="orderDetails"><h1>領収書</h1>${id}<script>bad()</script><div onclick="bad()">商品</div><iframe src="https://evil.test"></iframe><img src="https://evil.test/track"><a href="javascript:bad()">商品名</a><div data-component="saveButton">印刷</div></div>`;
  const receipt=parseReceipt(doc(html),{id});
  assert.doesNotMatch(receipt.html,/script|onclick|iframe|evil|javascript|saveButton/);
  assert.throws(()=>parseReceipt(doc(html),{id:'250-9999999-0000000'}));
  const report=reportHTML([receipt,receipt],'2026-08');assert.equal(doc(report).querySelectorAll('.receipt').length,2);assert.match(report,/break-before:page/);
});
test('abort prevents additional requests',async()=>{
  const abort=new AbortController();abort.abort();let count=0;
  await assert.rejects(collectOrders(base,'2026-08',()=>{count++;},()=>{},abort.signal));assert.equal(count,0);
});
test('unrelated cancelled orders and extension UI do not block a selected month',()=>{
  const html='<div class="order-card">Other extension UI</div>'+card().replace('class="order-card"','class="order-card js-order-card"')+'<div class="order-card js-order-card"><div class="order-header">注文日 2026年3月29日</div>キャンセル済み</div>';
  assert.equal(parseOrders(doc(html),base,'2026-08').orders.length,1);
  assert.throws(()=>parseOrders(doc(html),base,'2026-03'),/領収書のない注文/);
});
test('fetched order dates support English, split Japanese text, and full-width digits',()=>{
  for(const value of ['August 31, 2026','31 August 2026','Aug 31, 2026','2026 年 8 月 31 日','２０２６年８月３１日','2026年\u200e8月31日','2026/08/31']) {
    assert.deepEqual(parseOrderDate(value),{year:2026,month:8,day:31},value);
    assert.equal(parseOrders(doc(card(value)),base,'2026-08').orders.length,1,value);
  }
  assert.equal(parseOrderDate('2026年2月30日'),null);
  assert.equal(parseOrderDate('8/9/2026'),null); // Do not guess ambiguous US/EU dates.
});
test('English pagination must not silently omit subsequent pages',async()=>{
  const pages=[doc(card('September 1, 2026')+'<a href="?page=1">Next →</a>'),doc(card('August 31, 2026'))];
  const result=await collectOrders(base,'2026-08',async()=>pages.shift(),()=>{});
  assert.equal(result.length,1);assert.equal(pages.length,0);
});
test('missing invoice popover does not prevent trying the official print page',()=>{
  const html=card().replace(`/your-orders/invoice/popover?orderId=${id}`,`/your-orders/order-details?orderID=${id}`);
  const [order]=parseOrders(doc(html),base,'2026-08').orders;
  assert.equal(order.menu,null);
  assert.equal(orderPrintURL(order),`https://www.amazon.co.jp/gp/css/summary/print.html?orderID=${id}`);
  assert.throws(()=>orderPrintURL({id:'bad&orderID=other'}));
});
