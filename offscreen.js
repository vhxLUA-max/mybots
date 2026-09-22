let worker=null;
let ready=false;
let activeSearch=null;

function ensureWorker(){
  if(worker)return worker;

  worker=new Worker(chrome.runtime.getURL("stockfish-19-lite-single.js"));
  worker.addEventListener("error",error=>{
    ready=false;
    worker=null;
    if(activeSearch){
      activeSearch.reject(new Error(error?.message||"Stockfish worker stopped."));
      activeSearch=null;
    }
  });

  return worker;
}

function waitFor(predicate,timeout=15000){
  const currentWorker=ensureWorker();

  return new Promise((resolve,reject)=>{
    const handler=event=>{
      const line=typeof event.data==="string"
        ?event.data.trim()
        :String(event.data??"").trim();

      if(!predicate(line))return;

      clearTimeout(timer);
      currentWorker.removeEventListener("message",handler);
      resolve(line);
    };

    const timer=setTimeout(()=>{
      currentWorker.removeEventListener("message",handler);
      reject(new Error("Stockfish timed out waiting for engine response."));
    },timeout);

    currentWorker.addEventListener("message",handler);
  });
}

async function initialize(){
  const currentWorker=ensureWorker();
  if(ready)return;

  const uciok=waitFor(line=>line==="uciok");
  currentWorker.postMessage("uci");
  await uciok;

  const readyok=waitFor(line=>line==="readyok");
  currentWorker.postMessage("isready");
  await readyok;

  ready=true;
}

function parseMove(value){
  if(!/^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(value||""))return null;
  const files="abcdefgh";

  return {
    from:(Number(value[1])-1)*8+files.indexOf(value[0].toLowerCase()),
    to:(Number(value[3])-1)*8+files.indexOf(value[2].toLowerCase()),
    promotion:value.length>4?value[4].toUpperCase():null
  };
}

function scoreValue(cp,mate){
  if(mate!==null){
    const distance=Math.abs(mate);
    return mate>=0?1000000-distance*2:-1000000+distance*2;
  }
  return cp;
}

function parseInfo(line,lines){
  const multipv=Number(line.match(/\bmultipv (\d+)/)?.[1]||1);
  const depth=Number(line.match(/\bdepth (\d+)/)?.[1]||0);
  const nodes=Number(line.match(/\bnodes (\d+)/)?.[1]||0);
  const cpMatch=line.match(/\bscore cp (-?\d+)/);
  const mateMatch=line.match(/\bscore mate (-?\d+)/);
  const pvMatch=line.match(/\bpv (.+)$/);

  if(!cpMatch&&!mateMatch)return;

  const cp=cpMatch?Number(cpMatch[1]):null;
  const mate=mateMatch?Number(mateMatch[1]):null;
  const pv=pvMatch
    ?pvMatch[1].trim().split(/\s+/).map(parseMove).filter(Boolean)
    :[];

  lines.set(multipv,{
    multipv,
    depth,
    nodes,
    score:scoreValue(cp??0,mate),
    mate,
    pv
  });
}

async function search(fen,depth=16,alternativeCount=4){
  if(activeSearch)throw new Error("Stockfish is already analyzing a position.");

  await initialize();

  const currentWorker=ensureWorker();
  const lines=new Map();

  return await new Promise((resolve,reject)=>{
    activeSearch={resolve,reject};

    const handler=event=>{
      const line=typeof event.data==="string"
        ?event.data.trim()
        :String(event.data??"").trim();

      if(!line)return;

      if(line.startsWith("info "))parseInfo(line,lines);

      if(line.startsWith("bestmove ")){
        const bestmove=line.split(/\s+/)[1]||"";
        activeSearch.resolve(bestmove);
      }
    };

    const timeout=setTimeout(()=>{
      try{currentWorker.postMessage("stop");}catch{}
      activeSearch.reject(new Error("Stockfish search timed out."));
    },30000);

    currentWorker.addEventListener("message",handler);

    (async()=>{
      try{
        currentWorker.postMessage("ucinewgame");
        currentWorker.postMessage("setoption name MultiPV value "+Math.max(1,Math.min(8,Number(alternativeCount)||4)));

        const readyok=waitFor(line=>line==="readyok");
        currentWorker.postMessage("isready");
        await readyok;

        currentWorker.postMessage("position fen "+fen);
        currentWorker.postMessage("go depth "+Math.max(1,Math.min(30,Number(depth)||16)));

        const bestmove=await new Promise((resolveBest,rejectBest)=>{
          const oldResolve=activeSearch.resolve;
          const oldReject=activeSearch.reject;
          activeSearch.resolve=value=>{
            oldResolve(value);
            resolveBest(value);
          };
          activeSearch.reject=error=>{
            oldReject(error);
            rejectBest(error);
          };
        });

        const entries=[...lines.values()].sort((a,b)=>a.multipv-b.multipv);
        const bestInfo=entries[0]||null;
        const fallback=parseMove(bestmove);

        if(!fallback){
          resolve({
            gameState:"no-move",
            from:null,
            to:null,
            promotion:null,
            score:0,
            mate:null,
            pv:[],
            depth:bestInfo?.depth||Number(depth)||0,
            nodes:bestInfo?.nodes||0,
            alternatives:[],
            stockfish:true,
            model:"Stockfish 19 Lite Single"
          });
          return;
        }

        const baseScore=bestInfo?.score??0;
        const alternatives=entries.slice(0,8).map((entry,index)=>{
          const firstMove=entry.pv[0]||(index===0?fallback:null);
          if(!firstMove)return null;

          return {
            ...firstMove,
            score:entry.score,
            loss:Math.max(0,baseScore-entry.score),
            mate:entry.mate,
            rank:index+1,
            depth:entry.depth,
            nodes:entry.nodes
          };
        }).filter(Boolean);

        if(!alternatives.length){
          alternatives.push({
            ...fallback,
            score:baseScore,
            loss:0,
            mate:bestInfo?.mate??null,
            rank:1,
            depth:bestInfo?.depth||Number(depth)||0,
            nodes:bestInfo?.nodes||0
          });
        }

        const best=alternatives[0];

        resolve({
          gameState:"playing",
          from:best.from,
          to:best.to,
          promotion:best.promotion,
          score:best.score,
          mate:best.mate??null,
          pv:bestInfo?.pv||[fallback],
          depth:bestInfo?.depth||Number(depth)||0,
          nodes:bestInfo?.nodes||0,
          alternatives,
          stockfish:true,
          model:"Stockfish 19 Lite Single"
        });
      }catch(error){
        reject(error);
      }finally{
        clearTimeout(timeout);
        currentWorker.removeEventListener("message",handler);
        activeSearch=null;
      }
    })();
  });
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.target!=="offscreen"||message?.type!=="stockfishSearch")return;

  search(message.fen,message.depth,message.alternativeCount)
    .then(result=>sendResponse({ok:true,result}))
    .catch(error=>sendResponse({ok:false,error:error?.message||"Stockfish search failed."}));

  return true;
});
