import {checkDocument,parseOrderDate,renderedText} from './core.js';

// Structural facts only: never include text, URLs, attributes, or payment data.
export function pageDiagnostics(doc,orderId) {
  const native=doc.querySelectorAll('.js-order-card');
  const cards=[...(native.length?native:doc.querySelectorAll('.order-card'))];
  const main=doc.querySelector('#orderDetails') || doc.querySelector('[role="main"]');
  const text=main?renderedText(main):'';
  const payment=main?.querySelector('[data-component="viewPaymentPlanSummaryWidget"]');
  return {
    readyState:doc.readyState,cards:cards.length,
    datedCards:cards.filter(c=>parseOrderDate(renderedText(c.querySelector('.order-header')||c))).length,
    invoiceLinks:doc.querySelectorAll('a[href*="/invoice/popover"]').length,
    detailLinks:doc.querySelectorAll('a[href*="order-details"]').length,
    scripts:doc.querySelectorAll('script').length,main:!!main,
    identity:!!orderId&&text.includes(orderId),heading:/領収書|購入明細書|注文概要/.test(text),
    amount:/[￥¥]\s*[\d,]+/.test(text),payment:!!payment,
    paymentReady:!!payment&&renderedText(payment).replace(/支払い方法|\s/g,'').length>0,
    login:!!doc.querySelector('input[type="password"],form[name="signIn"]:not(#ap_navbar_form),#ap_email'),
    challenge:!!doc.querySelector('#captchacharacters,form[action*="validateCaptcha"]')||/ロボットではない|文字を入力してください/.test(doc.title)
  };
}

// Called in Amazon's rendered DOM, never on a fetch() response. Amazon itself
// executes its decryption/rendering scripts; this code only reads their result.
export function captureRendered(doc, kind, orderId) {
  checkDocument(doc);
  if (doc.readyState !== 'complete') return {ready:false,reason:'Amazonのページを読み込み中です。'};
  if (kind === 'orders') {
    const native=doc.querySelectorAll('.js-order-card');
    const cards=[...(native.length ? native : doc.querySelectorAll('.order-card'))];
    if (!cards.length) {
      if (/注文はありません|注文がありません|0件の注文|注文された商品はありません|注文が見つかりません/.test(doc.body.textContent)) return {ready:true,html:'<p>0件の注文</p>'};
      return {ready:false,reason:'注文一覧の表示を待っています。'};
    }
    const headers=cards.map(c=>c.querySelector('.order-header') || c);
    if (headers.some(h=>!parseOrderDate(renderedText(h)))) return {ready:false,reason:'注文情報の復号・表示を待っています。'};
    const html=headers.map(h=>{
      const clone=h.cloneNode(true);
      clone.querySelectorAll('script,style,template,noscript').forEach(n=>n.remove());
      return `<div class="order-card js-order-card">${clone.outerHTML}</div>`;
    }).join('');
    const next=[...doc.querySelectorAll('a[href]')].find(a=>/^(次へ|Next\b)/i.test(a.textContent.trim()) || /^(次のページ|Next page)$/i.test(a.getAttribute('aria-label') || ''));
    return {ready:true,html:html+(next ? next.outerHTML : '')};
  }
  if (kind === 'receipt') {
    const main=doc.querySelector('#orderDetails') || doc.querySelector('[role="main"]');
    if (!main) return {ready:false,reason:'領収書の表示を待っています。'};
    const text=renderedText(main);
    if (!text.includes(orderId) || !/領収書|購入明細書|注文概要/.test(text) || !/[￥¥]\s*[\d,]+/.test(text)) return {ready:false,reason:'領収書の内容の表示を待っています。'};
    const payment=main.querySelector('[data-component="viewPaymentPlanSummaryWidget"]');
    if (payment && renderedText(payment).replace(/支払い方法|\s/g,'').length===0) return {ready:false,reason:'支払い方法の表示を待っています。'};
    const copy=main.cloneNode(true);
    copy.querySelectorAll('script,template,noscript').forEach(n=>n.remove());
    return {ready:true,html:[...doc.querySelectorAll('link[rel="stylesheet"]')].map(l=>l.outerHTML).join('')+copy.outerHTML};
  }
  throw new Error('不明な取得種別です。');
}
