const ext = globalThis.browser ?? globalThis.chrome;

(() => {
  const statusEl=document.querySelector("#cmh-status");
  const detailEl=document.querySelector("#cmh-detail");
  const playerRatingEl=document.querySelector("#cmh-player-rating");
  const playerSideEl=document.querySelector("#cmh-player-side");
  const sideToMoveEl=document.querySelector("#cmh-side-to-move");
  const opponentRatingEl=document.querySelector("#cmh-opponent-rating");
  const gameModeEl=document.querySelector("#cmh-game-mode");
  const dotEl=document.querySelector("#cmh-dot");
  const scanButton=document.querySelector("#cmh-scan");
  const alternativesButton=document.querySelector("#cmh-alternatives");
  const dashboardOpenButton=document.querySelector("#cmh-dashboard-open");
  const analysisSourceEl=document.querySelector("#cmh-analysis-source");
  const analysisEvalEl=document.querySelector("#cmh-analysis-eval");
  const analysisPvEl=document.querySelector("#cmh-analysis-pv");
  const candidateListEl=document.querySelector("#cmh-candidate-list");

  let tabId=null;

  function setConnectionState(state){
    dotEl?.classList.toggle("cmh-ready",state==="ready");
    dotEl?.classList.toggle("cmh-error",state==="error");
  }

  function setToggle(button,enabled){
    button?.classList.toggle("cmh-on",Boolean(enabled));
    button?.setAttribute("aria-pressed",String(Boolean(enabled)));
  }

  function setStatus(status,detail,connected=true){
    if(statusEl)statusEl.textContent=status||"—";
    if(detailEl)detailEl.textContent=detail||"";
    setConnectionState(connected?"ready":"error");
  }

  function setGameInfo(response){
    if(playerRatingEl)playerRatingEl.textContent=response.humanRating?Number(response.humanRating).toLocaleString():"—";
    if(playerSideEl)playerSideEl.textContent=response.playerSide==="w"?"White":response.playerSide==="b"?"Black":"Detecting...";
    if(sideToMoveEl){
      sideToMoveEl.textContent=response.sideToMove==="w"
        ?"White"+(response.isPlayerTurn?" • Your turn":"")
        :response.sideToMove==="b"
          ?"Black"+(response.isPlayerTurn?" • Your turn":"")
          :"Detecting...";
    }
    if(opponentRatingEl)opponentRatingEl.textContent=response.opponentRating?Number(response.opponentRating).toLocaleString():"—";
    if(gameModeEl)gameModeEl.textContent=response.gameMode||"Detecting...";
    setAnalysis(response);
  }

  function setAnalysis(response){
    if(!analysisSourceEl||!candidateListEl)return;
    analysisSourceEl.textContent=response.analysisSource||"No analysis";
    if(analysisEvalEl)analysisEvalEl.textContent=response.analysisEvaluation||"—";
    if(analysisPvEl)analysisPvEl.textContent=response.analysisPV||"—";
    candidateListEl.replaceChildren();

    const labels={best:"Best",good:"Good",ok:"Okay",mistake:"Mistake",blunder:"Blunder"};

    for(const candidate of response.analysisCandidates||[]){
      const row=document.createElement("div");
      row.className="cmh-candidate-row";

      const move=document.createElement("span");
      move.className="cmh-candidate-move";
      move.textContent=candidate.move;

      const category=document.createElement("span");
      category.className="cmh-candidate-category cmh-"+candidate.category;
      category.textContent=labels[candidate.category]||candidate.category||"Candidate";

      const evaluation=document.createElement("span");
      evaluation.className="cmh-candidate-eval";
      evaluation.textContent=candidate.evaluation;

      const loss=document.createElement("span");
      loss.className="cmh-candidate-loss";
      loss.textContent=candidate.loss>0?"-"+(candidate.loss/100).toFixed(2):"Best";

      row.append(move,category,evaluation,loss);
      candidateListEl.appendChild(row);
    }
  }

  async function getActiveTab(){
    if(document.body.dataset.cmhPage==="dashboard"){
      const tabs=await ext.tabs.query({currentWindow:true});
      return tabs.find(tab=>tab.url?.startsWith("https://www.chess.com/"))||null;
    }
    const tabs=await ext.tabs.query({active:true,currentWindow:true});
    return tabs[0]||null;
  }

  function sendMessage(message){
    return new Promise((resolve,reject)=>{
      ext.tabs.sendMessage(tabId,message,response=>{
        if(ext.runtime.lastError){
          reject(new Error(ext.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  async function refreshState(){
    const response=await sendMessage({type:"getState"});
    if(!response?.ok)throw new Error("Chess Move Helper is not loaded yet.");
    setToggle(alternativesButton,response.showAlternatives);
    setStatus(response.status,response.detail,true);
    setGameInfo(response);
  }

  async function connect(){
    try{
      const tab=await getActiveTab();
      if(!tab?.id||!tab.url?.startsWith("https://www.chess.com/")){
        setStatus("Open Chess.com","The popup controls a supported Chess.com board.",false);
        if(scanButton)scanButton.disabled=true;
        return;
      }
      tabId=tab.id;
      await refreshState();
    }catch(error){
      setStatus("Connect failed","Refresh the Chess.com tab, then open the popup again.",false);
      if(detailEl)detailEl.title=error.message;
    }
  }

  scanButton?.addEventListener("click",async()=>{
    if(tabId===null)return;
    scanButton.disabled=true;
    scanButton.textContent="Analyzing...";
    try{
      const response=await sendMessage({type:"scan"});
      if(!response?.ok)throw new Error(response?.error||"Analysis failed.");
      setStatus(response.status,response.detail,true);
      setGameInfo(response);
      setToggle(alternativesButton,response.showAlternatives);
    }catch(error){
      setStatus("Scan failed","Refresh the Chess.com tab and try again.",false);
      if(detailEl)detailEl.title=error.message;
    }finally{
      scanButton.disabled=false;
      scanButton.textContent="Analyze Position";
    }
  });

  alternativesButton?.addEventListener("click",async()=>{
    if(tabId===null)return;
    try{
      const response=await sendMessage({
        type:"setAlternatives",
        value:!alternativesButton.classList.contains("cmh-on")
      });
      if(!response?.ok)throw new Error(response?.error||"Update failed.");
      setToggle(alternativesButton,response.showAlternatives);
      setStatus(response.status,response.detail,true);
      setGameInfo(response);
    }catch(error){
      setStatus("Connection lost",error.message,false);
    }
  });

  dashboardOpenButton?.addEventListener("click",async()=>{
    await ext.tabs.create({url:ext.runtime.getURL("dashboard.html")});
  });

  connect();
})();