const OFFSCREEN_DOCUMENT_PATH="offscreen.html";

let creatingOffscreenDocument=null;

async function ensureOffscreenDocument(){
  const offscreenUrl=chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if("getContexts" in chrome.runtime){
    const contexts=await chrome.runtime.getContexts({
      contextTypes:["OFFSCREEN_DOCUMENT"],
      documentUrls:[offscreenUrl]
    });
    if(contexts.length)return;
  }

  if(creatingOffscreenDocument){
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument=chrome.offscreen.createDocument({
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

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.target==="offscreen")return;
  if(message?.type!=="stockfishSearch")return;

  (async()=>{
    await ensureOffscreenDocument();

    const response=await chrome.runtime.sendMessage({
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
