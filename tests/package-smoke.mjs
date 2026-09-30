// Runs the extracted distribution's actual modules and generated content script.
// jsdom and simulated Chrome APIs: no real browser, Amazon session, or PDF file.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {JSDOM, VirtualConsole} from 'jsdom';

let bundle, manifest;
const first='250-1111111-2222222', second='503-3333333-4444444';
const card=(id,date)=>`<div class="js-order-card"><div class="order-header">注文日 ${date}<a href="/your-orders/order-details?orderID=${id}">注文の詳細</a></div></div>`;
const receipt=id=>`<div id="orderDetails"><h1>領収書</h1><p>${id}</p><p>￥1,234</p><p>SYNTHETIC_PRIVATE_ADDRESS</p><div data-component="viewPaymentPlanSummaryWidget">支払い方法 カード SYNTHETIC_PRIVATE_CARD</div></div>`;

before(async()=>{
  const version=JSON.parse(await fs.readFile('extension/manifest.json','utf8')).version;
  const archive=path.resolve(`output/store/amazon-assist-${version}.zip`);
  execFileSync('python3',['scripts/package.py','--verify',archive]);
  bundle=await fs.mkdtemp(path.join(os.tmpdir(),'amazon-assist-install-'));
  execFileSync('python3',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,bundle]);
  manifest=JSON.parse(await fs.readFile(path.join(bundle,'manifest.json'),'utf8'));
});
after(async()=>{if(bundle)await fs.rm(bundle,{recursive:true,force:true});});

async function launch(t,scenario){
  const source=await fs.readFile(path.join(bundle,'reader-content.js'),'utf8');
  const dom=new JSDOM(await fs.readFile(path.join(bundle,'app.html'),'utf8'),{
    url:'https://extension.test/app.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()
  });
  const w=dom.window, frame=w.document.getElementById('preview');
  let current, listener, printDOM, printed=0, removed=0, active=false, action, appOpened, blob, download;
  const navigations=[];
  t.after(()=>{current?.window.close();printDOM?.window.close();w.close();});
  // jsdom has no srcdoc renderer or print dialog; these are browser boundaries.
  Object.defineProperty(frame,'srcdoc',{set(html){
    if(!html)return;
    printDOM?.window.close();printDOM=new JSDOM(html);
    Object.defineProperty(printDOM.window.document,'fonts',{value:{ready:Promise.resolve()}});
    printDOM.window.focus=()=>{};printDOM.window.print=()=>{printed++;};
    queueMicrotask(()=>frame.onload?.());
  }});
  Object.defineProperty(frame,'contentDocument',{get:()=>printDOM?.window.document});
  Object.defineProperty(frame,'contentWindow',{get:()=>printDOM?.window});
  w.Blob=Blob;
  w.URL.createObjectURL=value=>{blob=value;return 'blob:test';};
  w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){download=this.download;};
  async function navigate(url){
    const u=new URL(url);navigations.push(u);
    assert.equal(u.origin,'https://www.amazon.co.jp');
    let html;
    if(u.pathname.includes('/summary/print')){
      const id=u.searchParams.get('orderID');
      html=scenario==='failure'&&id===second ? '<input id="captchacharacters">' : receipt(id);
    }else if(scenario==='empty') html='<p>0件の注文</p>';
    else html=u.searchParams.get('page')==='1' ? card(second,'2026年8月1日') :
      card(first,'2026年8月31日')+card('250-5555555-6666666','2026年9月1日')+'<a href="?timeFilter=year-2026&page=1">次へ →</a>';
    current?.window.close();
    current=new JSDOM(html,{url,runScripts:'outside-only',virtualConsole:new VirtualConsole()});
    Object.defineProperty(current.window.document,'readyState',{value:'complete'});
    current.window.chrome={runtime:{id:'test-extension',onMessage:{addListener:f=>{listener=f;}}}};
    current.window.eval(source);
  }
  w.chrome={
    runtime:{id:'test-extension',getManifest:()=>manifest,getURL:file=>`https://extension.test/${file}`},
    action:{onClicked:{addListener:f=>{action=f;}}},
    tabs:{
      async create({url,active:foreground}){
        if(url==='https://extension.test/app.html'){appOpened=url;return {id:99};}
        assert.equal(foreground,false);await navigate(url);return {id:123};
      },
      async update(id,options){assert.equal(id,123);if(options.url)await navigate(options.url);if(options.active)active=true;},
      async get(id){assert.equal(id,123);return {id,url:current.window.location.href};},
      async remove(id){assert.equal(id,123);removed++;},
      async sendMessage(id,message){
        assert.equal(id,123);let result;
        listener(message,{id:'test-extension'},response=>{result=response;});
        return JSON.parse(JSON.stringify(result));
      }
    }
  };
  const context=dom.getInternalVMContext();
  new vm.Script(await fs.readFile(path.join(bundle,manifest.background.service_worker),'utf8')).runInContext(context);
  action();assert.equal(appOpened,'https://extension.test/app.html');
  const modules=new Map();
  async function module(filename){
    if(modules.has(filename))return modules.get(filename);
    assert.equal(path.dirname(filename),bundle,'Modules must come from the extracted ZIP');
    const value=new vm.SourceTextModule(await fs.readFile(filename,'utf8'),{context,identifier:filename});
    modules.set(filename,value);return value;
  }
  const app=await module(path.join(bundle,'app.js'));
  await app.link((specifier,ref)=>module(path.resolve(path.dirname(ref.identifier),specifier)));
  await app.evaluate();
  w.document.getElementById('month').value='2026-08';
  await w.document.getElementById('export-form').onsubmit({preventDefault(){}});
  w.document.getElementById('diagnostics').click();
  const log=JSON.parse(await blob.text());
  assert.match(download,/^Amazon診断_2026-08_/);
  assert.equal(log.pdfSaveVerified,false);
  assert.doesNotMatch(JSON.stringify(log),/SYNTHETIC_PRIVATE_ADDRESS|SYNTHETIC_PRIVATE_CARD|1,234/);
  assert.equal(w.document.getElementById('export').disabled,false);
  return {w,printDOM,printed,removed,active,navigations,log};
}

