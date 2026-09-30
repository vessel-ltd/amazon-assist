// Only explicitly selected fields can leave memory in the diagnostic download.
export const VERSION='1.1.3';
export function errorCode(error) {
  if(error?.name==='AbortError') return 'cancelled';
  const text=String(error?.message || '');
  for(const [pattern,code] of [
    [/ファイルを直接/,'not_extension'],[/古い取得処理/,'reload_required'],
    [/ログイン|確認が必要/,'authentication_required'],[/タイムアウト/,'timeout'],
    [/タブが閉じ/,'tab_closed'],[/商品画像/,'images_unavailable'],
    [/注文日/,'order_date_unreadable'],[/注文番号/,'order_id_unreadable'],
    [/領収書のない|領収書等のリンク/,'receipt_link_missing'],
    [/領収書の内容/,'receipt_invalid'],[/注文一覧/,'orders_invalid'],
    [/次ページ|同じページ/,'pagination_invalid'],[/Amazon以外/,'unexpected_origin'],
    [/年月/,'month_invalid']
  ]) if(pattern.test(text)) return code;
  return 'unclassified';
}
const stages=new Set(['start','orders','receipt','preview','print','finished']);
const events=new Set(['started','page_open','page_state','page_ready','page_failed','orders_selected','receipt_started','receipt_ready','preview_ready','print_requested','failed','cancelled','empty','cleanup_failed']);
const states=new Set(['loading','interactive','complete','unknown']);
const codes=new Set(['cancelled','not_extension','reload_required','authentication_required','timeout','tab_closed','images_unavailable','order_date_unreadable','order_id_unreadable','receipt_link_missing','receipt_invalid','orders_invalid','pagination_invalid','unexpected_origin','month_invalid','unclassified']);
const counts=['cards','datedCards','invoiceLinks','detailLinks','scripts','count','index','elapsedMs'];
const flags=['main','identity','heading','amount','payment','paymentReady','login','challenge','menu'];
export class DiagnosticLog {
  constructor(month) {
    this.data={schema:1,version:VERSION,startedAt:new Date().toISOString(),month:/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:null,pdfSaveVerified:false,events:[],droppedEvents:0};
  }
  add(event,fields={}) {
    if(!events.has(event))return;
    const entry={at:new Date().toISOString(),event};
    if(stages.has(fields.stage))entry.stage=fields.stage;
    if(['orders','receipt'].includes(fields.kind))entry.kind=fields.kind;
    if(codes.has(fields.code))entry.code=fields.code;
    if(states.has(fields.readyState))entry.readyState=fields.readyState;
    if(/^[A-Z0-9]{3}-\d{7}-\d{7}$/.test(fields.orderId || ''))entry.orderId=fields.orderId;
    for(const key of counts)if(Number.isSafeInteger(fields[key])&&fields[key]>=0)entry[key]=fields[key];
    for(const key of flags)if(typeof fields[key]==='boolean')entry[key]=fields[key];
    if(this.data.events.length>=2000){this.data.events.shift();this.data.droppedEvents++;}
    this.data.events.push(entry);
  }
  json(){return JSON.stringify(this.data,null,2);}
}
