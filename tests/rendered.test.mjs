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
test('Amazon Fresh printable order details are captured and exclude the navbar cart',async()=>{
  const {parseReceipt,reportHTML}=await import('../extension/core.js');
  // Structure mirrors /uff/your-account/order-details/printable; all values are synthetic.
  const html=`<link rel="stylesheet" href="https://m.media-amazon.com/images/I/01+sD8W7ffL.css?AUIClients/UltraFastPrintableOrderDetailAssets">
    <header id="navbar-main"><div id="nav-flyout-ewc"><span>SYNTHETIC_CART_ITEM ￥9,999</span></div></header>
    <div id="ufpo-od-background" class="a-section"><div id="ufpo-od-main-section" class="a-section ufpo-order-details-page-only">
      <div id="printable-order-header"><h2>注文の詳細</h2><span>注文番号: ${id}</span><span>2026年10月19日 08:53に注文済み</span>
        <span id="ufpo-save-order-details-button" class="a-button do-not-print"><input type="submit"><span>注文の詳細を保存</span></span></div>
      <div id="order-summary"><h2>注文概要</h2><dl><dt>ご請求額：</dt><dd>￥7,666</dd></dl>
        <div class="pmts-payment-instrument-billing-address">SYNTHETIC_CARD 下4桁 0000</div></div>
      <div id="item-list"><h2>注文に含まれる商品 (1)</h2><img src="https://m.media-amazon.com/images/I/x._SS55_.jpg"><a href="/gp/product/B000000000">SYNTHETIC_ITEM</a> ￥213</div>
    </div></div>`;
  const live=document(html);
  const captured=captureRendered(live,'receipt',id);
  assert.equal(captured.ready,true);
  assert.doesNotMatch(captured.html,/SYNTHETIC_CART_ITEM/);
  const receipt=parseReceipt(document(captured.html),{id});
  assert.match(receipt.html,/SYNTHETIC_ITEM/);assert.match(receipt.html,/￥7,666/);
  assert.doesNotMatch(receipt.html,/注文の詳細を保存|SYNTHETIC_CART_ITEM|href=/);
  assert.equal(receipt.styles.length,1);
  const report=reportHTML([receipt],'2026-10');
  assert.match(report,/ufpo-od-main-section/);
  // Amazon's Fresh CSS gives item rows min-width:940px inside overflow-x:auto,
  // which clips the price column on A4. The report must undo both.
  assert.match(report,/\.receipt \.ufpo-item-list-table\{overflow:visible!important;max-width:none!important\}/);
  assert.match(report,/\.receipt \.ufpo-item-list-table>\.a-row,\.receipt \.ufpo-item-list-table>\.a-divider-normal\{min-width:0!important\}/);
});
test('icon-only pager links survive capture and are followed',async()=>{
  const {parseOrders}=await import('../extension/core.js');
  const live=document(`<div class="js-order-card"><div class="order-header">注文日 2026年8月31日<a href="/your-orders/invoice/popover?orderId=${id}">領収書等</a></div></div>
    <div class="a-carousel-container"><a href="#">次へ</a></div>
    <ul class="a-pagination"><li class="a-last"><a href="/your-orders/orders?timeFilter=year-2026&page=1"><span aria-hidden="true">→</span></a></li></ul>`);
  const captured=captureRendered(live,'orders');
  assert.equal(captured.ready,true);
  assert.match(parseOrders(document(captured.html),'https://www.amazon.co.jp/your-orders/orders?timeFilter=year-2026','2026-08').next,/page=1/);
  assert.throws(()=>captureRendered(document(`<div class="js-order-card"><div class="order-header">注文日 2026年8月31日</div></div><ul class="a-pagination"><li class="a-last"><a href="#">次へ</a></li></ul>`),'orders'),/次ページのリンク形式/);
});
test('a pager without .a-last survives capture',async()=>{
  const {parseOrders}=await import('../extension/core.js');
  const live=document(`<div class="js-order-card"><div class="order-header">注文日 2026年8月31日<a href="/your-orders/invoice/popover?orderId=${id}">領収書等</a></div></div><ul class="a-pagination"><li><a href="?page=2">次へ</a></li></ul>`);
  const captured=captureRendered(live,'orders');
  assert.match(parseOrders(document(captured.html),'https://www.amazon.co.jp/your-orders/orders?timeFilter=year-2026','2026-08').next,/page=2/);
});
