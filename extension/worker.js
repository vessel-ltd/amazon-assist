import {amazonURL} from './core.js';
import {errorCode} from './diagnostics.js';

export class RenderedAmazonReader {
  constructor(tabs,signal,timing={},onDiagnostic=()=>{}) {
    this.tabs=tabs;this.signal=signal;this.tabId=null;this.keepOpen=false;
    this.timing={pollMs:400,settleMs:1000,timeoutMs:60000,...timing};
    this.onDiagnostic=onDiagnostic;
  }
  async wait(ms) {
    this.signal.throwIfAborted();
    await new Promise((resolve,reject)=>{
      const onAbort=()=>{clearTimeout(timer);reject(this.signal.reason);};
      const timer=setTimeout(()=>{this.signal.removeEventListener('abort',onAbort);resolve();},ms);
      this.signal.addEventListener('abort',onAbort,{once:true});
    });
  }
  async load(url,kind,orderId) {
    const started=Date.now();
    const log=(event,fields={})=>this.onDiagnostic(event,{...fields,kind,orderId,elapsedMs:Date.now()-started});
    log('page_open');
    try {return await this.readPage(url,kind,orderId,log);}
    catch(error){log('page_failed',{code:errorCode(error)});throw error;}
  }
  async readPage(url,kind,orderId,log) {
    this.signal.throwIfAborted();
    const target=new URL(amazonURL(url));
    const token=crypto.randomUUID();
    target.searchParams.set('language','ja_JP');target.hash=`aa-worker=${token}`;
    if (this.tabId===null) {const tab=await this.tabs.create({url:target.href,active:false});this.tabId=tab.id;}
    else await this.tabs.update(this.tabId,{url:target.href});
    const deadline=Date.now()+this.timing.timeoutMs;
    let stable='',stableSince=0,lastReason='Amazonの表示を待っています。',lastDiagnostic='';
    while(Date.now()<deadline) {
      await this.wait(this.timing.pollMs);
      // A closed tab should stop the job, rather than retry another tab.
      let tab;
      try {tab=await this.tabs.get(this.tabId);} catch {throw new Error('取得用のAmazonタブが閉じられました。もう一度出力してください。');}
      if (tab.url && /\/ap\/|validateCaptcha/.test(tab.url)) {
        this.keepOpen=true;await this.tabs.update(this.tabId,{active:true});
        throw new Error('Amazonでログインまたは確認が必要です。開いたAmazonタブで完了後、再度出力してください。');
      }
      let result;
      try {result=await this.tabs.sendMessage(this.tabId,{type:'AA_CAPTURE',token,kind,orderId});}
      catch {lastReason='ページの読み込み中です。';continue;}
      if(result?.diagnostic) {
        const signature=JSON.stringify(result.diagnostic);
        if(signature!==lastDiagnostic){log('page_state',result.diagnostic);lastDiagnostic=signature;}
      }
      if (result?.error) {
        this.keepOpen=true;await this.tabs.update(this.tabId,{active:true});
        throw new Error(result.error);
      }
      if (!result?.ready) {stable='';lastReason=result?.reason || lastReason;continue;}
      // Wait for the visible DOM to settle, including delayed payment rendering.
      if (result.html!==stable) {stable=result.html;stableSince=Date.now();continue;}
      if(Date.now()-stableSince<this.timing.settleMs)continue;
      log('page_ready');
      return new DOMParser().parseFromString(result.html,'text/html');
    }
    this.keepOpen=true;await this.tabs.update(this.tabId,{active:true});
    throw new Error(`Amazonの表示待ちがタイムアウトしました。${lastReason}\n拡張を更新した直後はchrome://extensionsで拡張の再読み込みが必要です。開いたAmazonタブの表示も確認してください。`);
  }
  async close() {
    if(this.tabId!==null && !this.keepOpen) await this.tabs.remove(this.tabId).catch(()=>{});
    this.tabId=null;
  }
}
