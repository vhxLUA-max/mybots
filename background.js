var ext = globalThis.browser ?? globalThis.chrome;

importScripts("offscreen.js");

const OFFSCREEN_DOCUMENT_PATH="offscreen.html";
const HAS_OFFSCREEN_API=Boolean(ext.offscreen?.createDocument);

let creatingOffscreenDocument=null;

async function ensureOffscreenDocument(){
  if(!HAS_OFFSCREEN_API)return;

  const offscreenUrl=ext.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if("getContexts" in ext.runtime){
    const contexts=await ext.runtime.getContexts({
      contextTypes:["OFFSCREEN_DOCUMENT"],
      documentUrls:[offscreenUrl]
    });
    if(contexts.length)return;
  }else if(await ext.offscreen.hasDocument?.()){
    return;
  }

  if(creatingOffscreenDocument){
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument=ext.offscreen.createDocument({
    url:OFFSCREEN_DOCUMENT_PATH,
    reasons:["WORKERS"],
    justification:"Run the bundled Stockfish worker in an extension-origin document."
  });

  try{
    await creatingOffscreenDocument;
  }finally{
    creatingOffscreenDocument=null;
  }
}

ext.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.target==="offscreen")return;
  if(message?.type!=="stockfishSearch")return;

  (async()=>{
    if(!HAS_OFFSCREEN_API){
      const result=await search(message.fen,message.depth,message.alternativeCount);
      sendResponse({ok:true,result});
      return;
    }

    await ensureOffscreenDocument();

    const response=await ext.runtime.sendMessage({
      target:"offscreen",
      type:"stockfishSearch",
      fen:message.fen,
      depth:message.depth,
      alternativeCount:message.alternativeCount
    });

    sendResponse(response);
  })().catch(error=>{
    sendResponse({
      ok:false,
      error:error?.message||"Stockfish service unavailable."
    });
  });

  return true;
});
