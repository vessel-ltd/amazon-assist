export const ORIGIN = 'https://www.amazon.co.jp';
export function amazonURL(value, base = ORIGIN) {
  const url = new URL(value, base);
  if (url.origin !== ORIGIN || url.username || url.password) throw new Error('Amazon以外のリンクが返されました。処理を中止しました。');
  return url.href;
}
export function parseMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('年月を選択してください。');
  const [year, month] = value.split('-').map(Number);
  if (year < 1995 || year > 2100) throw new Error('対応範囲の年月を選択してください。');
  return {year, month};
}
export function checkDocument(doc) {
  // Amazon includes an empty, hidden signIn form in the navbar even while
  // signed in. It is not an authentication challenge.
  if (doc.querySelector('input[type="password"],form[name="signIn"]:not(#ap_navbar_form),#ap_email')) throw new Error('Amazonに再ログインしてから、もう一度出力してください。');
  if (doc.querySelector('#captchacharacters,form[action*="validateCaptcha"]') || /ロボットではない|文字を入力してください/.test(doc.title)) throw new Error('Amazonで確認が必要です。注文履歴を開いて確認を完了してから再実行してください。');
}
// HTML fetched by the extension can use a different locale from the open tab.
// Parse explicit calendar fields rather than Date.parse (which is locale-dependent).
export function parseOrderDate(text) {
  const value = text.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  let match = value.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) match = value.match(/\b(\d{4})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})\b/);
  let parts = match ? match.slice(1).map(Number) : null;
  if (!parts) {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const names = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?';
    const monthFirst = value.match(new RegExp(`\\b${names}\\s+(\\d{1,2})(?:,|\\s)\\s*(\\d{4})\\b`, 'i'));
    const dayFirst = value.match(new RegExp(`\\b(\\d{1,2})\\s+${names}\\s+(\\d{4})\\b`, 'i'));
    if (monthFirst) parts = [+monthFirst[3], months.findIndex(m=>m.startsWith(monthFirst[1].toLowerCase()))+1, +monthFirst[2]];
    else if (dayFirst) parts = [+dayFirst[3], months.findIndex(m=>m.startsWith(dayFirst[2].toLowerCase()))+1, +dayFirst[1]];
  }
  if (!parts) return null;
  const [year,month,day] = parts;
  const date = new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? {year,month,day} : null;
}
export function renderedText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('script,style,template,noscript').forEach(node=>node.remove());
  return clone.textContent;
}
export function parseOrders(doc, base, monthValue) {
  checkDocument(doc);
  const {year, month} = parseMonth(monthValue);
  const nativeCards = doc.querySelectorAll('.js-order-card');
  const cards = [...(nativeCards.length ? nativeCards : doc.querySelectorAll('.order-card'))];
  const orders = [];
  for (const card of cards) {
    const header = card.querySelector('.order-header') || card;
    const headerText = renderedText(header);
    const date = parseOrderDate(headerText);
    const link = card.querySelector('a[href*="/invoice/popover"]');
    const detail = card.querySelector('a[href*="order-details"]');
    const source = link || detail;
    if (!date) {
      throw new Error(`注文日を読み取れませんでした（${cards.indexOf(card)+1}件目）。Amazonの表示が完了しているか確認してください。`);
    }
    if (date.year !== year || date.month !== month) continue;
    if (!source) throw new Error('対象月に領収書のない注文があります。キャンセル状況を注文履歴で確認してください。');
    const url = new URL(amazonURL(source.getAttribute('href'), base));
    const id = url.searchParams.get('orderId') || url.searchParams.get('orderID');
    if (!id || !/^[A-Z0-9]{3}-\d{7}-\d{7}$/.test(id)) throw new Error('注文番号を読み取れませんでした。');
    orders.push({id, day: date.day, menu: link ? amazonURL(link.getAttribute('href'), base) : null});
  }
  if (!cards.length && !/注文はありません|注文がありません|0件の注文|注文された商品はありません|注文が見つかりません/.test(doc.body.textContent)) {
    throw new Error('注文一覧を取得できませんでした。ログイン状態をご確認ください。');
  }
  const next = [...doc.querySelectorAll('a[href]')].find(a => /^(次へ|Next\b)/i.test(a.textContent.trim()) || /^(次のページ|Next page)$/i.test(a.getAttribute('aria-label') || ''));
  const nextURL = next ? amazonURL(next.getAttribute('href'), base) : null;
  if (nextURL && !new URL(nextURL).pathname.startsWith('/your-orders/orders') && !new URL(nextURL).pathname.startsWith('/gp/your-account/order-history')) throw new Error('次ページのリンク形式を確認できませんでした。');
  return {orders, next: nextURL, signature: cards.map(c => renderedText(c.querySelector('.order-header') || c)).join('|')};
}
export function receiptURL(doc, base) {
  checkDocument(doc);
  const link = [...doc.querySelectorAll('a[href]')].find(a => /\/summary\/print\.html/.test(a.getAttribute('href')));
  if (!link) throw new Error('印刷可能な領収書／購入明細書が見つかりませんでした。');
  return amazonURL(link.getAttribute('href'), base);
}
export function orderPrintURL(order) {
  if (!/^[A-Z0-9]{3}-\d{7}-\d{7}$/.test(order.id)) throw new Error('注文番号を読み取れませんでした。');
  // The history popover is not always offered. Its absence does not establish
  // whether Amazon's normal print page exists for the identified order.
  return `${ORIGIN}/gp/css/summary/print.html?orderID=${encodeURIComponent(order.id)}`;
}
const allowedAsset = value => {
  try { const u = new URL(value, ORIGIN); return u.protocol === 'https:' && ['m.media-amazon.com','images-fe.ssl-images-amazon.com','images-na.ssl-images-amazon.com'].includes(u.hostname) ? u.href : null; } catch { return null; }
};
export function parseReceipt(doc, order) {
  checkDocument(doc);
  const main = doc.querySelector('#orderDetails') || doc.querySelector('[role="main"]');
  if (!main || !main.textContent.includes(order.id) || !/領収書|購入明細書|注文概要/.test(main.textContent)) throw new Error('領収書の内容を確認できませんでした。');
  const root = main.cloneNode(true);
  root.querySelectorAll('script,iframe,object,embed,base,link,meta,form,button,input,svg,video,audio,[data-component="saveButton"],[data-component="saveButtonMobile"],.printOD-hide-print').forEach(e=>e.remove());
  for (const el of [root,...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || ['srcdoc','srcset','action','formaction','nonce'].includes(attr.name)) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'IMG') {
      const src = allowedAsset(el.getAttribute('src'));
      if (src) {el.setAttribute('src',src);el.setAttribute('loading','eager');} else el.remove();
    }
    if (el.tagName === 'A') {el.removeAttribute('href');el.removeAttribute('target');}
  }
  // Amazon's screen layout reserves fixed-width sidebars. On A4 the payment
  // widget can overflow into totals. Reflow existing nodes without rewriting data.
  const summary=root.querySelector('[data-component="orderSummary"] .a-fixed-right-grid-inner');
  if (summary) {
    summary.classList.add('aa-summary-layout');
    const fields=summary.querySelector(':scope > .a-col-left > .a-row');
    if(fields) {
      fields.classList.add('aa-summary-fields');
      if(fields.children.length===1) fields.classList.add('aa-summary-single');
    }
  }
  for(const grid of root.querySelectorAll('[data-component="shipments"] .a-fixed-right-grid-inner')) {
    const left=grid.querySelector(':scope > [data-component="shipmentsLeftGrid"]');
    if(left && [...grid.children].filter(c=>c!==left).every(c=>!renderedText(c).trim())) grid.classList.add('aa-shipment-wide');
  }
  const styles = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(l=>allowedAsset(l.getAttribute('href'))).filter(Boolean);
  return {id:order.id, html:root.outerHTML, styles};
}
export function reportHTML(receipts, month) {
  parseMonth(month);
  const styles = [...new Set(receipts.flatMap(r=>r.styles))];
  const escape = s => s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Amazon領収書_${month}</title>${styles.map(s=>`<link rel="stylesheet" href="${escape(s)}">`).join('')}<style>
    html,body{background:#fff!important;margin:0!important;min-width:0!important;color:#0f1111;font-family:Arial,"Meiryo",sans-serif;font-size:13px}
    .receipt{padding:22mm 8mm 10mm;max-width:210mm;margin:auto;box-sizing:border-box}
    .receipt #orderDetails{width:100%!important;min-width:0!important;max-width:none!important;margin:0!important}
    .receipt .a-cardui{padding:0!important}.receipt .a-cardui-deck{margin:0!important}
    .printOD-hide-print,.a-hidden{display:none!important}h1{font-size:24px!important}a{color:#216baf;text-decoration:none}img{max-width:100%}
    .receipt .aa-summary-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:18px;padding-right:0!important}
    .receipt .aa-summary-layout>.a-fixed-right-grid-col{width:auto!important;margin:0!important;float:none!important;padding:0!important;min-width:0}
    .receipt .aa-summary-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:14px}
    .receipt .aa-summary-single{grid-template-columns:minmax(0,1fr)}
    .receipt .aa-summary-fields>.a-column{width:auto!important;margin:0!important;float:none!important;min-width:0;overflow-wrap:anywhere}
    .receipt .aa-summary-layout::before,.receipt .aa-summary-layout::after,.receipt .aa-summary-fields::before,.receipt .aa-summary-fields::after,.receipt .od-line-item-row::before,.receipt .od-line-item-row::after{display:none!important}
    .receipt [data-component="viewPaymentPlanSummaryWidget"] div{min-width:0!important;max-width:100%;flex-shrink:1!important}
    .receipt [data-component="viewPaymentPlanSummaryWidget"] span{white-space:normal!important;overflow-wrap:anywhere;font-size:12px!important;line-height:1.45!important}
    .receipt [data-testid="payment-instrument-art"]{flex-shrink:0!important}
    .receipt .od-line-item-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
    .receipt .od-line-item-row>.a-column{width:auto!important;float:none!important;margin:0!important;min-width:0}
    .receipt .od-line-item-row-label{overflow-wrap:anywhere}.receipt .od-line-item-row-content{white-space:nowrap;text-align:right}
    .receipt .aa-shipment-wide{padding-right:0!important}
    .receipt .aa-shipment-wide>[data-component="shipmentsLeftGrid"]>.a-col-left{width:100%!important;float:none!important;padding:0!important;margin:0!important}
    @page{size:A4;margin:12mm}
    @media screen{.receipt{max-width:186mm;min-height:273mm;border-bottom:8px solid #eef0f0}}
    @media print{.receipt{padding:12mm 8mm 0;max-width:none;break-before:page}.receipt:first-child{break-before:auto}.a-box{break-inside:avoid}html,body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>${receipts.map(r=>`<section class="receipt">${r.html}</section>`).join('')}</body></html>`;
}
export async function collectOrders(firstURL, month, load, progress, signal) {
  const orders = new Map(), pages = new Set();
  let url = firstURL;
  while (url) {
    signal?.throwIfAborted();
    const key = new URL(url); key.searchParams.delete('ref_');
    if (pages.has(key.href) || pages.size >= 200) throw new Error('注文一覧のページ送りが繰り返されました。出力を中止しました。');
    pages.add(key.href);
    progress(`注文一覧を確認しています（${pages.size}ページ目）`);
    const page = parseOrders(await load(url), url, month);
    // Other installed extensions can expand every history page to the full year.
    // Deduplicate orders, but follow the real next-page URLs to the end. URL
    // cycle detection above still prevents pagination loops.
    page.orders.forEach(o=>orders.set(o.id,o));
    url = page.next;
  }
  return [...orders.values()].sort((a,b)=>b.day-a.day);
}
