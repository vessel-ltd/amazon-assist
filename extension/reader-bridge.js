// Included in reader-content.js by scripts/build.mjs.
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if (sender.id!==chrome.runtime.id || message?.type!=='AA_CAPTURE') return;
  // The extension owns a dedicated, marked tab. Never collect unrelated tabs.
  if (location.hash!==`#aa-worker=${message.token}`) {sendResponse({ready:false,reason:'Amazonへ移動中です。'});return;}
  const diagnostic=pageDiagnostics(document,message.orderId);
  try {sendResponse({...captureRendered(document,message.kind,message.orderId),diagnostic});}
  catch(error) {sendResponse({error:error.message,diagnostic});}
});