test('fresh ZIP: action → month → paginated history → receipts → preview → print request → diagnostics',async t=>{
  const result=await launch(t,'success');
  assert.equal(result.printed,1);
  assert.equal(result.removed,1);
  assert.equal(result.w.document.getElementById('error').hidden,true);
  assert.equal(result.w.document.title,'Amazon領収書_2026-08');
  assert.equal(result.navigations.length,4);
  const receipts=[...result.printDOM.window.document.querySelectorAll('.receipt')];
  assert.equal(receipts.length,2);
  assert.match(receipts[0].textContent,new RegExp(first));
  assert.match(receipts[1].textContent,new RegExp(second));
  assert.equal(result.log.events.at(-1).event,'print_requested');
});

test('fresh ZIP: a later receipt failure prevents partial output and keeps the challenge tab',async t=>{
  const result=await launch(t,'failure');
  assert.equal(result.printed,0);
  assert.equal(result.removed,0);
  assert.equal(result.active,true);
  assert.equal(result.w.document.getElementById('print').hidden,true);
  assert.match(result.w.document.getElementById('error').textContent,/取得漏れを防ぐため/);
  assert.equal(result.log.events.at(-1).event,'failed');
  assert.equal(result.log.events.at(-1).orderId,second);
});

test('fresh ZIP: empty month cleans up without opening print',async t=>{
  const result=await launch(t,'empty');
  assert.equal(result.printed,0);
  assert.equal(result.removed,1);
  assert.equal(result.w.document.getElementById('error').hidden,true);
  assert.equal(result.log.events.at(-1).event,'empty');
});
