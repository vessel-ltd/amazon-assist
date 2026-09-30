import {ORIGIN, parseMonth, collectOrders, parseReceipt, reportHTML, orderPrintURL} from './core.js';
import {RenderedAmazonReader} from './worker.js';
import {DiagnosticLog,VERSION,errorCode} from './diagnostics.js';
const $ = id => document.getElementById(id);
const today = new Date(); today.setDate(1); today.setMonth(today.getMonth()-1);
$('month').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
let controller;
let reader;
let diagnostic;
let stage='start';
let currentOrder;
let downloadURL;
$('diagnostics').onclick=()=>{
  if(!diagnostic)return;
  if(downloadURL)URL.revokeObjectURL(downloadURL);
  downloadURL=URL.createObjectURL(new Blob([diagnostic.json()],{type:'application/json'}));
  const link=document.createElement('a');link.href=downloadURL;
  link.download=`Amazon診断_${diagnostic.data.month || 'unknown'}_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  link.click();
};
$('cancel').onclick = () => controller?.abort();
function print() { diagnostic?.add('print_requested',{stage:'print'});$('preview').contentWindow.focus(); $('preview').contentWindow.print(); }
$('print').onclick = print;
window.addEventListener('pagehide',()=>{controller?.abort();reader?.close();if(downloadURL)URL.revokeObjectURL(downloadURL);});
async function preview(html) {
  const frame=$('preview');
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('印刷プレビューの読み込みがタイムアウトしました。再実行してください。')),45000);
    frame.onload=()=>{clearTimeout(timeout);resolve();};
    frame.srcdoc=html;frame.hidden=false;
  });
  await frame.contentDocument.fonts.ready;
  const failed=[...frame.contentDocument.images].filter(img=>!img.complete || !img.naturalWidth);
  if(failed.length) throw new Error(`商品画像${failed.length}件を読み込めませんでした。プレビューを確認し、再実行してください。`);
}
$('export-form').onsubmit = async event => {
  event.preventDefault();
  controller = new AbortController();
  $('export').disabled=true;$('month').disabled=true;$('cancel').hidden=false;
  $('error').hidden=true;$('print').hidden=true;$('preview').hidden=true;$('preview').srcdoc='';$('progress').hidden=false;$('progress').removeAttribute('value');
  const month=$('month').value;
  diagnostic=new DiagnosticLog(month);stage='start';currentOrder=undefined;
  diagnostic.add('started',{stage});$('diagnostics').hidden=true;
  try {
    if (!globalThis.chrome?.runtime?.id) throw new Error('ファイルを直接開くと動作しません。Chromeの拡張機能メニューから「Amazon 月別領収書（非公式）」を開いてください。');
    if (chrome.runtime.getManifest().version!==VERSION) throw new Error('Chromeには古い取得処理が残っています。chrome://extensionsで「Amazon 月別領収書（非公式）」の再読み込みボタンを押し、拡張を開き直してください。');
    reader=new RenderedAmazonReader(chrome.tabs,controller.signal,{},(event,fields)=>diagnostic.add(event,{...fields,stage}));
    const {year}=parseMonth(month);
    stage='orders';
    const orders=await collectOrders(`${ORIGIN}/your-orders/orders?timeFilter=year-${year}`,month,url=>reader.load(url,'orders'),s=>$('status').textContent=s,controller.signal);
    diagnostic.add('orders_selected',{stage,count:orders.length});
    if(!orders.length){diagnostic.add('empty',{stage:'finished'});$('status').textContent=`${month}の注文はありません。`;return;}
    const receipts=[];
    $('progress').max=orders.length;
    for(const [i,order] of orders.entries()){
      stage='receipt';currentOrder=order.id;
      diagnostic.add('receipt_started',{stage,orderId:order.id,index:i+1,menu:!!order.menu});
      $('status').textContent=`領収書を取得しています（${i+1} / ${orders.length}件）`;
      try {
        const url=orderPrintURL(order);
        receipts.push(parseReceipt(await reader.load(url,'receipt',order.id),order));
        diagnostic.add('receipt_ready',{stage,orderId:order.id,index:i+1});
      } catch(e) {if(e.name==='AbortError')throw e;throw new Error(`注文 ${order.id}: ${e.message}\n取得漏れを防ぐため、PDF出力を中止しました。`);}
      $('progress').value=i+1;
    }
    controller.signal.throwIfAborted();
    await reader.close();
    stage='preview';currentOrder=undefined;
    document.title=`Amazon領収書_${month}`;
    $('status').textContent='印刷プレビューを準備しています…';
    await preview(reportHTML(receipts,month));
    controller.signal.throwIfAborted();
    diagnostic.add('preview_ready',{stage,count:receipts.length});
    $('status').textContent=`${month} · ${orders.length}件の領収書を準備しました。PDFの保存先を選択してください。`;
    $('print').hidden=false;
    stage='print';
    print();
  } catch(e) {
    diagnostic.add(e.name==='AbortError'?'cancelled':'failed',{stage,orderId:currentOrder,code:errorCode(e)});
    $('status').textContent=e.name==='AbortError'?'中止しました。':'出力できませんでした。';
    if(e.name!=='AbortError'){$('error').textContent=e.message;$('error').hidden=false;}
  } finally {
    try{await reader?.close();}catch{diagnostic.add('cleanup_failed',{stage});}reader=null;
    $('export').disabled=false;$('month').disabled=false;$('cancel').hidden=true;$('progress').hidden=true;
    $('diagnostics').hidden=false;
  }
};
